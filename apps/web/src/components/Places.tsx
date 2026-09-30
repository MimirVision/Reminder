import { FormEvent, useCallback, useEffect, useState } from 'react';
import { addPlace, deletePlace, listPlaces, updatePlaceRadius } from '../lib/api';
import type { Household, Place } from '../lib/types';
import { Icon } from './icons';

// Category places mean "any of these" (resolved to nearby shops by the phone app and the map).
const CATEGORIES = [
  { category: 'pharmacy', name: 'Any pharmacy (apotek)' },
  { category: 'hardware', name: 'Any hardware store (byggevarehus)' },
  { category: 'grocery', name: 'Any grocery store (dagligvare)' },
  { category: 'paint', name: 'Any paint shop (malingforretning)' },
  { category: 'garden', name: 'Any garden centre (hagesenter)' },
];
const RADII = [100, 150, 250, 500, 1000];

export function Places({ household }: { household: Household }) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [radius, setRadius] = useState(150);

  const load = useCallback(async () => {
    try { setPlaces(await listPlaces(household.id)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [household.id]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<void>) {
    try { setErr(null); await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  function useMyLocation() {
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(6)); setLon(p.coords.longitude.toFixed(6)); },
      (e) => setErr(e.message),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function submitFixed(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await addPlace({ household_id: household.id, name, kind: 'fixed', category: null, lat: Number(lat), lon: Number(lon), radius_m: radius });
      setName(''); setLat(''); setLon('');
    });
  }

  return (
    <main className="page">
      <h1>Places</h1>
      <span className="muted">Where you want to be reminded. The distance is how close you get before "Are you here?" appears on the phone.</span>
      {err && <p className="error">{err}</p>}
      {places.length === 0 && <p className="muted">No places yet.</p>}
      {places.map((p) => (
        <div className="card" key={p.id}>
          <div className="row spread">
            <span className="chip"><Icon name="pin" size={13} />{p.name}</span>
            <span className="muted">{p.kind === 'category' ? 'any nearby shop of this kind' : 'specific place'}</span>
          </div>
          <div className="row">
            <label className="muted">Distance{' '}
              <select value={p.radius_m} onChange={(e) => void run(() => updatePlaceRadius(p.id, Number(e.target.value)))}>
                {RADII.map((r) => <option key={r} value={r}>{r} m</option>)}
              </select>
            </label>
            <button className="btn small danger" onClick={() => confirm(`Delete ${p.name}?`) && void run(() => deletePlace(p.id))}>Delete</button>
          </div>
        </div>
      ))}

      <div className="label">Add a category</div>
      <div className="row">
        {CATEGORIES.filter((c) => !places.some((p) => p.category === c.category)).map((c) => (
          <button key={c.category} className="btn small" onClick={() => void run(() => addPlace({ household_id: household.id, name: c.name, kind: 'category', category: c.category, lat: null, lon: null, radius_m: 150 }))}>+ {c.name}</button>
        ))}
      </div>

      <div className="label">Add a specific place</div>
      <form className="card" onSubmit={submitFixed}>
        <input placeholder="Name (e.g. Home, Byggmax Skøyen)" required value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row">
          <input style={{ flex: 1, minWidth: 120 }} placeholder="Latitude" required inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
          <input style={{ flex: 1, minWidth: 120 }} placeholder="Longitude" required inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
          <button type="button" className="btn small" onClick={useMyLocation}>Use my location</button>
        </div>
        <div className="row">
          <label className="muted">Distance{' '}
            <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>{RADII.map((r) => <option key={r} value={r}>{r} m</option>)}</select>
          </label>
          <button className="btn primary small">Add place</button>
        </div>
      </form>
    </main>
  );
}
