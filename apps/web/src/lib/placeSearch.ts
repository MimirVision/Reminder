// "Where?" search: type a shop ("kiwi myren"), a kind of shop ("apotek") or an address. Shops and addresses come from
// Photon (OpenStreetMap data, free, CORS-enabled); kinds of shop are recognised locally so they work offline.
import type { LatLon } from './geo.ts';
import { distanceM } from './geo.ts';
import { CATEGORIES, type Category, isCategory } from './labels.ts';

export type Hit = {
  key: string; // osm type/id, stable enough to de-duplicate
  name: string;
  address: string; // "Street 1, 0123 City" (may be empty)
  lat: number;
  lon: number;
  category: Category | null; // set when the hit is a known kind of shop
  isAddress: boolean;
};

// Norwegian and English words that mean "any shop of this kind". Matched on the whole typed word or its start.
const KEYWORDS: Record<Category, string[]> = {
  pharmacy: ['apotek', 'apoteket', 'pharmacy', 'chemist', 'vitus', 'boots', 'ditt apotek', 'apotek 1'],
  hardware: ['byggevare', 'byggevarehus', 'hardware', 'jernvare', 'byggmax', 'maxbo', 'monter', 'obs bygg', 'biltema', 'bygg'],
  grocery: ['dagligvare', 'dagligvarer', 'grocery', 'supermarket', 'matbutikk', 'butikk', 'kiwi', 'rema', 'coop', 'meny', 'joker', 'spar', 'bunnpris'],
  paint: ['maling', 'malingforretning', 'paint', 'jotun', 'flügger', 'flugger', 'fargehandel'],
  garden: ['hage', 'hagesenter', 'garden', 'plantasjen', 'blomster', 'plantesenter'],
};

const norm = (s: string) => s.toLocaleLowerCase('nb').normalize('NFC').trim().replace(/\s+/g, ' ');

/** Kind of shop meant by the typed text, only when the WHOLE text is one of the generic words ("apotek", "byggevare").
 *  Brand names (kiwi, vitus) stay a normal search, because you want that exact shop nearby. */
const GENERIC: Record<Category, string[]> = {
  pharmacy: ['apotek', 'apoteket', 'pharmacy', 'chemist'],
  hardware: ['byggevare', 'byggevarer', 'byggevarehus', 'hardware', 'hardware store', 'jernvare', 'jernvarehandel'],
  grocery: ['dagligvare', 'dagligvarer', 'grocery', 'supermarket', 'matbutikk', 'butikk'],
  paint: ['maling', 'malingforretning', 'malingsbutikk', 'paint', 'paint shop'],
  garden: ['hage', 'hagesenter', 'garden', 'garden centre', 'plantesenter'],
};

export function categoryFromQuery(q: string): Category | null {
  const n = norm(q);
  if (n.length < 3) return null;
  for (const c of CATEGORIES) if (GENERIC[c].some((w) => w === n || (n.length >= 4 && w.startsWith(n)))) return c;
  return null;
}

/** Brands usually implying a kind of shop; used to tag a saved shop so kind-tagged facts show up there. */
export function categoryFromName(name: string): Category | null {
  const n = norm(name);
  for (const c of CATEGORIES) if (KEYWORDS[c].some((w) => w.length >= 4 && n.includes(w))) return c;
  return null;
}

export function categoryFromOsm(key: string | undefined, value: string | undefined): Category | null {
  if (!key || !value) return null;
  if (key === 'amenity' && value === 'pharmacy') return 'pharmacy';
  if (key !== 'shop') return null;
  if (['doityourself', 'hardware', 'building_materials'].includes(value)) return 'hardware';
  if (['supermarket', 'convenience', 'greengrocer'].includes(value)) return 'grocery';
  if (value === 'paint') return 'paint';
  if (['garden_centre', 'agrarian'].includes(value)) return 'garden';
  return null;
}

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number; osm_type?: string; osm_key?: string; osm_value?: string; name?: string; street?: string; housenumber?: string;
    postcode?: string; city?: string; district?: string; locality?: string; county?: string; countrycode?: string;
  };
};

export function parsePhoton(json: unknown): Hit[] {
  const features = (json as { features?: PhotonFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: Hit[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const c = f.geometry?.coordinates;
    const p = f.properties;
    if (!p || !Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') continue;
    if (p.countrycode && p.countrycode.toUpperCase() !== 'NO') continue;
    const street = [p.street, p.housenumber].filter(Boolean).join(' ');
    const town = [p.postcode, p.city ?? p.district ?? p.locality ?? p.county].filter(Boolean).join(' ');
    const name = p.name && p.name !== p.street ? p.name : street || p.name || '';
    if (!name) continue;
    const isAddress = !p.name || p.name === p.street || (p.osm_key === 'place' && p.osm_value === 'house');
    const address = (isAddress ? [town] : [street, town]).filter(Boolean).join(', ');
    const key = `${p.osm_type ?? '?'}/${p.osm_id ?? `${c[1]},${c[0]}`}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name, address, lat: c[1], lon: c[0], category: categoryFromOsm(p.osm_key, p.osm_value), isAddress });
  }
  return out;
}

const NORWAY_BBOX = '4.0,57.9,31.5,71.3';

export async function searchPlaces(q: string, opts: { near?: LatLon | null; signal?: AbortSignal; limit?: number } = {}): Promise<Hit[]> {
  const text = q.trim();
  if (text.length < 2) return [];
  const params = new URLSearchParams({ q: text, limit: String(opts.limit ?? 6), bbox: NORWAY_BBOX });
  if (opts.near) { params.set('lat', String(opts.near.lat)); params.set('lon', String(opts.near.lon)); }
  const res = await fetch(`https://photon.komoot.io/api/?${params}`, { signal: opts.signal });
  if (!res.ok) throw new Error(`place search ${res.status}`);
  return parsePhoton(await res.json());
}

/** A saved place that is the same as a search hit (same spot, or same name), so we reuse it rather than duplicate. */
export function findExistingPlace<P extends { id: string; name: string; lat: number | null; lon: number | null }>(places: P[], hit: Pick<Hit, 'name' | 'lat' | 'lon'>): P | null {
  const n = norm(hit.name);
  return places.find((p) => (p.lat != null && p.lon != null && distanceM({ lat: p.lat, lon: p.lon }, hit) < 60 && norm(p.name) === n) || (p.lat != null && p.lon != null && distanceM({ lat: p.lat, lon: p.lon }, hit) < 25)) ?? null;
}

/** Saved places matching what is being typed (name or address), best first. Empty query lists nothing. */
export function matchSaved<P extends { name: string; address?: string | null }>(places: P[], q: string, label: (p: P) => string = (p) => p.name): P[] {
  const n = norm(q);
  if (!n) return [];
  const score = (p: P) => {
    const l = norm(label(p));
    if (l.startsWith(n)) return 0;
    if (l.split(' ').some((w) => w.startsWith(n))) return 1;
    if (l.includes(n) || norm(p.address ?? '').includes(n)) return 2;
    return 9;
  };
  return places.filter((p) => score(p) < 9).sort((a, b) => score(a) - score(b));
}

export const directionsUrl = (p: { lat: number; lon: number }) => `https://maps.apple.com/?daddr=${p.lat},${p.lon}&dirflg=d`;
export { isCategory };
