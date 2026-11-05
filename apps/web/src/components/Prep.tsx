import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { deletePrepStock, getPrepSettings, listPrepStock, listWeatherPlaces, savePrepSettings, savePrepStock } from '../lib/api';
import {
  EMERGENCY_NUMBERS, PREP_CATS, PREP_ITEMS, addMonths, byExpiry, cardText, catLabel, daysUntil, expiringSoon, expiryState, formatNumber, isoOf, itemName, itemStates, itemTip, itemUnit,
  missingItems, parseMonthDate, readiness, stormAhead, suggestedExpiry, type ItemState, type PrepItem, type PrepProfile, type PrepStock,
} from '../lib/prep';
import { addMissingTodos, addReplacementTodo, addReviewJob } from '../lib/prepTodos';
import { loadForecast } from '../lib/weather';
import type { Household } from '../lib/types';
import { useI18n } from '../i18n';
import { Icon } from './icons';
import { Sheet } from './Sheet';
import { useToast } from './Toast';

type Tab = 'overview' | 'list' | 'stock' | 'plan';
const cacheKey = (id: string) => `hm.prep.${id}`;
type Draft = Omit<PrepStock, 'id' | 'household_id'> & { id?: string };

// House > Beredskap: what to have at home for a week (DSB's advice), what is in stock and when it expires, a family plan and emergency numbers.
export function Prep({ household }: { household: Household }) {
  const { t, tn, lang, locale } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [profile, setProfile] = useState<PrepProfile | null>(null);
  const [stock, setStock] = useState<PrepStock[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ahead, setAhead] = useState<ReturnType<typeof stormAhead>>(null);
  const [busy, setBusy] = useState(false);
  const today = isoOf(new Date());

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([getPrepSettings(household.id), listPrepStock(household.id)]);
      setProfile(p); setStock(s); setOffline(false); setNeedsUpgrade(false); setErr(null);
      try { localStorage.setItem(cacheKey(household.id), JSON.stringify({ p, s })); } catch { /* best effort */ }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/prep_settings|prep_stock|schema cache|does not exist/i.test(m)) { setNeedsUpgrade(true); return; }
      // No connection (the very moment this page is for): the last saved copy.
      try { const c = JSON.parse(localStorage.getItem(cacheKey(household.id)) ?? 'null') as { p: PrepProfile; s: PrepStock[] } | null; if (c) { setProfile(c.p); setStock(c.s); setOffline(true); return; } } catch { /* no copy */ }
      setErr(m);
    }
  }, [household.id]);
  useEffect(() => { void load(); }, [load]);

  // A storm, a lot of snow or hard frost in the next days: worth a look at the stock.
  useEffect(() => {
    listWeatherPlaces(household.id).then(async (places) => {
      const home = places.find((p) => p.is_home);
      if (home) setAhead(stormAhead(await loadForecast(home.lat, home.lon), today));
    }).catch(() => {});
  }, [household.id, today]);

  const p = profile;
  const states = useMemo(() => (p ? itemStates(p, stock) : []), [p, stock]);
  const ready = useMemo(() => (p ? readiness(p, stock) : null), [p, stock]);
  const expiring = useMemo(() => (p ? expiringSoon(stock, today, p.lead_days) : []), [p, stock, today]);

  const saveProfile = async (next: PrepProfile) => { setProfile(next); try { await savePrepSettings(household.id, next); try { localStorage.setItem(cacheKey(household.id), JSON.stringify({ p: next, s: stock })); } catch { /* ignore */ } } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const run = async (fn: () => Promise<void>) => { try { setErr(null); setBusy(true); await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };

  if (needsUpgrade) return <section className="card"><p className="error" role="alert">{t('prep.noTable')}</p></section>;
  if (!p || !ready) return err ? <p className="error" role="alert">{err}</p> : <span className="muted">{t('common.loading')}</span>;

  const dateText = (d: string) => new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const expiryChip = (s: PrepStock) => {
    const st = expiryState(s.expires_on, today, p.lead_days);
    if (st === 'none') return <span className="chip plain">{t('prep.noDate')}</span>;
    const d = daysUntil(s.expires_on as string, today);
    const text = st === 'expired' ? t('prep.expired', { date: dateText(s.expires_on as string) }) : d === 0 ? t('prep.expiresToday') : d < 60 ? tn('prep.expiresIn', d) : t('prep.expiresOn', { date: dateText(s.expires_on as string) });
    return <span className={`chip plain warr-${st === 'expired' ? 'expired' : st === 'soon' ? 'soon' : 'active'}`}>{text}</span>;
  };

  const stockFor = (item: PrepItem): Draft => ({ key: item.key, name: itemName(item, lang), category: item.cat, qty: 1, unit: itemUnit(item, lang), expires_on: suggestedExpiry(item, today), renew_months: item.renewMonths ?? null, location: null, notes: null });

  async function buy() {
    if (!p) return;
    const miss = missingItems(p, stock);
    if (miss.length === 0) return toast({ text: t('prep.buyNone') });
    setBusy(true);
    try { const r = await addMissingTodos(household.id, miss, lang, t); toast({ text: r.made > 0 ? tn('prep.buyDone', r.made) : t('prep.buyAlready') }); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function used(s: PrepStock) {
    const item = PREP_ITEMS.find((i) => i.key === s.key) ?? null;
    await run(async () => {
      if (s.qty > 1) await savePrepStock(household.id, { ...s, qty: s.qty - 1 }); else await deletePrepStock(s.id);
      await addReplacementTodo(household.id, item, s.name, s.unit ?? '', lang, t);
      toast({ text: t('prep.usedMsg') });
    });
  }
  async function checked(s: PrepStock) {
    if (!s.renew_months) return;
    const next = addMonths(s.expires_on && s.expires_on > today ? s.expires_on : today, s.renew_months);
    await run(async () => { await savePrepStock(household.id, { ...s, expires_on: next }); toast({ text: t('prep.checkedMsg', { date: dateText(next) }) }); });
  }
  const share = async () => {
    const text = cardText(lang, p, stock);
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast({ text: t('prep.copied') }); } } catch { /* cancelled */ }
  };

  const tabs: Tab[] = ['overview', 'list', 'stock', 'plan'];
  const num = (label: string, key: 'adults' | 'children' | 'pets' | 'days' | 'iodine_people' | 'lead_days', min: number, max: number) => (
    <label className="field"><span>{label}</span><input type="number" inputMode="numeric" min={min} max={max} value={p[key]} onChange={(e) => { const v = Math.min(max, Math.max(min, Math.round(Number(e.target.value) || min))); void saveProfile({ ...p, [key]: v }); }} /></label>
  );

  return (
    <>
      <div className="chips reg-tabs" role="group">
        {tabs.map((x) => <button key={x} type="button" className={`chipbtn${tab === x ? ' on' : ''}`} aria-pressed={tab === x} onClick={() => setTab(x)}>{t(`prep.tab.${x}` as 'prep.tab.list')}</button>)}
      </div>
      {offline && <p className="muted" role="status">{t('prep.offline')}</p>}
      {err && <p className="error" role="alert">{err}</p>}

      {tab === 'overview' && (
        <>
          <section className="card prep-hero" aria-label={t('house.prep')}>
            <strong className="prep-days">{ready.days >= p.days ? t('prep.headlineAll', { days: p.days }) : t('prep.headline', { n: ready.days, days: p.days })}</strong>
            <div className="cond-bar" role="progressbar" aria-valuenow={ready.percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${ready.percent}%` }} /></div>
            <span className="muted">{t('prep.percent', { n: ready.percent })}{ready.weakest ? ` · ${t(`prep.weak.${ready.weakest}` as 'prep.weak.water')}` : ''}</span>
            {ready.percent === 100 && <span className="muted">{t('prep.allGood')}</span>}
            <div className="prep-cats">
              {PREP_CATS.filter((c) => ready.byCat[c]).map((c) => (
                <button key={c} type="button" className="prep-cat" onClick={() => setTab('list')}>
                  <span>{catLabel(c, lang)}</span><span className="cond-bar small"><span style={{ width: `${ready.byCat[c]!.pct}%` }} /></span>
                </button>
              ))}
            </div>
          </section>

          {ahead && <div className="late-banner house-card" role="status"><span>{t(`prep.ahead.${ahead.kind}` as 'prep.ahead.storm', { date: dateText(ahead.date) })}</span></div>}

          <section className="card">
            <h2>{t('prep.expiring')}</h2>
            {expiring.length === 0 ? <span className="muted">{t('prep.noneExpiring')}</span> : (
              <>
                <span className="muted">{tn('prep.expiringN', expiring.length, { days: p.lead_days })}</span>
                <ul className="cost-list">{expiring.slice(0, 5).map((s) => <li key={s.id} className="row spread"><strong>{s.name}</strong>{expiryChip(s)}</li>)}</ul>
                <div className="row"><button className="btn small" onClick={() => setTab('stock')}>{t('prep.tab.stock')}</button></div>
              </>
            )}
          </section>

          <section className="card">
            <h2>{t('prep.household')}</h2>
            <span className="muted">{t('prep.householdHelp')}</span>
            <div className="prep-grid">
              {num(t('prep.adults'), 'adults', 1, 12)}{num(t('prep.children'), 'children', 0, 12)}{num(t('prep.pets'), 'pets', 0, 20)}{num(t('prep.days'), 'days', 1, 21)}
            </div>
            {num(t('prep.iodine'), 'iodine_people', 0, 20)}
            <label className="row spread"><span>{t('prep.baby')}</span><input type="checkbox" className="switch" checked={p.baby} aria-label={t('prep.baby')} onChange={(e) => void saveProfile({ ...p, baby: e.target.checked })} /></label>
            <label className="row spread"><span>{t('prep.stove')}</span><input type="checkbox" className="switch" checked={p.wood_stove} aria-label={t('prep.stove')} onChange={(e) => void saveProfile({ ...p, wood_stove: e.target.checked })} /></label>
            {num(t('prep.lead'), 'lead_days', 1, 365)}
          </section>

          <section className="card">
            <h2>{t('prep.buyMissing')}</h2>
            <span className="muted">{t('prep.buyHelp')}</span>
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={() => void buy()}><Icon name="plus" size={14} /> {t('prep.buyMissing')}</button>
              <button className="btn" disabled={busy} onClick={() => void run(async () => { await addReviewJob(household.id, t('prep.reviewTitle'), t('prep.reviewNotes')); toast({ text: t('prep.reviewDone') }); })}>{t('prep.review')}</button>
            </div>
          </section>

          <section className="card">
            <h2>{t('prep.card')}</h2>
            <span className="muted">{t('prep.cardHelp')}</span>
            <div className="row"><button className="btn" onClick={() => window.print()}>{t('prep.print')}</button><button className="btn" onClick={() => void share()}>{t('prep.share')}</button></div>
          </section>
          <p className="muted">{t('prep.source')}</p>
        </>
      )}

      {tab === 'list' && PREP_CATS.map((c) => {
        const list = states.filter((s) => s.item.cat === c);
        if (list.length === 0) return null;
        return (
          <section key={c} className="cond-group" aria-label={catLabel(c, lang)}>
            <div className="label">{catLabel(c, lang)}</div>
            <div className="cards-grid">{list.map((s) => <ItemCard key={s.item.key} s={s} p={p} lang={lang} onAdd={() => setDraft(stockFor(s.item))} onTarget={(n) => void saveProfile({ ...p, overrides: n == null ? Object.fromEntries(Object.entries(p.overrides).filter(([k]) => k !== s.item.key)) : { ...p.overrides, [s.item.key]: n } })} />)}</div>
          </section>
        );
      })}

      {tab === 'stock' && (
        <>
          <div className="row"><button className="btn small primary" onClick={() => setDraft({ key: null, name: '', category: 'other', qty: 1, unit: null, expires_on: null, renew_months: null, location: null, notes: null })}><Icon name="plus" size={14} /> {t('prep.addCustom')}</button></div>
          {stock.length === 0 && <p className="muted">{t('prep.stock.empty')}</p>}
          <ul className="cost-list">
            {byExpiry(stock).map((s) => (
              <li key={s.id} className="card">
                <div className="row spread"><span><strong>{s.name}</strong><br /><span className="muted">{s.qty} {s.unit ?? ''}{s.location ? ` · ${s.location}` : ''}</span></span>{expiryChip(s)}</div>
                <div className="row">
                  <button className="btn small" disabled={busy} onClick={() => void used(s)}>{t('prep.used')}</button>
                  {s.renew_months ? <button className="btn small" disabled={busy} onClick={() => void checked(s)}>{t('prep.checked')}</button> : null}
                  <button className="btn small" onClick={() => setDraft({ ...s })}>{t('prep.editStock')}</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === 'plan' && <PlanTab p={p} lang={lang} onSave={saveProfile} />}

      {draft && <StockSheet draft={draft} today={today} lang={lang} onClose={() => setDraft(null)}
        onSave={async (d) => { await savePrepStock(household.id, d); setDraft(null); await load(); }}
        onDelete={draft.id ? async () => { if (confirm(t('prep.deleteAsk'))) { await deletePrepStock(draft.id as string); setDraft(null); await load(); } } : undefined} />}
      <PrintCard text={cardText(lang, p, stock)} />
    </>
  );
}

function ItemCard({ s, p, lang, onAdd, onTarget }: { s: ItemState; p: PrepProfile; lang: string; onAdd: () => void; onTarget: (n: number | null) => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(s.target));
  const tip = itemTip(s.item, lang);
  const own = p.overrides[s.item.key] != null;
  return (
    <article className={`card reg-item${s.done ? ' finished' : ''}`}>
      <div className="row spread"><h3>{itemName(s.item, lang)}</h3>{s.item.optional && <span className="chip plain">{t('prep.optional')}</span>}</div>
      <span className={s.done ? 'chip plain warr-active' : 'muted'}>{s.done ? `✓ ${t('prep.done')}` : t('prep.missingN', { n: s.missing, unit: itemUnit(s.item, lang) })} · {t('prep.have', { have: s.have, target: s.target, unit: itemUnit(s.item, lang) })}</span>
      <div className="cond-bar small" aria-hidden="true"><span style={{ width: `${Math.round(s.pct * 100)}%` }} /></div>
      {tip && <p className="muted notes">{tip}</p>}
      {editing ? (
        <div className="row">
          <input className="narrowfield" type="number" min={0} inputMode="decimal" value={val} aria-label={t('prep.target')} onChange={(e) => setVal(e.target.value)} />
          <button className="btn small primary" onClick={() => { const n = Number(val.replace(',', '.')); if (Number.isFinite(n) && n >= 0) { onTarget(n); setEditing(false); } }}>{t('common.save')}</button>
          {own && <button className="btn small" onClick={() => { onTarget(null); setEditing(false); }}>{t('prep.useRecommended')}</button>}
        </div>
      ) : (
        <div className="row">
          <button className="btn small primary" onClick={onAdd}>{t('prep.add')}</button>
          <button className="btn small" onClick={() => { setVal(String(s.target)); setEditing(true); }}>{t('prep.target')}</button>
        </div>
      )}
    </article>
  );
}

function StockSheet({ draft, today, lang, onClose, onSave, onDelete }: { draft: Draft; today: string; lang: string; onClose: () => void; onSave: (d: Draft) => Promise<void>; onDelete?: () => Promise<void> }) {
  const { t } = useI18n();
  const [d, setD] = useState<Draft>(draft);
  const [month, setMonth] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const item = PREP_ITEMS.find((i) => i.key === d.key);
  async function save() {
    if (!d.name.trim()) return setErr(t('prep.nameErr'));
    if (!(d.qty >= 0)) return setErr(t('prep.qtyErr'));
    let expires = d.expires_on;
    if (month.trim()) { expires = parseMonthDate(month); if (!expires) return setErr(t('prep.dateErr')); }
    setBusy(true);
    try { await onSave({ ...d, name: d.name.trim(), expires_on: expires }); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  return (
    <Sheet label={d.id ? t('prep.editStock') : t('prep.newStock')} onClose={onClose} tall>
      <div className="row spread"><h2>{d.id ? t('prep.editStock') : t('prep.newStock')}</h2><button className="btn small icon" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={16} /></button></div>
      {err && <p className="error" role="alert">{err}</p>}
      <label className="field"><span>{t('prep.name')}</span><input value={d.name} maxLength={80} onChange={(e) => set('name', e.target.value)} /></label>
      <div className="prep-grid">
        <label className="field"><span>{t('prep.qty')}</span><input type="number" inputMode="decimal" min={0} step="any" value={d.qty} onChange={(e) => set('qty', Number(e.target.value))} /></label>
        <label className="field"><span>{t('prep.unit')}</span><input value={d.unit ?? ''} onChange={(e) => set('unit', e.target.value || null)} /></label>
      </div>
      <div className="field"><label htmlFor="exp">{t('prep.expires')}</label>
        <input id="exp" type="date" value={d.expires_on ?? ''} onChange={(e) => { set('expires_on', e.target.value || null); setMonth(''); }} />
        <div className="chips">
          {[6, 12, 24, 60].map((n) => <button key={n} type="button" className="chipbtn" onClick={() => { set('expires_on', addMonths(today, n)); setMonth(''); }}>{n < 12 ? t('prep.months', { n }) : t('prep.years', { n: n / 12 })}</button>)}
          {item?.shelfMonths ? <button type="button" className="chipbtn" onClick={() => { set('expires_on', suggestedExpiry(item, today)); setMonth(''); }}>{itemName(item, lang)}</button> : null}
        </div>
        <input value={month} placeholder="03/2027" inputMode="numeric" aria-label={t('prep.expiresHelp')} onChange={(e) => setMonth(e.target.value)} />
        <span className="muted">{t('prep.expiresHelp')}</span>
      </div>
      <label className="field"><span>{t('prep.renew')}</span>
        <select value={d.renew_months ?? ''} onChange={(e) => set('renew_months', e.target.value ? Number(e.target.value) : null)}>
          <option value="">{t('prep.renewNone')}</option>{[1, 3, 6, 12, 24].map((n) => <option key={n} value={n}>{n}</option>)}
        </select></label>
      <label className="field"><span>{t('prep.location')}</span><input value={d.location ?? ''} onChange={(e) => set('location', e.target.value || null)} /></label>
      <label className="field"><span>{t('prep.notes')}</span><textarea rows={2} value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} /></label>
      <div className="row spread">
        {onDelete ? <button className="btn danger" onClick={() => void onDelete()}>{t('prep.delete')}</button> : <span />}
        <button className="btn primary" disabled={busy} onClick={() => void save()}>{t('common.save')}</button>
      </div>
    </Sheet>
  );
}

function PlanTab({ p, lang, onSave }: { p: PrepProfile; lang: string; onSave: (p: PrepProfile) => Promise<void> }) {
  const { t } = useI18n();
  const [meeting, setMeeting] = useState(p.meeting_place ?? '');
  const [outside, setOutside] = useState(p.outside_contact ?? '');
  const [notes, setNotes] = useState(p.notes ?? '');
  const guides: [string, ReactNode][] = ['power', 'water', 'evac', 'iodine', 'storm'].map((g) => [g, null]);
  return (
    <>
      <section className="card">
        <h2>{t('prep.plan.title')}</h2>
        <label className="field"><span>{t('prep.meeting')}</span><input value={meeting} onChange={(e) => setMeeting(e.target.value)} onBlur={() => void onSave({ ...p, meeting_place: meeting.trim() || null })} /></label>
        <label className="field"><span>{t('prep.outside')}</span><input value={outside} onChange={(e) => setOutside(e.target.value)} onBlur={() => void onSave({ ...p, outside_contact: outside.trim() || null })} /></label>
        <label className="field"><span>{t('prep.notesPlan')}</span><textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => void onSave({ ...p, notes: notes.trim() || null })} /></label>
      </section>
      <section className="card">
        <h2>{t('prep.numbers')}</h2>
        <ul className="cost-list">{EMERGENCY_NUMBERS.map((e) => <li key={e.number} className="row spread"><span><strong>{formatNumber(e.number)}</strong> <span className="muted">{lang === 'nb' ? e.nb : e.en}</span></span><a className="btn small" href={`tel:${e.number}`}>{t('prep.call')}</a></li>)}</ul>
      </section>
      <section className="card">
        <h2>{t('prep.guides')}</h2>
        {guides.map(([g]) => (
          <details key={g} className="prep-guide"><summary>{t(`prep.g.${g}.t` as 'prep.g.power.t')}</summary><p>{t(`prep.g.${g}.b` as 'prep.g.power.b')}</p></details>
        ))}
        <span className="muted">{t('prep.source')}</span>
      </section>
    </>
  );
}

/** The fridge card: only visible when printing. */
function PrintCard({ text }: { text: string }) {
  return <pre className="print-card" aria-hidden="true">{text}</pre>;
}
