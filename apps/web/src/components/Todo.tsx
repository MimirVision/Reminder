import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  acceptSuggestion, cachedOpenMemories, deleteMemory, dismissSuggestion, flushOutbox, listMembers, listMemories, listPhotoUrls, listPlaces, markDone,
  notifyPartnerIfSet, pendingTodos, purgeDismissed, reopen, requestSuggestion, restoreMemory, setOrder, softDelete, subscribeHousehold, updateMemory,
} from '../lib/api';
import { tap } from '../lib/haptics';
import { statusFor } from '../lib/api';
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
import { matchTodos } from '../lib/search';
import { addDays, dueBucket, dueLabel, formatDay, todayISO } from '../lib/when';
import { compareTodos, groupUpcoming, isLate } from '../lib/todoGroups';
import { moveStep } from '../lib/order';
import { allTags } from '../lib/tags';
import { activeCount, applyFilter, noFilter, type Filter } from '../lib/todoFilter';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { AddBar } from './AddBar';
import { CalendarView } from './CalendarView';
import { FilterSheet } from './FilterSheet';
import { ErrorBoundary } from './ErrorBoundary';
import { Icon } from './icons';
import { InstallBanner } from './InstallBanner';
import { MapSheet } from './MapSheet';
import { PlaceSheet } from './PlaceSheet';
import { Sheet } from './Sheet';
import { RescheduleSheet } from './RescheduleSheet';
import { RouteSheet, type RouteView } from './RouteSheet';
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
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const toast = useToast();
  const [mode, setMode] = useState<'list' | 'calendar' | 'map'>('list');
  const [filter, setFilter] = useState<Filter>(noFilter);
  const [filtering, setFiltering] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkMove, setBulkMove] = useState(false);
  const [addDate, setAddDate] = useState<string | undefined>();
  const [showDone, setShowDone] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [rescheduling, setRescheduling] = useState<Memory | null>(null);
  const [route, setRoute] = useState<RouteView | null>(null);
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

  // Keyboard (computer): n = new to-do, / = search. Ignored while typing or when a sheet is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable))) return;
      if (document.querySelector('.sheet')) return;
      if (e.key === 'n') { e.preventDefault(); setAdding(true); }
      else if (e.key === '/') { e.preventDefault(); setSearching(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  // "For me" / "For Kari" keep what is for that person and what is for anyone.
  const partner = members.find((m) => m.user_id !== userId) ?? null;
  const tagList = useMemo(() => allTags(memories), [memories]);
  const visible = useMemo(() => (showDone ? memories : applyFilter(memories, filter, userId, partner?.user_id ?? null)), [memories, filter, partner, userId, showDone]);

  const groups = useMemo(() => {
    const today = visible.filter((m) => dueBucket(m) === 'today').sort(compareTodos);
    const upcoming = groupUpcoming(visible, todayISO());
    const undated = visible.filter((m) => dueBucket(m) === 'none').sort(compareTodos);
    const byPlace = new Map<string, Memory[]>();
    const anytime: Memory[] = [];
    for (const m of undated) {
      if (!m.place_id) anytime.push(m);
      else byPlace.set(m.place_id, [...(byPlace.get(m.place_id) ?? []), m]);
    }
    return { today, upcoming, byPlace, anytime };
  }, [visible]);

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

  // Move to another day (or no day), with an undo.
  const moveTo = (m: Memory, date: string | null) => {
    setRescheduling(null);
    const was = { due_on: m.due_on, due_time: m.due_time, repeat_rule: m.repeat_rule ?? null, remind_before: m.remind_before ?? null };
    const patch = (d: typeof was & { status?: Memory['status'] }) => ({
      due_on: d.due_on, due_time: d.due_on ? d.due_time : null, repeat_rule: d.due_on ? d.repeat_rule : null,
      ...(d.remind_before != null || m.remind_before != null ? { remind_before: d.due_on ? d.remind_before : null } : {}),
      status: statusFor({ place_id: m.place_id, due_on: d.due_on }),
    });
    setMemories((cur) => cur.map((x) => (x.id === m.id ? { ...x, due_on: date, due_time: date ? x.due_time : null } : x)));
    void act(() => updateMemory(m.id, patch({ ...was, due_on: date }))).then(() => toast({ text: t('toast.saved'), undo: () => void act(() => updateMemory(m.id, patch(was))) }));
  };

  const tickStep = (m: Memory, items: NonNullable<Memory['checklist']>) => {
    setMemories((cur) => cur.map((x) => (x.id === m.id ? { ...x, checklist: items } : x)));
    void act(() => updateMemory(m.id, { checklist: items }));
  };

  const lateOnes = visible.filter((m) => !m.pending && isLate(m, todayISO()));
  const moveLateToToday = () => {
    const today = todayISO();
    const ids = lateOnes.map((m) => m.id);
    setMemories((cur) => cur.map((x) => (ids.includes(x.id) ? { ...x, due_on: today } : x)));
    void act(async () => { for (const m of lateOnes) await updateMemory(m.id, { due_on: today }); }).then(() => toast({ text: t('late.moved') }));
  };

  // Select several to-dos and finish, move or delete them together.
  const endPicking = () => { setPicking(false); setPicked(new Set()); setBulkMove(false); };
  const chosen = () => memories.filter((m) => picked.has(m.id) && !m.pending);
  const bulkDone = () => {
    const list = chosen();
    endPicking();
    setMemories((cur) => cur.filter((x) => !list.some((l) => l.id === x.id)));
    setDoneTicks((n) => n + list.length);
    void act(async () => { for (const m of list) await markDone(m.id); }).then(() => toast({ text: tn('bulk.completed', list.length) }));
  };
  const bulkDelete = () => {
    const list = chosen();
    endPicking();
    setMemories((cur) => cur.filter((x) => !list.some((l) => l.id === x.id)));
    void act(async () => { for (const m of list) await softDelete(m.id); }).then(() => toast({ text: tn('bulk.deleted', list.length), undo: () => void act(async () => { for (const m of list) await restoreMemory(m.id, m); }) }));
  };
  const bulkMoveTo = (date: string | null) => {
    const list = chosen();
    endPicking();
    setMemories((cur) => cur.map((x) => (list.some((l) => l.id === x.id) ? { ...x, due_on: date, due_time: date ? x.due_time : null } : x)));
    void act(async () => { for (const m of list) await updateMemory(m.id, { due_on: date, due_time: date ? m.due_time : null, repeat_rule: date ? m.repeat_rule ?? null : null, status: statusFor({ place_id: m.place_id, due_on: date }) }); }).then(() => toast({ text: tn('bulk.moved', list.length) }));
  };

  const saved = (info: SavedInfo) => {
    setAdding(false);
    setAddDate(undefined);
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

  // Reorder mode: arrows on each row move it inside its own group (today, a day, a place, anytime).
  const move = (group: Memory[], m: Memory, dir: -1 | 1) => {
    const ups = moveStep(group, m.id, dir);
    if (!ups) return;
    setMemories((cur) => cur.map((x) => { const u = ups.find((y) => y.id === x.id); return u ? { ...x, sort_order: u.sort_order } : x; }));
    void act(() => setOrder(ups));
  };
  const reorderFor = (group: Memory[], m: Memory) => reordering && !m.pending
    ? { up: group[0]?.id === m.id ? undefined : () => move(group, m, -1), down: group[group.length - 1]?.id === m.id ? undefined : () => move(group, m, 1) } : undefined;

  const row = (m: Memory, opts: { place?: boolean; meta?: boolean; group?: Memory[] } = {}) => {
    const due = dueLabel(m, t, locale);
    return (
      <TodoRow key={m.id} m={m} photos={photos.get(m.id)} done={showDone} due={due || undefined} dueLate={!!m.due_on && m.due_on < todayISO()}
        place={opts.place ? placeName(m.place_id) : undefined} forName={members.length > 1 && m.assignee_id ? (m.assignee_id === userId ? t('row.forYou') : t('row.for', { name: members.find((x) => x.user_id === m.assignee_id)?.display_name || t('common.partner') })) : undefined} byline={opts.meta === false ? undefined : byline(m)}
        author={members.length > 1 && m.author_id !== userId ? { id: m.author_id, name: members.find((x) => x.user_id === m.author_id)?.display_name ?? null } : null}
        onToggle={() => toggle(m)} onEdit={() => setEditing(m)} onDelete={() => remove(m)}
        select={picking && !m.pending ? { on: picked.has(m.id), toggle: () => setPicked((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; }) } : undefined}
        onReschedule={m.pending ? undefined : () => setRescheduling(m)} onChecklist={(items) => tickStep(m, items)} reorder={opts.group ? reorderFor(opts.group, m) : undefined}>
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

  // "Tomorrow", then the weekday and date.
  const dayHeading = (iso: string) => (iso === addDays(todayISO(), 1) ? t('when.tomorrow') : formatDay(iso, locale));

  const section = (title: string, items: Memory[], opts?: { place?: boolean }) => items.length === 0 ? null : (
    <section className="group" aria-label={title}>
      <div className="label">{title}</div>
      <div className="card list">{items.map((m) => row(m, { place: opts?.place ?? true, group: items }))}</div>
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
        {(reordering ? items : shown).map((m) => row(m, { meta: items.length === 1, group: items }))}
        {!reordering && items.length > shown.length && <button className="link more" onClick={() => setOpenPlace({ id: placeId, label: name })}>{t('todo.moreAt', { n: items.length - shown.length })}</button>}
      </div>
    );
  };

  const seg = (
    <div className={`seg glass${mapOn ? '' : ' wide'}`} role="group" aria-label={t('view.label')}>
      {([['list', 'list'], ['calendar', 'calendar'], ['map', 'pin']] as const).map(([m, ic]) => <button key={m} aria-pressed={mode === m} aria-label={t(`view.${m}` as const)} title={t(`view.${m}` as const)} onClick={() => { setMode(m); setReordering(false); }}><Icon name={ic} size={18} /><span className="lbl">{t(`view.${m}` as const)}</span></button>)}
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
  const found = query.trim() ? matchTodos(memories, query, placeName, (m) => dueLabel(m, t, locale)) : null;

  return (
    <main className={`page${mapOn ? ' map-mode' : ''}`}>
      <div className="head"><h1 className={mapOn ? 'glass titlepill' : undefined}>{title}</h1><div className="row nowrap">{showDone && <button className="btn small icon glass on" aria-label={t('todo.back')} aria-pressed onClick={() => { setShowDone(false); setSearching(false); setQuery(''); }}><Icon name="check" size={16} /></button>}{!showDone && !mapOn && <button className="btn small icon glass" aria-label={t('search.open')} aria-pressed={searching} onClick={() => { setSearching((s) => !s); setQuery(''); }}><Icon name="search" size={16} /></button>}{mapOn && <button className={`btn small icon glass${route ? ' on' : ''}`} aria-label={t('route.open')} onClick={() => setPlanning(true)}><Icon name="navigate" size={16} /></button>}{!showDone && !mapOn && <button className="btn small icon glass" aria-label={t('more.label')} onClick={() => setMenu(true)}><Icon name="more" size={16} /></button>}{!showDone && mapOn && seg}</div></div>
      {!showDone && !mapOn && seg}
      {searching && !mapOn && !showDone && (
        <label className="searchfield"><Icon name="search" size={18} /><input autoFocus type="search" placeholder={t('search.placeholder')} value={query} onChange={(e) => setQuery(e.target.value)} />{query && <button type="button" className="mini" aria-label={t('search.clear')} onClick={() => setQuery('')}><Icon name="x" size={14} /></button>}</label>
      )}
      {!mapOn && !showDone && !searching && !reordering && (
        <div className="chips filter" role="group" aria-label={t('filter.label')}>
          <button type="button" className={`chipbtn${activeCount(filter) ? ' on' : ''}`} onClick={() => setFiltering(true)}><Icon name="filter" size={15} /> {t('filter.button')}{activeCount(filter) > 0 && ` · ${activeCount(filter)}`}</button>
          {filter.who !== 'all' && <button type="button" className="chipbtn pill" aria-label={t('filter.remove', { name: filter.who === 'mine' ? t('filter.mine') : t('filter.theirs', { name: partner?.display_name || t('common.partner') }) })} onClick={() => setFilter({ ...filter, who: 'all' })}>{filter.who === 'mine' ? t('filter.mine') : t('filter.theirs', { name: partner?.display_name || t('common.partner') })} <Icon name="x" size={12} /></button>}
          {filter.minPriority > 0 && <button type="button" className="chipbtn pill" aria-label={t('filter.remove', { name: t(`prio.${filter.minPriority}` as 'prio.1') })} onClick={() => setFilter({ ...filter, minPriority: 0 })}><Icon name="flag" size={12} /> {t(`prio.${filter.minPriority}` as 'prio.1')}+ <Icon name="x" size={12} /></button>}
          {filter.tag && <button type="button" className="chipbtn pill" aria-label={t('filter.remove', { name: `#${filter.tag}` })} onClick={() => setFilter({ ...filter, tag: null })}>#{filter.tag} <Icon name="x" size={12} /></button>}
          {activeCount(filter) === 0 && <button type="button" className="chipbtn route-chip" onClick={() => setPlanning(true)}><Icon name="navigate" size={15} /> {t('route.open')}</button>}
        </div>
      )}
      {reordering && !showDone && !mapOn && <div className="reorder-bar" role="status"><span>{t('reorder.hint')}</span><button className="btn small primary" onClick={() => setReordering(false)}>{t('reorder.done')}</button></div>}
      {(!online || loadFailed) && !mapOn && <p className="offline-banner" role="status">{t('offline.banner')}</p>}
      {err && (
        <p className="error" role="alert">{err} <button className="link" onClick={() => void load()}>{t('common.retry')}</button></p>
      )}

      {mapOn ? (
        <>
          <Suspense fallback={<div className="mapwrap"><div className="map" /></div>}>
            <TodoMap pins={pins} here={here} selectedKey={selectedKey} resolved={resolved} bottomInset={sheetH} onSelect={selectPin} onLocate={locate} onAdd={() => setAdding(true)} route={route} />
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
      ) : found ? (
        found.length === 0 ? <p className="muted" role="status">{t('search.none', { q: query.trim() })}</p> : (
          <section className="group"><div className="label">{tn('search.results', found.length)}</div><div className="card list">{found.map((m) => row(m, { place: true }))}</div></section>
        )
      ) : (
        <>
          <SetupChecklist household={household} onNavigate={onNavigate} />
          {memories.length > 0 && <InstallBanner />}
          <RecapCard household={household} members={members} refreshKey={doneTicks} />
          {mode === 'calendar' ? (
            <CalendarView memories={visible} row={(m) => row(m, { place: true })} onAdd={(d) => { setAddDate(d); setAdding(true); }} />
          ) : (<>
          {empty && (
            <div className="empty">
              <span className="empty-ico"><Icon name="check" size={28} /></span>
              <strong>{t('todo.empty.title')}</strong>
              <span className="muted">{t('todo.empty.body')}</span>
            </div>
          )}
          {lateOnes.length > 0 && (
            <div className="late-banner" role="status">
              <span>{tn('late.banner', lateOnes.length)}</span>
              <button className="btn small" onClick={moveLateToToday}>{t('late.moveToday')}</button>
            </div>
          )}
          {section(t('todo.sec.today'), groups.today)}
          {!empty && groups.today.length === 0 && <p className="muted quiet-line">{t('todo.nothingToday')}</p>}
          {groups.upcoming.map((g) => section(dayHeading(g.date), g.items))}
          {groups.byPlace.size > 0 && <div className="label">{t('todo.sec.place')}</div>}
          {[...groups.byPlace].map(([id, items]) => placeCard(id, items))}
          {section(t('todo.sec.anytime'), groups.anytime, { place: false })}
          {!empty && visible.length === 0 && activeCount(filter) > 0 && <p className="muted" role="status">{t('filter.none')}</p>}
          </>)}
        </>
      )}


      {mapOn && route && <button className="glass map-route-clear" onClick={() => setRoute(null)}><Icon name="x" size={14} /> {t('route.clear')}</button>}
      {picking && !showDone && !mapOn && (
        <div className="bulkbar glass" role="toolbar" aria-label={t('bulk.select')}>
          <span className="bulk-count">{picked.size > 0 ? tn('bulk.count', picked.size) : t('bulk.hint')}</span>
          <div className="row nowrap">
            <button className="btn small" disabled={picked.size === 0} onClick={bulkDone}><Icon name="check" size={14} /> {t('bulk.done')}</button>
            <button className="btn small" disabled={picked.size === 0} onClick={() => setBulkMove(true)}><Icon name="calendar" size={14} /> {t('bulk.move')}</button>
            <button className="btn small" disabled={picked.size === 0} onClick={bulkDelete}><Icon name="trash" size={14} /> {t('bulk.delete')}</button>
            <button className="btn small icon" aria-label={t('bulk.cancel')} onClick={endPicking}><Icon name="x" size={14} /></button>
          </div>
        </div>
      )}
      {bulkMove && <RescheduleSheet title={tn('bulk.count', picked.size)} dueOn={null} onPick={bulkMoveTo} onClose={() => setBulkMove(false)} />}
      {!showDone && !mapOn && !picking && <AddBar onClick={() => setAdding(true)} />}
      {adding && <TodoSheet household={household} places={places} members={members} userId={userId} initialBody={sharedText ?? undefined} initialDate={addDate} onClose={() => { setAdding(false); setSharedText(null); setAddDate(undefined); }} onSaved={saved} />}
      {filtering && <FilterSheet value={filter} onChange={setFilter} partnerName={partner ? partner.display_name || t('common.partner') : null} tags={tagList} onClose={() => setFiltering(false)} />}
      {menu && (
        <Sheet label={t('more.label')} onClose={() => setMenu(false)}>
          <div className="resched">
            <button className="btn" onClick={() => { setMenu(false); setShowDone(true); setSearching(false); setQuery(''); }}><Icon name="check" size={16} /> {t('more.done')}</button>
            <button className="btn" onClick={() => { setMenu(false); setMode('list'); setReordering(false); setPicking(true); }}><Icon name="check" size={16} /> {t('bulk.select')}</button>
            <button className="btn" onClick={() => { setMenu(false); setMode('list'); setReordering(true); }}><Icon name="up" size={16} /> {t('more.reorder')}</button>
            <button className="btn" onClick={() => { setMenu(false); setPlanning(true); }}><Icon name="navigate" size={16} /> {t('more.route')}</button>
          </div>
        </Sheet>
      )}
      {rescheduling && <RescheduleSheet title={(rescheduling.body || t('todo.photo')).split('\n')[0]} dueOn={rescheduling.due_on} onPick={(d) => moveTo(rescheduling, d)} onClose={() => setRescheduling(null)} />}
      {planning && <RouteSheet places={places} memories={memories} onClose={() => setPlanning(false)} onShow={(r) => { setRoute(r); setMode('map'); setShowDone(false); setSnap('peek'); }} />}
      {tour && <Tour household={household} onClose={() => setTour(false)} onChanged={() => { void load(); loadPlaces(); }} />}
      {editing && <TodoSheet key={editing.id} household={household} places={places} members={members} userId={userId} memory={editing} photos={photos.get(editing.id)} onClose={() => setEditing(null)} onSaved={saved} onDelete={remove} />}
      {openPlace && (
        <ErrorBoundary key={openPlace.id} label={t('common.error')} closeLabel={t('common.close')} reloadLabel={t('error.reload')} onClose={() => setOpenPlace(null)}>
          <PlaceSheet household={household} placeId={openPlace.id} label={openPlace.label} onClose={() => setOpenPlace(null)} onChanged={() => void load()} onEdit={(m) => setEditing(m)} />
        </ErrorBoundary>
      )}
    </main>
  );
}
