import { useState } from 'react';
import { deleteWeatherRule, saveWeatherRule } from '../lib/api';
import { useI18n } from '../i18n';
import { SCENARIOS, SCENARIO_DEFAULT, ruleSummary, starterRule, thresholdOf, type Frequency, type Lead, type RuleDraft, type Scenario, type WeatherRule } from '../lib/weather';
import { useWeather, writeWeatherPlace } from '../lib/useWeather';
import type { Household } from '../lib/types';
import { Icon } from './icons';
import { Sheet } from './Sheet';

const TIMES = ['06:00', '07:00', '07:30', '08:00', '09:00', '12:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

// Settings card: the household's weather rules, a template picker to start from, and the place the forecast is for.
export function WeatherRules({ household }: { household: Household }) {
  const { t } = useI18n();
  const w = useWeather(household.id);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [picking, setPicking] = useState(false);
  const fixed = w.places.filter((p) => p.kind === 'fixed' && p.lat != null);

  const toggle = async (r: WeatherRule) => { await saveWeatherRule(household.id, { ...r, enabled: !r.enabled }); void w.reload(); };

  return (
    <section className="card">
      <h2>{t('weather.title')}</h2>
      <span className="muted">{t('weather.intro')}</span>
      {w.error && <p className="error" role="alert">{w.error}</p>}
      {w.rules?.length === 0 && !w.error && <p className="muted">{t('weather.empty')}</p>}
      <ul className="wx-rules">
        {(w.rules ?? []).map((r) => (
          <li key={r.id}>
            <button className="wx-rule" onClick={() => setDraft(r)} aria-label={`${t('weather.edit')}: ${r.name}`}>
              <strong>{r.name}</strong>
              <span className="muted">{ruleSummary(t, r)}</span>
            </button>
            <input type="checkbox" className="switch" checked={r.enabled} aria-label={`${t('weather.enabled')}: ${r.name}`} onChange={() => void toggle(r)} />
          </li>
        ))}
      </ul>
      <div className="row"><button className="btn small" onClick={() => setPicking(true)}><Icon name="plus" size={14} /> {t('weather.add')}</button></div>
      {fixed.length === 0 ? <span className="muted">{t('weather.noPlace')}</span> : (
        <label className="field">
          <span className="muted">{t('weather.forecast', { place: w.place?.name ?? '' })}</span>
          <select value={w.place?.id ?? ''} onChange={(e) => { writeWeatherPlace(e.target.value || null); void w.reload(); }} aria-label={t('weather.forecast', { place: '' })}>
            {fixed.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      {picking && (
        <Sheet label={t('weather.add')} onClose={() => setPicking(false)}>
          <div className="row spread"><h2>{t('weather.template')}</h2><button className="btn small icon" onClick={() => setPicking(false)} aria-label={t('common.close')}><Icon name="x" size={16} /></button></div>
          <div className="chips">
            {SCENARIOS.map((s) => <button key={s} className="chipbtn" onClick={() => { setPicking(false); setDraft(starterRule(t, s)); }}>{t(`weather.s.${s}` as 'weather.s.rain')}</button>)}
          </div>
        </Sheet>
      )}
      {draft && <RuleSheet draft={draft} onClose={() => setDraft(null)} onSave={async (d) => { await saveWeatherRule(household.id, d); setDraft(null); void w.reload(); }} onDelete={draft.id ? async () => { if (confirm(t('weather.deleteAsk'))) { await deleteWeatherRule(draft.id as string); setDraft(null); void w.reload(); } } : undefined} />}
    </section>
  );
}

function RuleSheet({ draft, onClose, onSave, onDelete }: { draft: RuleDraft; onClose: () => void; onSave: (d: RuleDraft) => Promise<void>; onDelete?: () => Promise<void> }) {
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
        <div className="chips">{(['evening_before', 'same_morning'] as Lead[]).map((l) => <button key={l} className={`chipbtn${d.lead === l ? ' on' : ''}`} aria-pressed={d.lead === l} onClick={() => set('lead', l)}>{t(`weather.lead.${l}` as 'weather.lead.same_morning')}</button>)}</div>
      </div>
      <label className="field"><span>{t('weather.at')}</span>
        <select value={d.at_time} onChange={(e) => set('at_time', e.target.value)}>{[...new Set([...TIMES, d.at_time])].sort().map((x) => <option key={x}>{x}</option>)}</select></label>
      <div className="field"><span>{t('weather.freq')}</span>
        <div className="chips">{(['spell', 'every'] as Frequency[]).map((f) => <button key={f} className={`chipbtn${d.frequency === f ? ' on' : ''}`} aria-pressed={d.frequency === f} onClick={() => set('frequency', f)}>{t(`weather.freq.${f}` as 'weather.freq.spell')}</button>)}</div>
      </div>
      {d.frequency === 'spell' && (
        <label className="field"><span>{t('weather.gap')}</span>
          <select value={d.dry_gap} onChange={(e) => set('dry_gap', Number(e.target.value))}>{[1, 2, 3, 4, 5, 7].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      )}
      <div className="field"><span>{t('weather.quiet')}</span>
        <div className="chips">{[1, 2, 3, 4, 5, 6, 0].map((wd) => (
          <button key={wd} className={`chipbtn${d.quiet_days.includes(wd) ? ' on' : ''}`} aria-pressed={d.quiet_days.includes(wd)} onClick={() => set('quiet_days', d.quiet_days.includes(wd) ? d.quiet_days.filter((x) => x !== wd) : [...d.quiet_days, wd])}>{t(`weather.dow.${wd}` as 'weather.dow.0')}</button>
        ))}</div>
      </div>
      <label className="field"><span>{t('weather.pause')}</span>
        <div className="row"><input type="date" value={d.paused_until ?? ''} onChange={(e) => set('paused_until', e.target.value || null)} />{d.paused_until && <button className="btn small" onClick={() => set('paused_until', null)}>{t('weather.pauseClear')}</button>}</div></label>
      <label className="row spread"><span>{t('weather.followUp')}</span><input type="checkbox" className="switch" checked={d.follow_up} onChange={(e) => set('follow_up', e.target.checked)} /></label>
      <div className="row spread">
        {onDelete ? <button className="btn danger" onClick={() => void onDelete()}>{t('weather.delete')}</button> : <span />}
        <button className="btn primary" disabled={busy} onClick={() => void save()}>{t('weather.save')}</button>
      </div>
    </Sheet>
  );
}
