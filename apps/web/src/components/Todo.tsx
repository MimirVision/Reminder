import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  acceptSuggestion, cachedOpenMemories, deleteMemory, dismissSuggestion, flushOutbox, listMembers, listMemories, listPhotoUrls, listPlaces, markDone,
  notifyPartnerIfSet, pendingTodos, purgeDismissed, reopen, requestSuggestion, restoreMemory, softDelete, subscribeHousehold,
} from '../lib/api';
import { tap } from '../lib/haptics';
import { nextOccurrence } from '../lib/recurrence';
import { hasShare, shareToText } from '../lib/share';
import { distanceM, fetchPois, type LatLon, type Poi } from '../lib/geo';
import { categoryName, placeLabel, recurringLabel } from '../lib/labels';
import { buildPins, type MapPin } from '../lib/pins';
import { directionsUrl } from '../lib/placeSearch';
import type { SetupTarget } from '../lib/setup';
import type { Snap } from '../lib/sheetSnap';
import type { Household, Member, Memory, Place } from '../lib/types';
import { useHere } from '../lib/useHere';
import { compareDue, dueBucket, dueLabel, formatDay, todayISO } from '../lib/when';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { AddBar } from './AddBar';
import { Icon } from './icons';
import { MapSheet } from './MapSheet';
import { PlaceSheet } from './PlaceSheet';
import { RecapCard } from './RecapCard';
import { Tour, tourKey } from './Tour';
import { SetupChecklist } from './SetupChecklist';
import { TodoRow } from './TodoRow';
import { TodoSheet, type SavedInfo } from './TodoSheet';
import { useToast } from './Toast';

const TodoMap = lazy(() => import('./TodoMap'));

type Entry = { placeId: string; key: string | null; label: string; sub: string; count: number; distance: number | null; coords: LatLon | null };

