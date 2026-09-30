import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { acceptSuggestion, deleteMemory, dismissSuggestion, listMembers, listMemories, listPhotoUrls, listPlaces, markDone, reopen, requestSuggestion } from '../lib/api';
import { fetchPois, type LatLon, type Poi } from '../lib/geo';
import type { Household, Member, Memory, Place } from '../lib/types';
import { AddBar, AddSheet } from './AddSheet';
import { Icon } from './icons';
import { PlaceSheet } from './PlaceSheet';
import { buildPins, type MapPin } from '../lib/pins';

const TodoMap = lazy(() => import('./TodoMap'));

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : new Date(iso).toLocaleDateString();
}

export function Todo({ household, userId }: { household: Household; userId: string }) {
  const [mode, setMode] = useState<'List' | 'Map'>('List');
  const [showDone, setShowDone] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [photos, setPhotos] = useState<Map<string, string[]>>(new Map());
  const [pois, setPois] = useState<Record<string, Poi[]>>({});
  const [here, setHere] = useState<LatLon | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [openPlace, setOpenPlace] = useState<{ id: string; label: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await listMemories(household.id, showDone ? ['done'] : ['inbox', 'active']);
      setMemories(list);
      setPhotos(await listPhotoUrls(list.map((m) => m.id)));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [household.id, showDone]);

  useEffect(() => { void load(); }, [load]);

  // Ask for place suggestions for a few to-dos that have none yet (once per to-do; silent if not set up).
  const suggestOff = useRef(false); // set after the first failure so we stop asking this session
  useEffect(() => {
    if (showDone || suggestOff.current) return;
    const todo = memories.filter((m) => !m.place_id && m.body && !m.suggested_at).slice(0, 3);
    if (todo.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const m of todo) {
        const r = await requestSuggestion(m.id);
        if (r.unavailable) suggestOff.current = true;
        if (cancelled || r.unavailable) return;
        setMemories((cur) => cur.map((x) => (x.id === m.id ? { ...x, suggestion: r.suggestion, suggested_at: new Date().toISOString() } : x)));
      }
    })();
    return () => { cancelled = true; };
  }, [memories, showDone]);
  useEffect(() => {
    listPlaces(household.id).then(setPlaces).catch(() => {});
    listMembers(household.id).then(setMembers).catch(() => {});
  }, [household.id]);

  // Map: ask for location once (only when the map is opened) and look up shops for "any pharmacy" style places.
  useEffect(() => {
    if (mode !== 'Map') return;
    const cats = [...new Set(places.filter((p) => p.kind === 'category' && p.category).map((p) => p.category as string))];
    const go = async (h: LatLon | null) => {
      setHere(h);
      if (!h) return;
      const next: Record<string, Poi[]> = {};
      for (const c of cats) next[c] = await fetchPois(c, h).catch(() => []);
      setPois(next);
    };
    if (!('geolocation' in navigator)) { void go(null); return; }
    navigator.geolocation.getCurrentPosition((p) => void go({ lat: p.coords.latitude, lon: p.coords.longitude }), () => void go(null), { timeout: 8000, maximumAge: 300_000 });
  }, [mode, places]);

  const who = (id: string) => (id === userId ? 'You' : members.find((m) => m.user_id === id)?.display_name ?? 'Partner');
  const placeName = (id: string | null) => places.find((p) => p.id === id)?.name;

  const { byPlace, anytime } = useMemo(() => {
    const byPlace = new Map<string, Memory[]>();
    const anytime: Memory[] = [];
    for (const m of memories) {
      if (!m.place_id) anytime.push(m);
      else byPlace.set(m.place_id, [...(byPlace.get(m.place_id) ?? []), m]);
    }
    return { byPlace, anytime };
  }, [memories]);

  const pins = useMemo(() => buildPins(places, new Map([...byPlace].map(([k, v]) => [k, v.length])), pois), [places, byPlace, pois]);

  async function act(fn: () => Promise<void>) {
    try { await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  const todo = (m: Memory, meta: boolean) => (
    <div key={m.id} className={`todo${showDone ? ' done' : ''}`}>
      <button className={`check${showDone ? ' on' : ''}`} aria-label={showDone ? 'Mark as not done' : 'Mark as done'}
        onClick={() => void act(() => (showDone ? reopen(m.id, Boolean(m.place_id)) : markDone(m.id)))}>
        {showDone && <Icon name="check" size={14} />}
      </button>
      <div className="text">
        {m.body && <p className="body">{m.body}</p>}
        {(photos.get(m.id) ?? []).length > 0 && <div className="photos">{photos.get(m.id)!.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" loading="lazy" /></a>)}</div>}
        {m.suggestion && !showDone && (
          <div className="suggest" role="group" aria-label="Suggested place">
            <span className="chip"><Icon name={m.suggestion.kind === 'recurring' ? 'house' : 'pin'} size={13} />{m.suggestion.kind === 'recurring' ? `Recurring task · ${m.suggestion.label}` : m.suggestion.label}</span>
            <span className="muted">{m.suggestion.reason}</span>
            <span className="row">
              <button className="btn small primary" onClick={() => void act(() => acceptSuggestion(m.id, household.id, m.suggestion!).then(() => listPlaces(household.id).then(setPlaces)))}>{m.suggestion.kind === 'recurring' ? 'Make recurring' : 'Add reminder'}</button>
              <button className="btn small" onClick={() => void act(() => dismissSuggestion(m.id))}>No thanks</button>
            </span>
          </div>
        )}
        {meta && <span className="muted">{who(m.author_id)} · {ago(m.created_at)}</span>}
      </div>
      <button className="link quiet" onClick={() => confirm('Delete this to-do?') && void act(() => deleteMemory(m.id))}>Delete</button>
    </div>
  );

  const groupCard = (placeId: string, items: Memory[]) => {
    const name = placeName(placeId) ?? 'Somewhere';
    const shown = items.slice(0, 3);
    return (
      <div className="card" key={placeId}>
        <div className="row spread">
          <span className="chip"><Icon name="pin" size={13} />{name}</span>
          <button className="link" onClick={() => setOpenPlace({ id: placeId, label: name })}>Open list</button>
        </div>
        {shown.map((m) => todo(m, items.length === 1))}
        {items.length > shown.length && <button className="link" style={{ textAlign: 'left' }} onClick={() => setOpenPlace({ id: placeId, label: name })}>+ {items.length - shown.length} more · Open list</button>}
      </div>
    );
  };

  const seg = (
    <div className="seg glass" role="group" aria-label="View">
      {(['List', 'Map'] as const).map((m) => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m}</button>)}
    </div>
  );

  return (
    <main className="page">
      <div className="head"><h1>{showDone ? 'Done' : 'To-do'}</h1>{!showDone && seg}</div>
      {err && <p className="error">{err}</p>}

      {mode === 'Map' && !showDone ? (
        <>
          <Suspense fallback={<div className="mapbox" />}>
            <TodoMap pins={pins} here={here} onOpen={(p: MapPin) => setOpenPlace({ id: p.placeId, label: p.label })} />
          </Suspense>
          {pins.length === 0 && <p className="muted">No mapped places with open to-dos yet. Add a to-do at a place, and allow location to find nearby shops.</p>}
        </>
      ) : showDone ? (
        <div className="card">{memories.length === 0 ? <span className="muted">Nothing done yet.</span> : memories.map((m) => todo(m, true))}</div>
      ) : (
        <>
          {memories.length === 0 && <p className="muted">Nothing to do. Add something below.</p>}
          {byPlace.size > 0 && <div className="label">At a place</div>}
          {[...byPlace].map(([id, items]) => groupCard(id, items))}
          {anytime.length > 0 && <div className="label">Anytime</div>}
          {anytime.map((m) => <div className="card" key={m.id}>{todo(m, true)}</div>)}
        </>
      )}

      <p><button className="link quiet" onClick={() => setShowDone(!showDone)}>{showDone ? 'Back to to-do' : 'Show done'}</button></p>

      {!showDone && <AddBar onClick={() => setAdding(true)} />}
      {adding && <AddSheet household={household} places={places} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setShowDone(false); void load(); }} />}
      {openPlace && <PlaceSheet household={household} placeId={openPlace.id} label={openPlace.label} onClose={() => setOpenPlace(null)} onChanged={() => void load()} />}
    </main>
  );
}
