import { useCallback, useEffect, useState } from 'react';
import { addPlace, deletePlace, listPlaces, updatePlaceCategory, updatePlaceRadius } from '../lib/api';
import { CATEGORIES, categoryName, placeLabel, shopName } from '../lib/labels';
import { findExistingPlace, directionsUrl, categoryFromName } from '../lib/placeSearch';
import type { Household, Place } from '../lib/types';
import { useI18n } from '../i18n';
import { Icon } from './icons';
import { PlaceSearchBox, type Pick } from './PlaceSearchBox';
import { useToast } from './Toast';

const RADII = [100, 150, 250, 500, 1000];

export function Places({ household }: { household: Household }) {
  const { t } = useI18n();
  const toast = useToast();
  const [places, setPlaces] = useState<Place[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState(0); // remounts the search box after adding, so it is empty again

  const load = useCallback(async () => {
    try { setPlaces(await listPlaces(household.id)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [household.id]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<void>) {
    try { setErr(null); await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  const add = (p: Pick) => void run(async () => {
    if (p.type === 'saved') return;
    if (p.type === 'kind') {
      const name = categoryName(p.category, t);
      await addPlace({ household_id: household.id, name, kind: 'category', category: p.category, lat: null, lon: null, radius_m: 150 });
      toast({ text: t('places.saved', { name }) });
    } else {
      if (findExistingPlace(places, p.hit)) return;
      await addPlace({
        household_id: household.id, name: p.hit.name, kind: 'fixed', category: p.hit.category ?? categoryFromName(p.hit.name),
        lat: p.hit.lat, lon: p.hit.lon, radius_m: p.hit.isAddress ? 150 : 200, address: p.hit.address || null,
      });
      toast({ text: t('places.saved', { name: p.hit.name }) });
    }
    setKey((k) => k + 1);
  });

  return (
    <main className="page">
      <h1>{t('places.title')}</h1>
      <span className="muted">{t('places.intro')}</span>
      {err && <p className="error" role="alert">{err}</p>}

      <div className="label">{t('places.addSpecific')}</div>
      <div className="card">
        <span className="muted">{t('places.addHelp')}</span>
        <PlaceSearchBox key={key} places={places} showSaved={false} onPick={add} />
      </div>

      {places.length === 0 && <p className="muted">{t('places.empty')}</p>}
      {places.map((p) => (
        <div className="card place" key={p.id}>
          <div className="row spread">
            <div className="rt">
              <strong><Icon name={p.kind === 'category' ? 'store' : 'pin'} size={16} /> {placeLabel(p, t)}</strong>
              <span className="muted">{p.address ?? (p.kind === 'category' ? t('places.kindCategory') : t('places.kindFixed'))}</span>
            </div>
            {p.lat != null && p.lon != null && <a className="btn small" href={directionsUrl({ lat: p.lat, lon: p.lon })} target="_blank" rel="noreferrer"><Icon name="navigate" size={14} />{t('where.directions')}</a>}
          </div>
          <div className="row">
            <label className="muted">{t('places.distance')}{' '}
              <select value={p.radius_m} onChange={(e) => void run(() => updatePlaceRadius(p.id, Number(e.target.value)))}>
                {[...new Set([...RADII, p.radius_m])].sort((a, b) => a - b).map((r) => <option key={r} value={r}>{t('places.meters', { n: r })}</option>)}
              </select>
            </label>
            {p.kind === 'fixed' && (
              <label className="muted">{t('places.kindOfShop')}{' '}
                <select value={p.category ?? ''} onChange={(e) => void run(() => updatePlaceCategory(p.id, e.target.value || null))}>
                  <option value="">{t('common.none')}</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{shopName(c, t)}</option>)}
                </select>
              </label>
            )}
            <button className="btn small danger" onClick={() => confirm(t('places.confirmDelete', { name: placeLabel(p, t) })) && void run(() => deletePlace(p.id))}>{t('common.delete')}</button>
          </div>
        </div>
      ))}
    </main>
  );
}
