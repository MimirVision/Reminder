import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { listRecentDone } from '../lib/api';
import { agoParts, dayProgress, isoWeek, overviewStats, partOfDay, skyOf } from '../lib/command';
import type { LatLon } from '../lib/geo';
import type { MapPin } from '../lib/pins';
import { compareTodos, isLate } from '../lib/todoGroups';
import type { Household, Memory, Member, Place } from '../lib/types';
import { addDays, todayISO } from '../lib/when';
import { loadForecast, type DayForecast, type WeatherAlert, type WeatherDone, type WeatherPlace } from '../lib/weather';
import { useI18n } from '../i18n';
import { Avatar } from './Avatar';
import { CalendarView } from './CalendarView';
import { Icon } from './icons';
import { WeatherCard } from './WeatherCard';
import { WeekBoard } from './WeekBoard';

const TodoMap = lazy(() => import('./TodoMap'));

export type PlaceCount = { placeId: string; label: string; count: number };

type Props = {
  household: Household; userId: string;
  /** Everything open (for the numbers) and what the filter lets through (for the lists). */
  all: Memory[]; visible: Memory[]; members: Member[]; places: Place[];
  row: (m: Memory, o?: { place?: boolean; meta?: boolean }) => ReactNode;
  onToggle: (m: Memory) => void; onEdit: (m: Memory) => void; onMove: (m: Memory, date: string | null) => void; onAdd: (date?: string) => void;
  moveLate: () => void;
  weather: { active: WeatherAlert[]; done: WeatherDone[]; home: WeatherPlace | null; tick: (a: WeatherAlert, item: string) => void };
  attention: { houseDue: number; warranties: { name: string; days: number }[]; prep: number };
  onNavigate: (tab: 'house' | 'settings', houseMode?: string) => void;
  map: { pins: MapPin[]; here: LatLon | null; selectedKey: string | null; resolved: 'light' | 'dark'; onSelect: (p: MapPin) => void; onLocate: () => void };
  byPlace: Map<string, Memory[]>; anytime: Memory[]; placeName: (id: string | null) => string | undefined; onOpenPlace: (id: string, label: string) => void;
  /** Bumped when something is finished here, so the activity list refreshes. */
  refreshKey: number;
  /** The view switch (list, calendar, week, overview, map) from the to-do screen. */
  switcher: ReactNode; onShortcuts: () => void;
};

function Panel({ id, title, aside, children, onDrop }: { id: string; title: string; aside?: ReactNode; children: ReactNode; onDrop?: (e: React.DragEvent) => void }) {
  const [over, setOver] = useState(false);
  return (
    <section className={`cmd-panel cmd-${id}${over ? ' drop' : ''}`} aria-label={title}
      onDragOver={onDrop ? (e) => { e.preventDefault(); setOver(true); } : undefined} onDragLeave={onDrop ? () => setOver(false) : undefined}
      onDrop={onDrop ? (e) => { setOver(false); onDrop(e); } : undefined}>
      <header className="cmd-ph"><h2>{title}</h2>{aside}</header>
      <div className="cmd-pb">{children}</div>
    </section>
  );
}