const fmtDistance = (m: number) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`);

export function Todo({ household, userId, onNavigate }: { household: Household; userId: string; onNavigate: (t: SetupTarget) => void }) {
  const { t, tn, locale } = useI18n();
  const { resolved } = useTheme();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tour, setTour] = useState(false);
  const [placesLoaded, setPlacesLoaded] = useState(false);
  const [sharedText, setSharedText] = useState<string | null>(null);
  const [doneTicks, setDoneTicks] = useState(0);
  const toast = useToast();
  const [mode, setMode] = useState<'list' | 'map'>('list');
  const [showDone, setShowDone] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [photos, setPhotos] = useState<Map<string, string[]>>(new Map());
  const [pois, setPois] = useState<Record<string, Poi[]>>({});
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Memory | null>(null);
  const [openPlace, setOpenPlace] = useState<{ id: string; label: string } | null>(null);
  const [snap, setSnap] = useState<Snap>('peek');
  const [sheetH, setSheetH] = useState(220);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const { here, state: locState, locate } = useHere(mode === 'map');

  const mapOn = mode === 'map' && !showDone;

  const load = useCallback(async () => {
    const pending = showDone ? [] : pendingTodos(household.id);
    try {
      const list = await listMemories(household.id, showDone ? ['done'] : ['inbox', 'active']);
      setMemories([...pending.filter((p) => !list.some((m) => m.id === p.id)), ...list]);
      setLoaded(true);
      setErr(null);
      setLoadFailed(false);
      setPhotos(await listPhotoUrls(list.map((m) => m.id)).catch(() => new Map()));
    } catch (e) {
      setLoaded(true);
      if (!showDone && (!navigator.onLine || /fetch|network|load failed/i.test(String(e)))) {
        // Offline: show the last list we saw, plus what was written on this device.
        setLoadFailed(true);
        setMemories([...pending, ...cachedOpenMemories(household.id).filter((m) => !pending.some((p) => p.id === m.id))]);
        setErr(null);
      } else setErr(e instanceof Error ? e.message : String(e));
    }
  }, [household.id, showDone]);
  const loadPlaces = useCallback(() => { listPlaces(household.id).then((p) => { setPlaces(p); setPlacesLoaded(true); }).catch(() => setPlacesLoaded(true)); }, [household.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { loadPlaces(); listMembers(household.id).then(setMembers).catch(() => {}); }, [household.id, loadPlaces]);
  useEffect(() => { void purgeDismissed(household.id).catch(() => {}); }, [household.id]);

  // Send what was written offline as soon as we are back online.
  const loadRef0 = useRef(load);
  loadRef0.current = load;
  useEffect(() => {
    const sync = async () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) return;
      const ids = await flushOutbox().catch(() => []);
      if (ids.length > 0) { toast({ text: tn('offline.synced', ids.length) }); notifyPartnerIfSet(ids); void loadRef0.current(); }
    };
    const off = () => setOnline(false);
    void sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', off);
    document.addEventListener('visibilitychange', sync);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', off); document.removeEventListener('visibilitychange', sync); };
  }, [toast, tn]);

  // Something shared into the app (Web Share Target) opens the add sheet with the text ready.
  useEffect(() => {
    if (!hasShare(window.location.search)) return;
    const text = shareToText(window.location.search);
    window.history.replaceState(null, '', window.location.pathname);
    if (text) { setSharedText(text); setAdding(true); }
  }, []);

  // Live: a to-do your partner adds shows up here without a refresh. Also refresh when the app comes back to the front.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let timer: number | undefined;
    const soon = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void loadRef.current(); loadPlaces(); }, 250); };
    const off = subscribeHousehold(household.id, soon);
    const onVisible = () => { if (document.visibilityState === 'visible') soon(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearTimeout(timer); off(); document.removeEventListener('visibilitychange', onVisible); };
  }, [household.id, loadPlaces]);

  // Ask for place suggestions for a few to-dos that have none yet (once per to-do; silent if not set up).
  const suggestOff = useRef(false);
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

  // Map: shops for "any pharmacy" style places, looked up around where you are.
  const catKey = places.filter((p) => p.kind === 'category' && p.category).map((p) => p.category).sort().join(',');
  useEffect(() => {
    if (!mapOn || !here || !catKey) return;
    let live = true;
    (async () => {
      const next: Record<string, Poi[]> = {};
      for (const c of new Set(catKey.split(','))) next[c] = await fetchPois(c, here).catch(() => []);
      if (live) setPois(next);
    })();
    return () => { live = false; };
  }, [mapOn, here, catKey]);

  // First visit with nothing set up: a short guided start.
  useEffect(() => {
    if (!loaded || !placesLoaded || showDone || tour) return;
    let seen = false;
    try { seen = localStorage.getItem(tourKey(household.id)) === '1'; } catch { /* ignore */ }
    if (!seen && memories.length === 0 && places.length === 0 && !hasShare(window.location.search)) setTour(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, placesLoaded, showDone]);

  const labelOf = useCallback((p: Place) => placeLabel(p, t), [t]);
  const placeName = (id: string | null) => { const p = places.find((x) => x.id === id); return p ? labelOf(p) : undefined; };
  const who = (id: string) => (id === userId ? null : members.find((m) => m.user_id === id)?.display_name ?? t('common.partner'));
  const ago = (iso: string) => {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    if (mins < 1) return t('time.now');
    if (mins < 60) return t('time.min', { n: mins });
    const hours = Math.round(mins / 60);
    return hours < 24 ? t('time.hour', { n: hours }) : new Date(iso).toLocaleDateString(locale);
  };
  const byline = (m: Memory) => { const w = who(m.author_id); return w ? `${w} · ${ago(m.created_at)}` : undefined; };

  const groups = useMemo(() => {
    const today = memories.filter((m) => dueBucket(m) === 'today').sort(compareDue);
    const upcoming = memories.filter((m) => dueBucket(m) === 'upcoming').sort(compareDue);
    const undated = memories.filter((m) => dueBucket(m) === 'none');
    const byPlace = new Map<string, Memory[]>();
    const anytime: Memory[] = [];
    for (const m of undated) {
      if (!m.place_id) anytime.push(m);
      else byPlace.set(m.place_id, [...(byPlace.get(m.place_id) ?? []), m]);
    }
    return { today, upcoming, byPlace, anytime };
  }, [memories]);

  const countByPlace = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of memories) if (m.place_id) c.set(m.place_id, (c.get(m.place_id) ?? 0) + 1);
    return c;
  }, [memories]);
  const pins = useMemo(() => buildPins(places, countByPlace, pois, labelOf), [places, countByPlace, pois, labelOf]);

  const entries: Entry[] = useMemo(() => places.map((p) => {
    const count = countByPlace.get(p.id) ?? 0;
    if (p.kind === 'fixed') {
      const coords = p.lat != null && p.lon != null ? { lat: p.lat, lon: p.lon } : null;
      return { placeId: p.id, key: coords ? p.id : null, label: labelOf(p), sub: p.address ?? '', count, distance: coords && here ? distanceM(here, coords) : null, coords };
    }
    const near = here ? (pois[p.category ?? ''] ?? []).map((poi) => ({ poi, d: distanceM(here, poi) })).sort((a, b) => a.d - b.d)[0] : undefined;
    return { placeId: p.id, key: near ? `${p.id}|${near.poi.id}` : null, label: labelOf(p), sub: near ? near.poi.name : t('places.kindCategory'), count, distance: near?.d ?? null, coords: near ? { lat: near.poi.lat, lon: near.poi.lon } : null };
  }).sort((a, b) => (b.count > 0 ? 1 : 0) - (a.count > 0 ? 1 : 0) || (a.distance ?? 1e12) - (b.distance ?? 1e12) || a.label.localeCompare(b.label, locale)), [places, countByPlace, here, pois, labelOf, locale, t]);

  async function act<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try { const r = await fn(); await load(); return r; } catch (e) { setErr(e instanceof Error ? e.message : String(e)); await load(); return undefined; }
  }

  const toggle = (m: Memory) => {
    if (m.pending) return; // it has not reached the server yet
    tap(showDone ? 'light' : 'success');
    setMemories((cur) => cur.filter((x) => x.id !== m.id));
    if (showDone) { void act(() => reopen(m.id, m)); return; }
    setDoneTicks((n) => n + 1);
    void act(() => markDone(m.id)).then((next) => {
      const text = next && m.due_on && m.repeat_rule ? t('toast.doneRepeat', { date: formatDay(nextOccurrence(m.due_on, m.repeat_rule, todayISO()), locale) }) : t('toast.done');
      toast({ text, undo: () => void act(async () => { await reopen(m.id, m); if (next) await deleteMemory(next); }) });
    });
  };

  const remove = (m: Memory) => {
    setEditing(null);
    setMemories((cur) => cur.filter((x) => x.id !== m.id));
    void act(() => softDelete(m.id)).then(() => toast({ text: t('toast.deleted'), undo: () => void act(() => restoreMemory(m.id, m)) }));
  };

  const saved = (info: SavedInfo) => {
    setAdding(false);
    setEditing(null);
    setShowDone(false);
    setSharedText(null);
    // Anything saved without a connection shows at once, before the list is fetched again.
    const waiting = info.added.filter((m) => m.pending);
    if (waiting.length) setMemories((cur) => [...waiting, ...cur.filter((m) => !waiting.some((w) => w.id === m.id))]);
    if (info.createdPlace) loadPlaces();
    toast({ text: info.edited ? t('toast.saved') : tn('toast.added', info.added.length) });
    void load();
  };

  const row = (m: Memory, opts: { place?: boolean; meta?: boolean } = {}) => {
    const due = dueLabel(m, t, locale);
    return (
      <TodoRow key={m.id} m={m} photos={photos.get(m.id)} done={showDone} due={due || undefined} dueLate={!!m.due_on && m.due_on < todayISO()}
        place={opts.place ? placeName(m.place_id) : undefined} byline={opts.meta === false ? undefined : byline(m)}
        author={members.length > 1 && m.author_id !== userId ? { id: m.author_id, name: members.find((x) => x.user_id === m.author_id)?.display_name ?? null } : null}
        onToggle={() => toggle(m)} onEdit={() => setEditing(m)} onDelete={() => remove(m)}>
        {m.suggestion && !showDone && (
          <div className="suggest" role="group" aria-label={t('suggest.aria')}>
            <span className="chip"><Icon name={m.suggestion.kind === 'recurring' ? 'house' : 'pin'} size={13} />
              {m.suggestion.kind === 'recurring' ? t('suggest.recurring', { label: m.suggestion.recurring ? recurringLabel(m.suggestion.recurring, t) : m.suggestion.label }) : m.suggestion.kind === 'category' && m.suggestion.category ? categoryName(m.suggestion.category, t) : m.suggestion.label}</span>
            <span className="muted">{m.suggestion.reason}</span>
            <span className="row">
              <button className="btn small primary" onClick={() => void act(() => acceptSuggestion(m.id, household.id, m.suggestion!).then(loadPlaces))}>{m.suggestion.kind === 'recurring' ? t('suggest.makeRecurring') : t('suggest.add')}</button>
              <button className="btn small" onClick={() => void act(() => dismissSuggestion(m.id))}>{t('suggest.no')}</button>
            </span>
          </div>
        )}
      </TodoRow>
    );
  };

  const section = (title: string, items: Memory[], opts?: { place?: boolean }) => items.length === 0 ? null : (
    <section className="group" aria-label={title}>
      <div className="label">{title}</div>
      <div className="card list">{items.map((m) => row(m, { place: opts?.place ?? true }))}</div>
    </section>
  );

  const placeCard = (placeId: string, items: Memory[]) => {
    const name = placeName(placeId) ?? t('todo.somewhere');
    const shown = items.slice(0, 3);
    return (
      <div className="card list" key={placeId}>
        <div className="row spread cardhead">
          <span className="chip"><Icon name="pin" size={13} />{name}</span>
          <button className="link" onClick={() => setOpenPlace({ id: placeId, label: name })}>{t('todo.openList')}</button>
        </div>
        {shown.map((m) => row(m, { meta: items.length === 1 }))}
        {items.length > shown.length && <button className="link more" onClick={() => setOpenPlace({ id: placeId, label: name })}>{t('todo.moreAt', { n: items.length - shown.length })}</button>}
      </div>
    );
  };

  const seg = (
    <div className="seg glass" role="group" aria-label={t('view.label')}>
      {(['list', 'map'] as const).map((m) => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{t(`view.${m}` as const)}</button>)}
    </div>
  );

  const selectEntry = (e: Entry) => { if (e.key) { setSelectedKey(e.key); setSnap((s) => (s === 'full' ? 'half' : s)); } };
  const selectPin = (p: MapPin) => { setSelectedKey(p.key); setSnap((s) => (s === 'peek' ? 'half' : s)); };
  const selectedPlaceId = pins.find((p) => p.key === selectedKey)?.placeId;
  const cards = (list: Entry[]) => list.map((e) => (
    <article key={e.placeId} className={`pcard${selectedPlaceId === e.placeId ? ' sel' : ''}`} onClick={() => selectEntry(e)}>
      <div className="pc-main">
        <strong>{e.label}</strong>
        <span className="muted">{[e.distance != null ? t('map.away', { d: fmtDistance(e.distance) }) : '', e.sub].filter(Boolean).join(' · ')}</span>
      </div>
      <span className={`chip${e.count ? '' : ' plain'}`}>{e.count ? tn('map.todos', e.count) : t('map.noTodos')}</span>
      <div className="pc-actions">
        <button className="btn small" onClick={(ev) => { ev.stopPropagation(); setOpenPlace({ id: e.placeId, label: e.label }); }}>{t('todo.openList')}</button>
        {e.coords && <a className="btn small" href={directionsUrl(e.coords)} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}><Icon name="navigate" size={14} />{t('where.directions')}</a>}
      </div>
    </article>
  ));

  const withTodos = entries.filter((e) => e.count > 0);
  const without = entries.filter((e) => e.count === 0);
  const title = showDone ? t('todo.doneTitle') : t('todo.title');
  const empty = loaded && memories.length === 0;

  return (
    <main className={`page${mapOn ? ' map-mode' : ''}`}>
      <div className="head"><h1 className={mapOn ? 'glass titlepill' : undefined}>{title}</h1>{!showDone && seg}</div>
      {(!online || loadFailed) && !mapOn && <p className="offline-banner" role="status">{t('offline.banner')}</p>}
      {err && (
        <p className="error" role="alert">{err} <button className="link" onClick={() => void load()}>{t('common.retry')}</button></p>
      )}

      {mapOn ? (
        <>
          <Suspense fallback={<div className="mapwrap"><div className="map" /></div>}>
            <TodoMap pins={pins} here={here} selectedKey={selectedKey} resolved={resolved} bottomInset={sheetH} onSelect={selectPin} onLocate={locate} onAdd={() => setAdding(true)} />
          </Suspense>
          <MapSheet snap={snap} onSnap={setSnap} onHeight={setSheetH} title={here ? t('map.nearYou') : t('map.places')}>
            {!here && locState !== 'unsupported' && (locState === 'denied'
              ? <p className="muted">{t('map.locationOff')}</p>
              : <button className="btn small" onClick={locate}><Icon name="locate" size={15} /> {t('map.allowLocation')}</button>)}
            {places.length === 0 && <p className="muted">{t('map.empty')}</p>}
            {cards(withTodos)}
            {without.length > 0 && <div className="label">{t('map.otherPlaces')}</div>}
            {cards(without)}
          </MapSheet>
        </>
      ) : showDone ? (
        <div className="card list">{memories.length === 0 ? <span className="muted pad">{t('todo.done.empty')}</span> : memories.map((m) => row(m, { place: true }))}</div>
      ) : !loaded ? (
        <div className="card list" aria-busy="true">{[70, 52, 84].map((w) => <div className="todo" key={w}><span className="check skel" /><span className="skel line" style={{ width: `${w}%` }} /></div>)}</div>
      ) : (
        <>
          <SetupChecklist household={household} onNavigate={onNavigate} />
          <RecapCard household={household} members={members} refreshKey={doneTicks} />
          {empty && (
            <div className="empty">
              <span className="empty-ico"><Icon name="check" size={28} /></span>
              <strong>{t('todo.empty.title')}</strong>
              <span className="muted">{t('todo.empty.body')}</span>
            </div>
          )}
          {section(t('todo.sec.today'), groups.today)}
          {section(t('todo.sec.upcoming'), groups.upcoming)}
          {groups.byPlace.size > 0 && <div className="label">{t('todo.sec.place')}</div>}
          {[...groups.byPlace].map(([id, items]) => placeCard(id, items))}
          {section(t('todo.sec.anytime'), groups.anytime, { place: false })}
        </>
      )}

      {!mapOn && <p><button className="link quiet" onClick={() => setShowDone(!showDone)}>{showDone ? t('todo.back') : t('todo.showDone')}</button></p>}

      {!showDone && !mapOn && <AddBar onClick={() => setAdding(true)} />}
      {adding && <TodoSheet household={household} places={places} initialBody={sharedText ?? undefined} onClose={() => { setAdding(false); setSharedText(null); }} onSaved={saved} />}
      {tour && <Tour household={household} onClose={() => setTour(false)} onChanged={() => { void load(); loadPlaces(); }} />}
      {editing && <TodoSheet key={editing.id} household={household} places={places} memory={editing} photos={photos.get(editing.id)} onClose={() => setEditing(null)} onSaved={saved} onDelete={remove} />}
      {openPlace && <PlaceSheet household={household} placeId={openPlace.id} label={openPlace.label} onClose={() => setOpenPlace(null)} onChanged={() => void load()} onEdit={(m) => setEditing(m)} />}
    </main>
  );
}
