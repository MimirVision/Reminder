import { useMemo, useState } from 'react';
import { deleteAppliance, saveAppliance } from '../lib/api';
import { APPLIANCE_CATEGORIES, applianceLine, parseAmount, safeUrl, sortAppliances, telHref, warrantiesEnding, warrantyState, type Appliance, type Contact } from '../lib/register';
import type { Household } from '../lib/types';
import { useI18n } from '../i18n';
import { todayISO } from '../lib/when';
import { nok } from '../lib/condition';
import { Icon } from './icons';
import { Sheet } from './Sheet';

type Draft = Omit<Appliance, 'household_id' | 'created_at' | 'id'> & { id?: string };
const blank = (): Draft => ({ name: '', category: 'other', brand: null, model: null, serial: null, room: null, purchased_on: null, price_nok: null, store: null, warranty_until: null, manual_url: null, contact_id: null, notes: null });

export function WarrantyChip({ a }: { a: Pick<Appliance, 'warranty_until'> }) {
  const { t, tn } = useI18n();
  const w = warrantyState(a, todayISO());
  const text = w.kind === 'none' ? t('warr.none') : w.kind === 'expired' ? t('warr.expired', { date: a.warranty_until as string }) : w.kind === 'active' ? t('warr.active', { date: a.warranty_until as string }) : w.days === 0 ? t('warr.today') : tn('warr.endsIn', w.days);
  return <span className={`chip plain warr-${w.kind}`}>{text}</span>;
}

export function AppliancesView({ household, appliances, contacts, onChanged }: { household: Household; appliances: Appliance[]; contacts: Contact[]; onChanged: () => Promise<void> }) {
  const { t, tn } = useI18n();
  const [draft, setDraft] = useState<Draft | null>(null);
  const today = todayISO();
  const sorted = useMemo(() => sortAppliances(appliances, today), [appliances, today]);
  const ending = warrantiesEnding(appliances, today, 60).length;

  return (
    <>
      <div className="row spread">
        <span className="muted">{tn('appl.count', appliances.length)}{ending > 0 ? ` · ${tn('warr.ending', ending)}` : ''}</span>
        <button className="btn small primary" onClick={() => setDraft(blank())}><Icon name="plus" size={14} /> {t('appl.add')}</button>
      </div>
      {appliances.length === 0 && <p className="muted">{t('appl.empty')}</p>}
      <div className="cards-grid">
        {sorted.map((a) => {
          const c = contacts.find((x) => x.id === a.contact_id);
          const url = safeUrl(a.manual_url);
          const tel = telHref(c?.phone);
          return (
            <article key={a.id} className="card reg-item">
              <div className="row spread"><h3>{a.name}</h3><span className="chip plain">{t(`appl.cat.${a.category}` as 'appl.cat.other')}</span></div>
              {applianceLine(a) && <span className="muted">{applianceLine(a)}</span>}
              <div className="meta">
                <WarrantyChip a={a} />
                {a.purchased_on && <span className="chip plain">{t('appl.purchased')}: {a.purchased_on}</span>}
                {a.price_nok != null && <span className="chip plain">{nok(a.price_nok)} kr</span>}
              </div>
              {a.notes && <p className="muted notes">{a.notes}</p>}
              <div className="row">
                <button className="btn small" onClick={() => setDraft({ ...a })}>{t('appl.edit')}</button>
                {url && <a className="btn small" href={url} target="_blank" rel="noopener noreferrer">{t('appl.open')}</a>}
                {c && (tel ? <a className="btn small" href={tel}>{t('trade.call')} {c.name}</a> : <span className="chip plain">{c.name}</span>)}
              </div>
            </article>
          );
        })}
      </div>
      {draft && <ApplianceSheet draft={draft} contacts={contacts} onClose={() => setDraft(null)}
        onSave={async (d) => { await saveAppliance(household.id, d); setDraft(null); await onChanged(); }}
        onDelete={draft.id ? async () => { if (confirm(t('appl.deleteAsk'))) { await deleteAppliance(draft.id as string); setDraft(null); await onChanged(); } } : undefined} />}
    </>
  );
}

