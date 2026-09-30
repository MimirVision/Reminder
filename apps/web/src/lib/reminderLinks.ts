// Builds the links a person pastes into iPhone Shortcuts / subscribes to in Calendar. Pure, so it is unit tested.
import type { Place } from './types';

export type LinkSet = {
  calendar: string; // webcal:// link (Calendar subscribes)
  calendarHttps: string;
  digest: string;
  today: string;
  places: { label: string; url: string }[];
};

export function buildLinks(origin: string, key: string, places: Pick<Place, 'name' | 'kind' | 'category'>[], lang: 'en' | 'nb' = 'en'): LinkSet {
  const u = new URL(origin);
  const q = (params: Record<string, string>) => `${u.origin}/api/remind?${new URLSearchParams({ key, ...params, ...(lang === 'nb' ? { lang } : {}) }).toString()}`;
  const seen = new Set<string>();
  const out: LinkSet['places'] = [];
  for (const p of places) {
    // "Any pharmacy" places are looked up by shop kind; specific places by name.
    const params: Record<string, string> = p.kind === 'category' && p.category ? { category: p.category } : { place: p.name };
    const url = q(params);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ label: p.name, url });
  }
  return {
    calendar: `webcal://${u.host}/calendar.ics?key=${key}${lang === 'nb' ? '&lang=nb' : ''}`,
    calendarHttps: `${u.origin}/calendar.ics?key=${key}${lang === 'nb' ? '&lang=nb' : ''}`,
    digest: q({}),
    today: q({ mode: 'today' }),
    places: out,
  };
}