function Ring({ value, label }: { value: number; label: string }) {
  const r = 22; const c = 2 * Math.PI * r;
  return (
    <svg className="cmd-ring" viewBox="0 0 56 56" width="56" height="56" role="img" aria-label={label}>
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${c * value} ${c}`} transform="rotate(-90 28 28)" />
      <text x="28" y="33" textAnchor="middle" fontSize="14" fontWeight="700" fill="currentColor">{Math.round(value * 100)}</text>
    </svg>
  );
}

/** The overview board for a very wide screen: today, the week, the map, the weather, the calendar, places and what was just finished, all at once. */
export function CommandCenter(p: Props) {
  const { t, tn, locale } = useI18n();
  const [now, setNow] = useState(() => new Date());
  const [done, setDone] = useState<Awaited<ReturnType<typeof listRecentDone>>>([]);
  const [forecast, setForecast] = useState<DayForecast[] | null>(null);
  const [wall, setWall] = useState(false);
  const today = todayISO(now);

  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 15_000); return () => window.clearInterval(id); }, []);
  useEffect(() => { listRecentDone(p.household.id, 40).then(setDone).catch(() => {}); }, [p.household.id, p.refreshKey, p.all.length]);

  const home = p.weather.home;
  useEffect(() => {
    if (!home) { setForecast(null); return; }
    let live = true;
    loadForecast(home.lat, home.lon).then((d) => live && setForecast(d)).catch(() => live && setForecast([]));
    return () => { live = false; };
  }, [home?.id, home?.lat, home?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wall mode: the board alone, full screen, for a screen you leave on.
  useEffect(() => {
    document.body.classList.toggle('wall', wall);
    const sync = () => { if (!document.fullscreenElement) setWall(false); };
    document.addEventListener('fullscreenchange', sync);
    return () => { document.removeEventListener('fullscreenchange', sync); document.body.classList.remove('wall'); };
  }, [wall]);
  const toggleWall = () => {
    if (!wall) { setWall(true); void document.documentElement.requestFullscreen?.().catch(() => {}); }
    else { setWall(false); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }
  };

  const open = useMemo(() => p.all.filter((m) => !m.pending), [p.all]);
  const stats = useMemo(() => overviewStats(open, today), [open, today]);
  const doneToday = done.filter((d) => d.done_at && d.done_at.slice(0, 10) >= today && new Date(d.done_at).toDateString() === now.toDateString()).length;
  const doneWeek = done.filter((d) => d.done_at && now.getTime() - new Date(d.done_at).getTime() < 7 * 86_400_000).length;
  const progress = dayProgress(doneToday, stats);

  const vis = useMemo(() => p.visible.filter((m) => !m.pending), [p.visible]);
  const late = useMemo(() => vis.filter((m) => isLate(m, today)).sort(compareTodos), [vis, today]);
  const todays = useMemo(() => vis.filter((m) => m.due_on === today).sort(compareTodos), [vis, today]);
  const tomorrow = useMemo(() => vis.filter((m) => m.due_on === addDays(today, 1)).sort((a, b) => (a.due_time ?? '99').localeCompare(b.due_time ?? '99') || compareTodos(a, b)), [vis, today]);

  const me = p.members.find((m) => m.user_id === p.userId)?.display_name;
  const greet = `${t(`cmd.${partOfDay(now.getHours())}` as 'cmd.morning')}${me ? `, ${me}` : ''}`;
  const ago = (iso: string) => { const a = agoParts(iso); return a.unit === 'now' ? t('time.now') : a.unit === 'min' ? t('time.min', { n: a.n }) : a.unit === 'hour' ? t('time.hour', { n: a.n }) : t('cmd.daysAgo', { n: a.n }); };
  const dropToday = (e: React.DragEvent) => { const m = open.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (m && m.due_on !== today) p.onMove(m, today); };

  const week = forecast?.filter((d) => d.date >= today).slice(0, 7) ?? [];
  const placeGroups = [...p.byPlace].map(([id, items]) => ({ id, label: p.placeName(id) ?? t('todo.somewhere'), items })).sort((a, b) => b.items.length - a.items.length);
  const att = p.attention;
  const hasAttention = att.houseDue > 0 || att.warranties.length > 0 || att.prep > 0;

  return (
    <div className="cmd">
      <header className="cmd-head">
        <div className="cmd-clock" aria-live="off">
          <span className="cmd-time">{now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="cmd-date"><strong>{now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</strong><span className="muted">{t('cmd.week', { n: isoWeek(now) })}</span></span>
        </div>
        <div className="cmd-greet"><strong>{greet}</strong>
          <span className="muted">{stats.late > 0 ? tn('late.banner', stats.late) : stats.today > 0 ? t('cmd.progress', { done: doneToday, total: doneToday + stats.today + stats.late }) : t('cmd.clear')}</span>
        </div>
        <dl className="cmd-stats">
          <div className={stats.late > 0 ? 'warn' : ''}><dt>{t('cmd.stat.late')}</dt><dd>{stats.late}</dd></div>
          <div><dt>{t('cmd.stat.today')}</dt><dd>{stats.today}</dd></div>
          <div><dt>{t('cmd.stat.next7')}</dt><dd>{stats.next7}</dd></div>
          <div><dt>{t('cmd.stat.open')}</dt><dd>{stats.open}</dd></div>
          <div><dt>{t('cmd.stat.done')}</dt><dd>{doneWeek}</dd></div>
        </dl>
        {hasAttention && (
          <div className="cmd-attn" role="group" aria-label={t('cmd.attention')}>
            {att.houseDue > 0 && <button type="button" className="chipbtn" onClick={() => p.onNavigate('house')}><Icon name="house" size={14} />{tn('housecard.due', att.houseDue)}</button>}
            {att.warranties.length > 0 && <button type="button" className="chipbtn" onClick={() => p.onNavigate('house', 'Register')}><Icon name="clock" size={14} />{t('warr.card', { names: att.warranties.map((w) => t('warr.cardDays', { name: w.name, n: w.days })).join(', ') })}</button>}
            {att.prep > 0 && <button type="button" className="chipbtn" onClick={() => p.onNavigate('house', 'Prep')}><Icon name="clock" size={14} />{tn('prep.todoCard', att.prep)}</button>}
          </div>
        )}
        <div className="cmd-actions">
          <button type="button" className="btn primary" onClick={() => p.onAdd()}><Icon name="plus" size={16} />{t('cmd.new')}<kbd>N</kbd></button>
          {p.switcher}
          <button type="button" className="btn small icon" aria-label={t('cmd.keys')} title={t('cmd.keys')} onClick={p.onShortcuts}><kbd>?</kbd></button>
          <button type="button" className={`btn small${wall ? ' primary' : ''}`} aria-pressed={wall} onClick={toggleWall}><Icon name="expand" size={15} />{wall ? t('cmd.wallExit') : t('cmd.wall')}</button>
        </div>
      </header>

      <Panel id="today" title={t('cmd.today')} onDrop={dropToday} aside={<Ring value={progress} label={t('cmd.progress', { done: doneToday, total: doneToday + stats.today + stats.late })} />}>
        {late.length > 0 && (
          <div className="cmd-group">
            <div className="label warm">{t('cmd.late')} <button type="button" className="link" onClick={p.moveLate}>{t('late.moveToday')}</button></div>
            <div className="card list">{late.map((m) => p.row(m, { place: true }))}</div>
          </div>
        )}
        <div className="cmd-group">
          <div className="card list">{todays.length === 0 ? <span className="muted pad">{t('todo.nothingToday')}</span> : todays.map((m) => p.row(m, { place: true }))}</div>
        </div>
        {tomorrow.length > 0 && (
          <div className="cmd-group">
            <div className="label">{t('when.tomorrow')}</div>
            <div className="card list">{tomorrow.map((m) => p.row(m, { place: true }))}</div>
          </div>
        )}
        <p className="cmd-hint muted">{t('cmd.dropToday')}</p>
      </Panel>

      <Panel id="week" title={t('view.week')}>
        <WeekBoard memories={vis} onMove={p.onMove} onEdit={p.onEdit} onToggle={p.onToggle} onAdd={(d) => p.onAdd(d)} />
      </Panel>

      <Panel id="map" title={t('view.map')}>
        <div className="cmd-mapbox">
          <Suspense fallback={<div className="map" />}>
            <TodoMap pins={p.map.pins} here={p.map.here} selectedKey={p.map.selectedKey} resolved={p.map.resolved} bottomInset={0} onSelect={p.map.onSelect} onLocate={p.map.onLocate} onAdd={() => p.onAdd()} />
          </Suspense>
        </div>
      </Panel>

      <Panel id="weather" title={home ? `${t('cmd.weather')} · ${home.name}` : t('cmd.weather')}>
        {!home ? (
          <p className="muted">{t('cmd.noHome')} <button type="button" className="link" onClick={() => p.onNavigate('settings')}>{t('nav.settings')}</button></p>
        ) : forecast === null ? <span className="muted">{t('common.loading')}</span> : week.length === 0 ? <span className="muted">{t('cmd.noForecast')}</span> : (
          <ol className="cmd-fc">
            {week.map((d, i) => {
              const sky = skyOf(d.code);
              const wet = d.snowCm > 0.1 ? `${Math.round(d.snowCm)} cm` : d.rainMm >= 0.2 ? `${Math.round(d.rainMm * 10) / 10} mm` : '';
              return (
                <li key={d.date} className={i === 0 ? 'today' : ''} title={t(`cmd.sky.${sky.kind}` as 'cmd.sky.clear')}>
                  <span className="cmd-fd">{i === 0 ? t('when.today') : new Date(`${d.date}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' })}</span>
                  <span className="cmd-fg" aria-hidden="true">{sky.glyph}</span>
                  <strong>{Math.round(d.tMax)}°</strong><span className="muted">{Math.round(d.tMin)}°</span>
                  <span className={`cmd-wet${wet ? '' : ' none'}`}>{wet || '–'}</span>
                  <span className="muted cmd-wind">{Math.round(d.windMs)} m/s</span>
                  <span className="sr-only">{t(`cmd.sky.${sky.kind}` as 'cmd.sky.clear')}</span>
                </li>
              );
            })}
          </ol>
        )}
        <WeatherCard alerts={p.weather.active} done={p.weather.done} onTick={p.weather.tick} />
      </Panel>

      <Panel id="cal" title={t('view.calendar')}>
        <CalendarView memories={vis} row={(m) => p.row(m, { place: true })} onAdd={(d) => p.onAdd(d)} onMove={(id, d) => { const m = open.find((x) => x.id === id); if (m && m.due_on !== d) p.onMove(m, d); }} />
      </Panel>

      <Panel id="places" title={t('cmd.places')}>
        {placeGroups.length === 0 && p.anytime.length === 0 && <p className="muted">{t('cmd.noPlaces')}</p>}
        {placeGroups.map((g) => (
          <div className="card list" key={g.id}>
            <div className="row spread cardhead">
              <span className="chip"><Icon name="pin" size={13} />{g.label}</span>
              <button type="button" className="link" onClick={() => p.onOpenPlace(g.id, g.label)}>{t('todo.openList')}</button>
            </div>
            {g.items.slice(0, 4).map((m) => p.row(m, { meta: false }))}
            {g.items.length > 4 && <button type="button" className="link more" onClick={() => p.onOpenPlace(g.id, g.label)}>{t('todo.moreAt', { n: g.items.length - 4 })}</button>}
          </div>
        ))}
        {p.anytime.length > 0 && (
          <div className="cmd-group"><div className="label">{t('todo.sec.anytime')}</div><div className="card list">{p.anytime.slice(0, 12).map((m) => p.row(m, { place: false }))}</div></div>
        )}
      </Panel>

      <Panel id="activity" title={t('cmd.activity')}>
        {done.length === 0 ? <p className="muted">{t('cmd.activityEmpty')}</p> : (
          <ul className="cmd-act">
            {done.slice(0, 24).map((d) => {
              const by = d.done_by ?? d.author_id;
              const name = p.members.find((m) => m.user_id === by)?.display_name ?? null;
              return (
                <li key={d.id}>
                  {p.members.length > 1 ? <Avatar id={by} name={name} size={22} /> : <span className="cmd-tick" aria-hidden="true"><Icon name="check" size={12} /></span>}
                  <span className="cmd-at">{(d.body || t('todo.photo')).split('\n')[0]}</span>
                  <span className="muted">{d.done_at ? ago(d.done_at) : ''}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
