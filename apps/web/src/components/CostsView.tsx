import { useMemo, useState } from 'react';
import { addHouseCost, deleteHouseCost } from '../lib/api';
import { buildCosts, costTotals, costYears, parseAmount, type Appliance, type Contact, type CostEntry, type CostEvent, type HouseCost } from '../lib/register';
import type { Household } from '../lib/types';
import { useI18n } from '../i18n';
import { todayISO } from '../lib/when';
import { nok } from '../lib/condition';
import { Icon } from './icons';
import { Sheet } from './Sheet';

export type CostPrefill = { title?: string; item_id?: string | null; task_id?: string | null; appliance_id?: string | null; contact_id?: string | null };

/** Add a cost: what it was, the amount, the date, and optionally who did it and which appliance it was for. */
export function CostSheet({ household, prefill, contacts, appliances, onClose, onSaved }: { household: Household; prefill?: CostPrefill; contacts: Contact[]; appliances: Appliance[]; onClose: () => void; onSaved: () => Promise<void> | void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(prefill?.title ?? '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [contact, setContact] = useState(prefill?.contact_id ?? '');
  const [appliance, setAppliance] = useState(prefill?.appliance_id ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const n = parseAmount(amount);
    if (!title.trim()) return setErr(t('cost.titleErr'));
    if (n == null) return setErr(t('cost.amountErr'));
    setBusy(true);
    try {
      await addHouseCost(household.id, { title: title.trim(), amount_nok: n, spent_on: date || todayISO(), contact_id: contact || null, appliance_id: appliance || null, ...(prefill?.item_id ? { item_id: prefill.item_id } : {}), ...(prefill?.task_id ? { task_id: prefill.task_id } : {}) });
      await onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <Sheet label={t('cost.new')} onClose={onClose} tall>
      <div className="row spread"><h2>{t('cost.new')}</h2><button className="btn small icon" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={16} /></button></div>
      {err && <p className="error" role="alert">{err}</p>}
      <label className="field"><span>{t('cost.what')}</span><input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="field"><span>{t('cost.amount')}</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="field"><span>{t('cost.date')}</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      {contacts.length > 0 && <label className="field"><span>{t('trade.pick')}</span><select value={contact} onChange={(e) => setContact(e.target.value)}><option value="">{t('trade.none')}</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      {appliances.length > 0 && <label className="field"><span>{t('reg.tab.appliances')}</span><select value={appliance} onChange={(e) => setAppliance(e.target.value)}><option value="">{t('trade.none')}</option>{appliances.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
      <div className="row"><button className="btn primary" disabled={busy} onClick={() => void save()}>{t('common.save')}</button></div>
    </Sheet>
  );
}

export function CostsView({ household, costs, events, appliances, contacts, taskTitles, onChanged }: { household: Household; costs: HouseCost[]; events: CostEvent[]; appliances: Appliance[]; contacts: Contact[]; taskTitles: Map<string, string>; onChanged: () => Promise<void> }) {
  const { t, locale } = useI18n();
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => costYears([...costs.map((c) => c.spent_on), ...events.map((e) => e.done_at), ...appliances.flatMap((a) => (a.purchased_on ? [a.purchased_on] : []))], thisYear), [costs, events, appliances, thisYear]);
  const [year, setYear] = useState(thisYear);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const entries = useMemo(() => buildCosts({ year, events, taskTitles, extras: costs, appliances }), [year, events, taskTitles, costs, appliances]);
  const totals = useMemo(() => costTotals(entries), [entries]);
  const max = Math.max(1, ...totals.byMonth);
  const who = (e: CostEntry) => contacts.find((c) => c.id === e.contactId)?.name;
  const remove = async (e: CostEntry) => {
    if (!confirm(t('cost.deleteAsk'))) return;
    try { await deleteHouseCost(e.id.slice(2)); await onChanged(); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
  };

  return (
    <>
      <div className="row spread">
        <div className="chips">{years.map((y) => <button key={y} type="button" className={`chipbtn${y === year ? ' on' : ''}`} aria-pressed={y === year} onClick={() => setYear(y)}>{y}</button>)}</div>
        <button className="btn small primary" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> {t('cost.add')}</button>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <section className="card cost-total" aria-label={t('cost.total', { year })}>
        <span className="muted">{t('cost.total', { year })}</span>
        <strong className="cost-big">{nok(Math.round(totals.total))} kr</strong>
        <span className="muted">{t('cost.jobs')} {nok(Math.round(totals.bySource.job))} · {t('cost.logged')} {nok(Math.round(totals.bySource.extra))} · {t('cost.bought')} {nok(Math.round(totals.bySource.purchase))}</span>
        <div className="cost-bars" aria-hidden="true">
          {totals.byMonth.map((v, i) => (
            <span key={i} title={`${new Date(2000, i, 1).toLocaleDateString(locale, { month: 'long' })}: ${nok(Math.round(v))} kr`}><i style={{ height: `${Math.round((v / max) * 100)}%` }} /></span>
          ))}
        </div>
      </section>
      {entries.length === 0 && <p className="muted">{t('cost.empty', { year })}</p>}
      <ul className="cost-list">
        {entries.map((e) => (
          <li key={e.id} className="card">
            <div className="row spread">
              <span><strong>{e.title}</strong><br /><span className="muted">{e.date} · {t(`cost.src.${e.source}` as 'cost.src.job')}{who(e) ? ` · ${who(e)}` : ''}</span></span>
              <span className="cost-amount">{nok(Math.round(e.amount))} kr</span>
            </div>
            {e.source === 'extra' && <div className="row"><button className="link danger left" onClick={() => void remove(e)}>{t('cost.delete')}</button></div>}
          </li>
        ))}
      </ul>
      {adding && <CostSheet household={household} contacts={contacts} appliances={appliances} onClose={() => setAdding(false)} onSaved={onChanged} />}
    </>
  );
}
