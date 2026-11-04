import { useState } from 'react';
import { deleteWeatherPlace, deleteWeatherRule, saveWeatherPlace, saveWeatherRule } from '../lib/api';
import { useI18n } from '../i18n';
import { SCENARIOS, SCENARIO_DEFAULT, nextAlert, reasonText, ruleSummary, starterRule, thresholdOf, type DayForecast, type Frequency, type Lead, type RuleDraft, type Scenario, type WeatherPlace, type WeatherRule } from '../lib/weather';
import { isoOf } from '../lib/weather';
import { useWeather } from '../lib/useWeather';
import type { Household } from '../lib/types';
import { AddressPicker } from './AddressPicker';
import { Icon } from './icons';
import { Sheet } from './Sheet';

const TIMES = ['06:00', '07:00', '07:30', '08:00', '09:00', '12:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
type Addr = { name: string; address: string; lat: number; lon: number };

/** One line per day: "Tue 27 Oct · 3–9°C · rain 6 mm · wind 8 m/s". */
function dayLine(d: DayForecast, locale: string): string {
  const date = new Date(+d.date.slice(0, 4), +d.date.slice(5, 7) - 1, +d.date.slice(8, 10)).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const parts = [`${Math.round(d.tMin)}–${Math.round(d.tMax)}°C`];
  if (d.rainMm >= 0.5) parts.push(`${Math.round(d.rainMm * 10) / 10} mm`);
  if (d.snowCm >= 0.5) parts.push(`${Math.round(d.snowCm * 10) / 10} cm`);
  if (d.windMs >= 8) parts.push(`${Math.round(d.windMs)} m/s`);
  return `${date} · ${parts.join(' · ')}`;
}

// Settings > Weather: Home (set once), other places (only if you add them), the rules, and a look at the forecast so you can see why a rule did or did not fire.
export function WeatherSettings({ household }: { household: Household }) {
  const { t, locale } = useI18n();
  const w = useWeather(household.id);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [picking, setPicking] = useState(false);
  const [placeFor, setPlaceFor] = useState<'home' | 'other' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const others = w.places.filter((p) => !p.is_home);
  const today = isoOf(new Date());
  const homeForecast = w.home ? w.forecasts[w.home.id] ?? [] : [];

  const run = async (fn: () => Promise<void>) => { try { setErr(null); await fn(); await w.reload(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const nameOf = (id: string) => (id === w.userId ? t('weather.ownerMe') : w.members.find((m) => m.user_id === id)?.display_name ?? '?');
  const placeName = (r: WeatherRule) => (r.place_id ? w.places.find((p) => p.id === r.place_id)?.name : undefined);

  const saveHome = (h: Addr) => run(async () => {
    await saveWeatherPlace(household.id, { id: w.home?.id, name: w.home?.name ?? t('weather.home'), address: h.address || h.name || null, lat: h.lat, lon: h.lon, is_home: true });
    setPlaceFor(null);
  });

  if (w.needsUpgrade) return <section className="card"><p className="error" role="alert">{t('weather.noTable')}</p></section>;

  return (
    <>
      {(w.error || err) && <p className="error" role="alert">{w.error ?? err}</p>}

      <section className="card">
        <h2>{t('weather.homeTitle')}</h2>
        <div className="row spread">
          <span><strong>{t('weather.home')}</strong><br /><span className="muted">{w.home ? w.home.address ?? `${w.home.lat.toFixed(3)}, ${w.home.lon.toFixed(3)}` : t('weather.homeNone')}</span></span>
          <button className={`btn small${w.home ? '' : ' primary'}`} onClick={() => setPlaceFor('home')}>{w.home ? t('weather.homeChange') : t('weather.homeSetBtn')}</button>
        </div>
        {!w.home && <span className="muted">{t('weather.homeHelp')}</span>}
        <h3 className="sub">{t('weather.morePlaces')}</h3>
        {others.length === 0 && <span className="muted">{t('weather.morePlacesHelp')}</span>}
        {others.map((p) => (
          <div key={p.id} className="row spread">
            <span><strong>{p.name}</strong><br /><span className="muted">{p.address ?? `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`}</span></span>
            <button className="btn small danger" onClick={() => confirm(t('weather.removePlaceAsk')) && void run(() => deleteWeatherPlace(p.id))}>{t('weather.removePlace')}</button>
          </div>
        ))}
        <div className="row"><button className="btn small" onClick={() => setPlaceFor('other')}><Icon name="plus" size={14} /> {t('weather.addPlace')}</button></div>
      </section>

      <section className="card">
        <h2>{t('weather.rules')}</h2>
        <span className="muted">{t('weather.intro')}</span>
        {w.rules?.length === 0 && <p className="muted">{t('weather.empty')}</p>}
        <ul className="wx-rules">
          {(w.rules ?? []).map((r) => {
            const next = nextAlert(w.alerts, r.id, today);
            return (
              <li key={r.id}>
                <button className="wx-rule" onClick={() => setDraft(r)} aria-label={`${t('weather.edit')}: ${r.name}`}>
                  <strong>{r.name}</strong>
                  <span className="muted">{ruleSummary(t, r)}{placeName(r) ? ` · ${placeName(r)}` : ''}{r.owner_id ? ` · ${t('weather.ownerChip', { name: nameOf(r.owner_id) })}` : ''}</span>
                  {r.enabled && w.home && (next
                    ? <span className="muted">{t('weather.next', { reason: reasonText(t, next, new Date(+next.forDate.slice(0, 4), +next.forDate.slice(5, 7) - 1, +next.forDate.slice(8, 10)).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })) })}</span>
                    : <span className="muted">{t('weather.nextNone')}</span>)}
                  {r.enabled && !w.home && <span className="muted">{t('weather.noHomeRule')}</span>}
                </button>
                <input type="checkbox" className="switch" checked={r.enabled} aria-label={`${t('weather.enabled')}: ${r.name}`} onChange={() => void run(() => saveWeatherRule(household.id, { ...r, enabled: !r.enabled }))} />
              </li>
            );
          })}
        </ul>
        <div className="row"><button className="btn small primary" onClick={() => setPicking(true)}><Icon name="plus" size={14} /> {t('weather.add')}</button></div>
      </section>

      <section className="card">
        <h2>{t('weather.forecastTitle', { place: w.home?.name ?? t('weather.home') })}</h2>
        {!w.home ? <span className="muted">{t('weather.forecastHome')}</span> : w.forecastError ? <span className="error">{t('weather.forecastFail')} ({w.forecastError})</span>
          : homeForecast.length === 0 ? <span className="muted">{t('weather.forecastNone')}</span>
          : <ul className="wx-days">{homeForecast.filter((d) => d.date >= today).slice(0, 6).map((d) => <li key={d.date}>{dayLine(d, locale)}</li>)}</ul>}
      </section>

      {placeFor && (
        <PlaceSheet title={placeFor === 'home' ? t('weather.homeSetBtn') : t('weather.addPlace')} askName={placeFor === 'other'} onClose={() => setPlaceFor(null)}
          onSave={(h, name) => placeFor === 'home' ? saveHome(h) : run(async () => { await saveWeatherPlace(household.id, { name, address: h.address || h.name || null, lat: h.lat, lon: h.lon, is_home: false }); setPlaceFor(null); })} />
      )}
      {picking && (
        <Sheet label={t('weather.add')} onClose={() => setPicking(false)}>
          <div className="row spread"><h2>{t('weather.template')}</h2><button className="btn small icon" onClick={() => setPicking(false)} aria-label={t('common.close')}><Icon name="x" size={16} /></button></div>
          <div className="chips">
            {SCENARIOS.map((s) => <button key={s} className="chipbtn" onClick={() => { setPicking(false); setDraft(starterRule(t, s)); }}>{t(`weather.s.${s}` as 'weather.s.rain')}</button>)}
          </div>
        </Sheet>
      )}
      {draft && <RuleSheet draft={draft} members={w.members} userId={w.userId} others={others} onClose={() => setDraft(null)}
        onSave={async (d) => { await saveWeatherRule(household.id, d); setDraft(null); await w.reload(); }}
        onDelete={draft.id ? async () => { if (confirm(t('weather.deleteAsk'))) { await deleteWeatherRule(draft.id as string); setDraft(null); await w.reload(); } } : undefined} />}
    </>
  );
}

/** Search an address, then (for another place) name it. */
function PlaceSheet({ title, askName, onClose, onSave }: { title: string; askName: boolean; onClose: () => void; onSave: (h: Addr, name: string) => Promise<void> }) {
  const { t } = useI18n();
  const [hit, setHit] = useState<Addr | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const pick = (h: Addr) => { if (askName) { setHit(h); setName(h.name || ''); } else void onSave(h, ''); };
  return (
    <Sheet label={title} onClose={onClose} tall>
      <div className="row spread"><h2>{title}</h2><button className="btn small icon" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={16} /></button></div>
      {err && <p className="error" role="alert">{err}</p>}
      {!hit ? <AddressPicker onPick={pick} /> : (
        <>
          <span className="muted">{hit.address || hit.name}</span>
          <label className="field"><span>{t('weather.placeName')}</span><input value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} /></label>
          <div className="row spread"><button className="btn" onClick={() => setHit(null)}>{t('common.cancel')}</button>
            <button className="btn primary" onClick={() => { if (!name.trim()) return setErr(t('weather.nameErr')); void onSave(hit, name.trim()); }}>{t('common.save')}</button></div>
        </>
      )}
    </Sheet>
  );
}

function RuleSheet({ draft, members, userId, others, onClose, onSave, onDelete }: { draft: RuleDraft; members: { user_id: string; display_name: string | null }[]; userId: string | null; others: WeatherPlace[]; onClose: () => void; onSave: (d: RuleDraft) => Promise<void>; onDelete?: () => Promise<void> }) {
  const { t } = useI18n();
  const [d, setD] = useState<RuleDraft>(draft);
  const [items, setItems] = useState(draft.items.join('\n'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const unit = SCENARIO_DEFAULT[d.scenario];
  const th = thresholdOf(d);

  async function save() {
    const list = items.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!d.name.trim() || list.length === 0) { setErr(t('weather.items')); return; }
    setBusy(true);
    try { await onSave({ ...d, name: d.name.trim(), items: list }); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <Sheet label={d.id ? t('weather.edit') : t('weather.new')} onClose={onClose} tall>
      <div className="row spread"><h2>{d.id ? t('weather.edit') : t('weather.new')}</h2><button className="btn small icon" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={16} /></button></div>
      {err && <p className="error" role="alert">{err}</p>}
      <label className="field"><span>{t('weather.name')}</span><input value={d.name} maxLength={60} onChange={(e) => set('name', e.target.value)} /></label>
      <div className="field">
        <div className="chips">{SCENARIOS.map((s) => <button key={s} className={`chipbtn${d.scenario === s ? ' on' : ''}`} aria-pressed={d.scenario === s} onClick={() => set('scenario', s as Scenario)}>{t(`weather.s.${s}` as 'weather.s.rain')}</button>)}</div>
      </div>
      {d.scenario !== 'storm' && (
        <label className="field"><span>{t(`weather.thr.${d.scenario}` as 'weather.thr.rain')}</span>
          <input type="number" inputMode="decimal" step={unit.step} value={d.threshold ?? th ?? ''} onChange={(e) => set('threshold', e.target.value === '' ? null : Number(e.target.value))} /></label>
      )}
      <label className="field"><span>{t('weather.items')}</span><textarea rows={5} value={items} onChange={(e) => setItems(e.target.value)} /></label>
      <div className="field"><span>{t('weather.lead')}</span>
        <div className="chips">{(['evening_before', 'same_morning', 'hours_before'] as Lead[]).map((l) => <button key={l} className={`chipbtn${d.lead === l ? ' on' : ''}`} aria-pressed={d.lead === l} onClick={() => set('lead', l)}>{t(`weather.lead.${l}` as 'weather.lead.same_morning')}</button>)}</div>
      </div>
      {d.lead === 'hours_before' ? (
        <label className="field"><span>{t('weather.leadHours')}</span>
          <select value={d.lead_hours} onChange={(e) => set('lead_hours', Number(e.target.value))}>{[1, 2, 3, 4, 6, 8, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          <span className="muted">{t('weather.leadHoursHelp')}</span></label>
      ) : (
        <label className="field"><span>{t('weather.at')}</span>
          <select value={d.at_time} onChange={(e) => set('at_time', e.target.value)}>{[...new Set([...TIMES, d.at_time])].sort().map((x) => <option key={x}>{x}</option>)}</select></label>
      )}
      <div className="field"><span>{t('weather.freq')}</span>
        <div className="chips">{(['spell', 'every'] as Frequency[]).map((f) => <button key={f} className={`chipbtn${d.frequency === f ? ' on' : ''}`} aria-pressed={d.frequency === f} onClick={() => set('frequency', f)}>{t(`weather.freq.${f}` as 'weather.freq.spell')}</button>)}</div>
      </div>
      {d.frequency === 'spell' && (
        <label className="field"><span>{t('weather.gap')}</span>
          <select value={d.dry_gap} onChange={(e) => set('dry_gap', Number(e.target.value))}>{[1, 2, 3, 4, 5, 7].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      )}
      {others.length > 0 && (
        <label className="field"><span>{t('weather.place')}</span>
          <select value={d.place_id ?? ''} onChange={(e) => set('place_id', e.target.value || null)}>
            <option value="">{t('weather.placeHome')}</option>{others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
      )}
      <div className="field"><span>{t('weather.quiet')}</span>
        <div className="chips">{[1, 2, 3, 4, 5, 6, 0].map((wd) => (
          <button key={wd} className={`chipbtn${d.quiet_days.includes(wd) ? ' on' : ''}`} aria-pressed={d.quiet_days.includes(wd)} onClick={() => set('quiet_days', d.quiet_days.includes(wd) ? d.quiet_days.filter((x) => x !== wd) : [...d.quiet_days, wd])}>{t(`weather.dow.${wd}` as 'weather.dow.0')}</button>
        ))}</div>
      </div>
      <label className="field"><span>{t('weather.pause')}</span>
        <div className="row"><input type="date" value={d.paused_until ?? ''} onChange={(e) => set('paused_until', e.target.value || null)} />{d.paused_until && <button className="btn small" onClick={() => set('paused_until', null)}>{t('weather.pauseClear')}</button>}</div></label>
      <label className="field"><span>{t('weather.owner')}</span>
        <select value={d.owner_id ?? ''} onChange={(e) => set('owner_id', e.target.value || null)}>
          <option value="">{t('weather.owner.both')}</option>
          {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.user_id === userId ? t('weather.owner.me') : t('weather.owner.other', { name: m.display_name ?? '?' })}</option>)}
        </select></label>
      <label className="row spread"><span>{t('weather.followUp')}</span><input type="checkbox" className="switch" checked={d.follow_up} onChange={(e) => set('follow_up', e.target.checked)} /></label>
      <div className="row spread">
        {onDelete ? <button className="btn danger" onClick={() => void onDelete()}>{t('weather.delete')}</button> : <span />}
        <button className="btn primary" disabled={busy} onClick={() => void save()}>{t('weather.save')}</button>
      </div>
    </Sheet>
  );
}