const orNull = (v: string) => (v.trim() ? v.trim() : null);

function ApplianceSheet({ draft, contacts, onClose, onSave, onDelete }: { draft: Draft; contacts: Contact[]; onClose: () => void; onSave: (d: Draft) => Promise<void>; onDelete?: () => Promise<void> }) {
  const { t, tn } = useI18n();
  const [d, setD] = useState<Draft>(draft);
  const [price, setPrice] = useState(draft.price_nok != null ? String(draft.price_nok).replace('.', ',') : '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const text = (k: 'brand' | 'model' | 'serial' | 'room' | 'store' | 'notes') => <input value={d[k] ?? ''} onChange={(e) => set(k, e.target.value || null)} />;

  async function save() {
    if (!d.name.trim()) return setErr(t('appl.nameErr'));
    const p = price.trim() ? parseAmount(price) : null;
    if (price.trim() && p == null) return setErr(t('appl.priceErr'));
    setBusy(true);
    try { await onSave({ ...d, name: d.name.trim(), price_nok: p, manual_url: orNull(d.manual_url ?? '') }); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  const addYears = (n: number) => {
    const base = d.purchased_on ?? todayISO();
    set('warranty_until', `${+base.slice(0, 4) + n}${base.slice(4)}`);
  };

  return (
    <Sheet label={d.id ? t('appl.edit') : t('appl.new')} onClose={onClose} tall>
      <div className="row spread"><h2>{d.id ? t('appl.edit') : t('appl.new')}</h2><button className="btn small icon" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={16} /></button></div>
      {err && <p className="error" role="alert">{err}</p>}
      <label className="field"><span>{t('appl.name')}</span><input value={d.name} maxLength={80} onChange={(e) => set('name', e.target.value)} /></label>
      <label className="field"><span>{t('appl.category')}</span>
        <select value={d.category} onChange={(e) => set('category', e.target.value)}>{APPLIANCE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`appl.cat.${c}` as 'appl.cat.other')}</option>)}</select></label>
      <label className="field"><span>{t('appl.brand')}</span>{text('brand')}</label>
      <label className="field"><span>{t('appl.model')}</span>{text('model')}</label>
      <label className="field"><span>{t('appl.serial')}</span>{text('serial')}</label>
      <label className="field"><span>{t('appl.room')}</span>{text('room')}</label>
      <label className="field"><span>{t('appl.purchased')}</span><input type="date" value={d.purchased_on ?? ''} onChange={(e) => set('purchased_on', e.target.value || null)} /></label>
      <label className="field"><span>{t('appl.price')}</span><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label className="field"><span>{t('appl.store')}</span>{text('store')}</label>
      <div className="field"><label htmlFor="warr">{t('appl.warranty')}</label>
        <input id="warr" type="date" value={d.warranty_until ?? ''} onChange={(e) => set('warranty_until', e.target.value || null)} />
        <div className="chips">{[2, 3, 5].map((n) => <button key={n} type="button" className="chipbtn" onClick={() => addYears(n)}>{tn('appl.years', n)}</button>)}</div>
      </div>
      <label className="field"><span>{t('appl.manual')}</span><input type="url" inputMode="url" value={d.manual_url ?? ''} onChange={(e) => set('manual_url', e.target.value || null)} /><span className="muted">{t('appl.manualHelp')}</span></label>
      <label className="field"><span>{t('appl.service')}</span>
        <select value={d.contact_id ?? ''} onChange={(e) => set('contact_id', e.target.value || null)}><option value="">{t('trade.none')}</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="field"><span>{t('appl.notes')}</span><textarea rows={3} value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} /></label>
      <div className="row spread">
        {onDelete ? <button className="btn danger" onClick={() => void onDelete()}>{t('appl.delete')}</button> : <span />}
        <button className="btn primary" disabled={busy} onClick={() => void save()}>{t('common.save')}</button>
      </div>
    </Sheet>
  );
}
