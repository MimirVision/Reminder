import { useEffect, useMemo, useState } from 'react';
import { distanceM, fetchPois, type LatLon } from '../lib/geo';
import { placeLabel } from '../lib/labels';
import { appleRouteUrl, dwellMinutes, evaluateOrder, fmtClock, googleRouteUrl, planRoute, type Matrix, type Stop } from '../lib/route';
import { driveLine, driveMatrix } from '../lib/routing';
import { useHere } from '../lib/useHere';
import { todayISO } from '../lib/when';
import type { Memory, Place } from '../lib/types';
import { useI18n } from '../i18n';
import { Icon } from './icons';
import { Sheet } from './Sheet';

export type RouteView = { line: [number, number][]; stops: { lat: number; lon: number; n: number }[] };

type StopMeta = Stop & { placeId: string; name: string; point: LatLon; tasks: Memory[]; category: string | null };
type Calc = { metas: StopMeta[]; matrix: Matrix; start: LatLon; end: LatLon; estimated: boolean; startMin: number; weekday: number; skipped: string[] };

const HOME = /(home|hjem|huset|house)/i;
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// Plan the day's drive: tick the places, choose where to start and finish, and get the order that gets it all done soonest.
export function RouteSheet({ places, memories, onClose, onShow }: { places: Place[]; memories: Memory[]; onClose: () => void; onShow: (r: RouteView) => void }) {
  const { t, tn } = useI18n();
  const { here, state, locate } = useHere(true);

  const open = useMemo(() => memories.filter((m) => m.status !== 'done' && m.place_id), [memories]);
  const candidates = useMemo(() => places.filter((p) => open.some((m) => m.place_id === p.id) && (p.kind === 'category' || (p.lat != null && p.lon != null))), [places, open]);
  const fixed = useMemo(() => places.filter((p) => p.kind === 'fixed' && p.lat != null && p.lon != null), [places]);
  const home = useMemo(() => fixed.find((p) => HOME.test(p.name)), [fixed]);

  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.map((p) => p.id)));
  const [start, setStart] = useState<string>('here');
  const [end, setEnd] = useState<string>(home?.id ?? 'start');
  const [depart, setDepart] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [calc, setCalc] = useState<Calc | null>(null);
  const [dwell, setDwell] = useState<Record<string, number>>({});

  useEffect(() => { setPicked((cur) => (cur.size === 0 ? new Set(candidates.map((p) => p.id)) : cur)); }, [candidates]);

  const flip = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pointOf = (id: string): LatLon | null => { const p = fixed.find((x) => x.id === id); return p ? { lat: p.lat as number, lon: p.lon as number } : null; };

  async function prepare() {
    setErr(null);
    const startPt = start === 'here' ? here : pointOf(start);
    if (!startPt) { setErr(t('route.needLocation')); if (start === 'here') locate(); return; }
    const endPt = end === 'start' ? startPt : pointOf(end) ?? startPt;
    const chosen = candidates.filter((p) => picked.has(p.id));
    if (chosen.length === 0) { setErr(t('route.pickOne')); return; }
    setBusy(true);
    try {
      const today = todayISO();
      const metas: StopMeta[] = [];
      const skipped: string[] = [];
      for (const p of chosen) {
        const tasks = open.filter((m) => m.place_id === p.id);
        let point: LatLon | null = p.kind === 'fixed' ? { lat: p.lat as number, lon: p.lon as number } : null;
        let name = placeLabel(p, t);
        if (!point && p.category) {
          // "Any pharmacy": the one nearest the start.
          const pois = await fetchPois(p.category, startPt).catch(() => []);
          const near = pois.map((poi) => ({ poi, d: distanceM(startPt, poi) })).sort((a, b) => a.d - b.d)[0]?.poi;
          if (near) { point = { lat: near.lat, lon: near.lon }; name = `${name} · ${near.name}`; }
        }
        if (!point) { skipped.push(name); continue; }
        const times = tasks.filter((m) => m.due_on === today && m.due_time).map((m) => toMin(m.due_time as string));
        metas.push({ id: p.id, placeId: p.id, name, point, tasks, category: p.category, dwellMin: dwellMinutes(p.category, tasks.length), byMin: times.length ? Math.min(...times) : null });
      }
      if (metas.length === 0) { setErr(t('route.pickOne')); setBusy(false); return; }
      const { matrix, estimated } = await driveMatrix([startPt, ...metas.map((m) => m.point), endPt]);
      const now = new Date();
      setDwell({});
      setCalc({ metas, matrix, start: startPt, end: endPt, estimated, startMin: depart ? toMin(depart) : now.getHours() * 60 + now.getMinutes(), weekday: now.getDay(), skipped });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const solved = useMemo(() => {
    if (!calc) return null;
    const stops: Stop[] = calc.metas.map((m) => ({ id: m.id, dwellMin: dwell[m.id] ?? m.dwellMin, byMin: m.byMin }));
    const plan = planRoute(calc.matrix, stops, calc.startMin, calc.weekday);
    const naive = evaluateOrder(stops.map((_, i) => i), calc.matrix, stops, calc.startMin, calc.weekday);
    return { plan, stops, saved: Math.round(naive.endMin - plan.endMin) };
  }, [calc, dwell]);

  const ordered = calc && solved ? solved.plan.order.map((i) => calc.metas[i]) : [];
  const pts = calc ? [calc.start, ...ordered.map((m) => m.point), calc.end] : [];

  async function show() {
    if (!calc) return;
    const line = (await driveLine(pts)) ?? [];
    onShow({ line, stops: ordered.map((m, i) => ({ lat: m.point.lat, lon: m.point.lon, n: i + 1 })) });
    onClose();
  }

  const bump = (m: StopMeta, by: number) => setDwell((d) => ({ ...d, [m.id]: Math.max(0, Math.min(120, (d[m.id] ?? m.dwellMin) + by)) }));

  return (
    <Sheet label={t('route.title')} onClose={onClose} tall>
      <div className="row spread">
        <h2>{calc ? t('route.result') : t('route.title')}</h2>
        <button className="btn small icon" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={16} /></button>
      </div>

      {!calc || !solved ? (
        <>
          <p className="muted">{t('route.intro')}</p>
          {candidates.length === 0 ? <p className="muted">{t('route.noPlaces')}</p> : (
            <>
              <div className="label">{t('route.stops')}</div>
              <div className="card">
                {candidates.map((p) => {
                  const tasks = open.filter((m) => m.place_id === p.id);
                  return (
                    <label key={p.id} className="route-pick">
                      <span className="row checkrow">
                        <input type="checkbox" checked={picked.has(p.id)} onChange={() => flip(p.id)} />
                        <strong>{placeLabel(p, t)}</strong>
                        <span className="chip plain">{tn('map.todos', tasks.length)}</span>
                      </span>
                      <span className="muted">{tasks.slice(0, 3).map((m) => (m.body || t('todo.photo')).split('\n')[0]).join(' · ')}</span>
                    </label>
                  );
                })}
              </div>
              <div className="label">{t('route.start')}</div>
              <select value={start} onChange={(e) => setStart(e.target.value)} aria-label={t('route.start')}>
                <option value="here">{t('route.here')}</option>
                {fixed.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {start === 'here' && !here && state !== 'unsupported' && (
                state === 'denied' ? <p className="muted">{t('map.locationOff')}</p> : <button className="btn small" onClick={locate}><Icon name="locate" size={15} /> {t('route.allowLocation')}</button>
              )}
              <div className="label">{t('route.end')}</div>
              <select value={end} onChange={(e) => setEnd(e.target.value)} aria-label={t('route.end')}>
                <option value="start">{t('route.sameStart')}</option>
                {fixed.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="label">{t('route.depart')}</div>
              <div className="chips">
                <button type="button" className={`chipbtn${depart === '' ? ' on' : ''}`} aria-pressed={depart === ''} onClick={() => setDepart('')}>{t('route.now')}</button>
                <label className={`chipbtn timebtn${depart ? ' on' : ''}`}><Icon name="clock" size={16} /> {t('route.at')} <input type="time" value={depart} onChange={(e) => setDepart(e.target.value)} /></label>
              </div>
              {err && <p className="error" role="alert">{err}</p>}
              <button className="btn primary big" disabled={busy || picked.size === 0} onClick={() => void prepare()}>{busy ? t('route.planning') : t('route.plan')}</button>
            </>
          )}
        </>
      ) : (
        <>
          <div className="route-sum">
            <span>{t('route.summary', { time: fmtClock(solved.plan.endMin) })}</span>
            <span className="muted">{t('route.drive', { n: Math.round(solved.plan.driveMin) })}</span>
            <span className="muted">{t('route.stopsTotal', { n: Math.round(solved.plan.stopMin) })}</span>
          </div>
          {solved.saved >= 1 && ordered.length > 1 && <p className="muted">{t('route.saved', { n: solved.saved })}</p>}
          {calc.estimated && <p className="muted" role="status">{t('route.estimated')}</p>}
          {calc.skipped.map((n) => <p key={n} className="muted">{t('route.noShop', { place: n })}</p>)}
          <div className="card">
            {ordered.map((m, i) => {
              const late = Math.round(solved.plan.late[i]);
              return (
                <div className="route-stop" key={m.id}>
                  <span className="num">{i + 1}</span>
                  <div className="main">
                    <span className="eta">{fmtClock(solved.plan.arriveMin[i])} · {m.name}</span>
                    <span className="muted">{t('route.legTo', { n: Math.round(solved.plan.legMin[i]) })} · {t('route.mins', { n: dwell[m.id] ?? m.dwellMin })}</span>
                    <span>{m.tasks.slice(0, 4).map((x) => (x.body || t('todo.photo')).split('\n')[0]).join(' · ')}</span>
                    {m.byMin != null && <span className={late > 0 ? 'warn' : 'muted'}>{late > 0 ? t('route.late', { time: fmtClock(solved.plan.arriveMin[i]), n: late }) : t('route.by', { time: fmtClock(m.byMin) })}</span>}
                    <span className="stepper">
                      <button type="button" aria-label={t('route.shorter', { place: m.name })} onClick={() => bump(m, -5)}>−</button>
                      <button type="button" aria-label={t('route.longer', { place: m.name })} onClick={() => bump(m, 5)}>+</button>
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="route-stop">
              <span className="num end"><Icon name="check" size={14} /></span>
              <div className="main">
                <span className="eta">{fmtClock(solved.plan.endMin)}</span>
                <span className="muted">{t('route.legTo', { n: Math.round(solved.plan.legMin[solved.plan.legMin.length - 1]) })}</span>
              </div>
            </div>
          </div>
          <button className="btn primary big" onClick={() => void show()}><Icon name="pin" size={16} /> {t('route.showMap')}</button>
          <div className="label">{t('route.openIn')}</div>
          <div className="row">
            <a className="btn" target="_blank" rel="noreferrer" href={googleRouteUrl(calc.start, ordered.map((m) => m.point), calc.end)}><Icon name="navigate" size={15} /> {t('route.google')}</a>
            <a className="btn" target="_blank" rel="noreferrer" href={appleRouteUrl(calc.start, ordered.map((m) => m.point), calc.end)}><Icon name="navigate" size={15} /> {t('route.apple')}</a>
          </div>
          <p className="muted hint">{t('route.note')}</p>
          <button className="link" onClick={() => setCalc(null)}>{t('route.change')}</button>
        </>
      )}
    </Sheet>
  );
}
