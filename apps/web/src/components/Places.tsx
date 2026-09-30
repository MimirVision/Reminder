import { FormEvent, useCallback, useEffect, useState } from 'react';
import { addPlace, deletePlace, listPlaces } from '../lib/api';
import type { Household, Place } from '../lib/types';

// Category places mean "any of these" (resolved to nearby shops by the phone app later).
const CATEGORIES = [
  { category: 'pharmacy', name: 'Any pharmacy (apotek)' },
  { category: 'hardware', name: 'Any hardware store (byggevarehus)' },
  { category: 'grocery', name: 'Any grocery store (dagligvare)' },
  { category: 'paint', name: 'Any paint shop (malingforretning)' },
  { category: 'garden', name: 'Any garden centre (hagesenter)' },
];

export function Places({ household }: { household: Household }) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [radius, setRadius] = useState(150);

  const load = useCallback(async () => {
    try {
      setPlaces(await listPlaces(household.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [household.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<void>) {
    try {
      setErr(null);
      await fn();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  function useMyLocation() {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(6));
        setLon(p.coords.longitude.toFixed(6));
      },
      (e) => setErr(e.message),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function submitFixed(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await addPlace({
        household_id: household.id, name, kind: 'fixed', category: null,
        lat: Number(lat), lon: Number(lon), radius_m: radius,
      });
      setName(''); setLat(''); setLon('');
    });
  }

  const haveCategory = (c: string) => places.some((p) => p.kind === 'category' && p.category === c);

  return (
    <main>
      <h2>Places</h2>
      {err && <p className="error">{err}</p>}
      <ul className="list">
        {places.length === 0 && <li className="muted">No places yet.</li>}
        {places.map((p) => (
          <li key={p.id} className="item row spread">
            <span>
              <strong>{p.name}</strong>
              <span className="muted"> · {p.kind === 'category' ? 'category' : `${p.radius_m} m radius`}</span>
            </span>
            <button className="danger" onClick={() => confirm(`Delete ${p.name}?`) && void run(() => deletePlace(p.id))}>✕</button>
          </li>
        ))}
      </ul>

      <h3>Add a category</h3>
      <div className="row wrap">
        {CATEGORIES.filter((c) => !haveCategory(c.category)).map((c) => (
          <button
            key={c.category}
            onClick={() => void run(() => addPlace({
              household_id: household.id, name: c.name, kind: 'category', category: c.category,
              lat: null, lon: null, radius_m: 150,
            }))}
          >
            + {c.name}
          </button>
        ))}
      </div>

      <h3>Add a specific place</h3>
      <form onSubmit={submitFixed}>
        <input placeholder="Name (e.g. Home, Byggmax Skøyen)" required value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row">
          <input placeholder="Latitude" required inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
          <input placeholder="Longitude" required inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
          <button type="button" onClick={useMyLocation}>Use my location</button>
        </div>
        <div className="row">
          <label>Radius
            <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
              {[100, 150, 250, 500].map((r) => <option key={r} value={r}>{r} m</option>)}
            </select>
          </label>
          <button className="primary">Add place</button>
        </div>
      </form>

      <h3>Invite your partner</h3>
      <p className="muted">
        Send this code. After creating an account they choose “join” and paste it: <code>{household.invite_code}</code>
      </p>
    </main>
  );
}
