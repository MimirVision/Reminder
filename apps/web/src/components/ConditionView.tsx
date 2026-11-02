import { useCallback, useEffect, useMemo, useState } from 'react';
import { addMemory, listConditionItems, listContacts, listHouseCosts, seedConditionItems, setItemContact, updateConditionItem } from '../lib/api';
import { spentByItem, telHref, type Contact, type HouseCost } from '../lib/register';
import { CostSheet } from './CostsView';
import {
  TG_ORDER, WHEN_ORDER, costLabel, defaultFilter, filterItems, groupByArea, nok, summarize, todoFromItem, todoPriority,
  type ConditionFilter, type ConditionItem,
} from '../lib/condition';
import { CONDITION_SEED, CONDITION_SOURCE } from '../lib/conditionSeed';
import type { Household } from '../lib/types';
import { useI18n } from '../i18n';
import { Icon } from './icons';
import { useToast } from './Toast';

// House > Report: the findings of the condition report (TG3, TG2, safety and legality notes), kept apart from the to-do list.
export function ConditionView({ household }: { household: Household }) {
  const { t } = useI18n();
  const toast = useToast();
  const [items, setItems] = useState<ConditionItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<ConditionFilter>(defaultFilter);
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [costs, setCosts] = useState<HouseCost[]>([]);
  const [costFor, setCostFor] = useState<ConditionItem | null>(null);

  const load = useCallback(async () => {
    listContacts(household.id).then(setContacts).catch(() => setContacts([]));
    listHouseCosts(household.id).then(setCosts).catch(() => setCosts([]));
    try { setItems(await listConditionItems(household.id)); setErr(null); }
    catch (e) { const m = e instanceof Error ? e.message : String(e); setErr(/condition_items|schema cache|does not exist/i.test(m) ? t('cond.noTable') : m); setItems([]); }
  }, [household.id, t]);
  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => summarize(items ?? []), [items]);
  const spent = useMemo(() => spentByItem(costs), [costs]);
  const spentTotal = useMemo(() => [...spent.values()].reduce((a, b) => a + b, 0), [spent]);
  const shown = useMemo(() => filterItems(items ?? [], filter), [items, filter]);
  const groups = useMemo(() => groupByArea(shown), [shown]);

  async function loadReport() {
    setBusy(true);
    try { await seedConditionItems(household.id, CONDITION_SEED, CONDITION_SOURCE); await load(); toast({ text: t('cond.loaded', { n: CONDITION_SEED.length }) }); }
    catch (e) { const m = e instanceof Error ? e.message : String(e); setErr(/condition_items|schema cache|does not exist/i.test(m) ? t('cond.noTable') : m); }
    finally { setBusy(false); }
  }

  const patch = async (i: ConditionItem, p: Parameters<typeof updateConditionItem>[1]) => {
    setItems((cur) => (cur ?? []).map((x) => (x.id === i.id ? { ...x, ...p, ...(p.status ? { done_at: p.status === 'done' ? new Date().toISOString() : null } : {}) } : x)));
    try { await updateConditionItem(i.id, p); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); await load(); }
  };

  async function toTodo(i: ConditionItem) {
    try {
      const d = todoFromItem(i);
      const m = await addMemory({ household_id: household.id, body: d.body, notes: d.notes, tags: d.tags, priority: todoPriority(i) });
      await patch(i, { memory_id: m.id });
      toast({ text: t('cond.addedTodo') });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  if (items === null) return <span className="muted">{t('common.loading')}</span>;

  if (items.length === 0) {
    return (
      <div className="card cond-empty">
        <h2>{t('cond.title')}</h2>
        <span className="muted">{t('cond.intro')}</span>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn primary big" disabled={busy} onClick={() => void loadReport()}>{t('cond.load')}</button>
        <span className="muted hint">{t('cond.loadHelp')}</span>
      </div>
    );
  }

  const chip = (label: string, on: boolean, onClick: () => void, extra?: string) => (
    <button type="button" className={`chipbtn${on ? ' on' : ''}${extra ? ` ${extra}` : ''}`} aria-pressed={on} onClick={onClick}>{label}</button>
  );
  const pct = summary.total ? Math.round((summary.done / summary.total) * 100) : 0;

  return (
    <>
      <section className="card cond-summary" aria-label={t('cond.title')}>
        <div className="row spread">
          <strong>{t('cond.title')}</strong>
          <span className="muted">{t('cond.openOf', { open: summary.open, total: summary.total })}</span>
        </div>
        <div className="cond-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
        <div className="cond-counts">
          {TG_ORDER.filter((g) => summary.byTg[g].total > 0).map((g) => (
            <button key={g} type="button" className={`cond-count tg-${g}${filter.tg === g ? ' on' : ''}`} aria-pressed={filter.tg === g} onClick={() => setFilter({ ...filter, tg: filter.tg === g ? 'all' : g })}>
              <b>{summary.byTg[g].open}</b><span>{t(`cond.tg.${g}` as 'cond.tg.TG3')}</span>
            </button>
          ))}
        </div>
        {spentTotal > 0 && <span className="muted">{t('cond.spent')}: <strong>{nok(Math.round(spentTotal))} kr</strong></span>}
        {summary.costOpen.max > 0 && <span className="muted">{t('cond.estimate')}: <strong>{nok(summary.costOpen.min)}–{nok(summary.costOpen.max)} kr</strong></span>}
      </section>

      <div className="chips filter" role="group" aria-label={t('filter.label')}>
        {chip(t('cond.all'), filter.tg === 'all', () => setFilter({ ...filter, tg: 'all' }))}
        {TG_ORDER.filter((g) => summary.byTg[g].total > 0).map((g) => chip(`${t(`cond.tg.${g}` as 'cond.tg.TG3')}`, filter.tg === g, () => setFilter({ ...filter, tg: g }), `tg-${g}`))}
        <span className="cond-sep" aria-hidden="true" />
        {chip(t('cond.when.all'), filter.when === 'all', () => setFilter({ ...filter, when: 'all' }))}
        {WHEN_ORDER.map((w) => chip(t(`cond.when.${w}` as 'cond.when.now'), filter.when === w, () => setFilter({ ...filter, when: w })))}
        <span className="cond-sep" aria-hidden="true" />
        {chip(filter.showDone ? t('cond.hideDone') : t('cond.showDone'), filter.showDone, () => setFilter({ ...filter, showDone: !filter.showDone }))}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {shown.length === 0 && <p className="muted">{t('cond.empty')}</p>}

      {groups.map((g) => (
        <section key={g.area} className="cond-group" aria-label={t(`cond.area.${g.area}` as 'cond.area.other')}>
          <div className="label">{t(`cond.area.${g.area}` as 'cond.area.other')}</div>
          <div className="cards-grid">
            {g.items.map((i) => {
              const cost = costLabel(i.cost_min, i.cost_max);
              const done = i.status !== 'open';
              return (
                <article key={i.id} className={`card cond-item tg-${i.tg}${done ? ' finished' : ''}`}>
                  <div className="cond-head">
                    <span className={`tg-badge tg-${i.tg}`} title={t(`cond.tgLong.${i.tg}` as 'cond.tgLong.TG3')}>{t(`cond.tg.${i.tg}` as 'cond.tg.TG3')}</span>
                    <h3>{i.part}</h3>
                  </div>
                  <div className="meta">
                    <span className={`chip plain when-${i.when_kind}`}>{t(`cond.when.${i.when_kind}` as 'cond.when.now')}</span>
                    {cost && <span className="chip plain"><Icon name="note" size={12} />{t('cond.cost')}: {cost}</span>}
                    {i.page && <span className="chip plain">{t('cond.page', { p: i.page })}</span>}
                    {i.status !== 'open' && <span className="chip">{t(`cond.status.${i.status}` as 'cond.status.done')}</span>}
                    {i.memory_id && <span className="chip plain"><Icon name="check" size={12} />{t('cond.inTodos')}</span>}
                    {spent.get(i.id) ? <span className="chip plain">{t('cond.spent')}: {nok(Math.round(spent.get(i.id) as number))} kr</span> : null}
                  </div>
                  <p className="cond-what"><span className="muted">{t('cond.finding')}: </span>{i.what}</p>
                  <p className="cond-advice"><strong>{t('cond.advice')}: </strong>{i.action}</p>
                  {contacts.length > 0 && (
                    <div className="row">
                      <label className="row"><span className="muted">{t('trade.pick')}</span>
                        <select value={i.contact_id ?? ''} onChange={(e) => { const v = e.target.value || null; setItems((cur) => (cur ?? []).map((x) => (x.id === i.id ? { ...x, contact_id: v } : x))); void setItemContact(i.id, v).catch((x) => setErr(x instanceof Error ? x.message : String(x))); }}>
                          <option value="">{t('trade.none')}</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select></label>
                      {(() => { const c = contacts.find((x) => x.id === i.contact_id); const tel = telHref(c?.phone); return tel ? <a className="btn small" href={tel}>{t('trade.call')} {c?.name}</a> : null; })()}
                    </div>
                  )}
                  {i.notes && noteOpen !== i.id && <p className="cond-note"><Icon name="note" size={12} /> {i.notes}</p>}
                  {noteOpen === i.id && (
                    <textarea rows={2} autoFocus placeholder={t('cond.notePh')} defaultValue={i.notes ?? ''} onBlur={(e) => { const v = e.target.value.trim(); setNoteOpen(null); if (v !== (i.notes ?? '')) void patch(i, { notes: v || null }); }} />
                  )}
                  <div className="row cond-actions">
                    {i.status === 'open'
                      ? <button className="btn small primary" onClick={() => void patch(i, { status: 'done' })}><Icon name="check" size={14} /> {t('cond.done')}</button>
                      : <button className="btn small" onClick={() => void patch(i, { status: 'open' })}>{t('cond.reopen')}</button>}
                    {!i.memory_id && i.status === 'open' && <button className="btn small" onClick={() => void toTodo(i)}><Icon name="plus" size={14} /> {t('cond.toTodo')}</button>}
                    {i.status === 'open' && <button className="btn small" onClick={() => void patch(i, { status: 'skipped' })}>{t('cond.skip')}</button>}
                    <button className="btn small" onClick={() => setCostFor(i)}>{t('cond.logCost')}</button>
                    <button className="btn small" onClick={() => setNoteOpen(noteOpen === i.id ? null : i.id)}>{t('cond.note')}</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      <p className="muted hint">{t('cond.disclaimer')}</p>
      {costFor && <CostSheet household={household} contacts={contacts} appliances={[]} prefill={{ title: costFor.part, item_id: costFor.id, contact_id: costFor.contact_id ?? null }} onClose={() => setCostFor(null)} onSaved={async () => setCosts(await listHouseCosts(household.id))} />}
    </>
  );
}
