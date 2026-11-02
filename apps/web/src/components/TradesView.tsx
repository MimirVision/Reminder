import { useMemo, useState } from 'react';
import { deleteContact, saveContact } from '../lib/api';
import { TRADES, mailHref, telHref, type Appliance, type Contact } from '../lib/register';
import type { Household, MaintenanceTask } from '../lib/types';
import { useI18n } from '../i18n';
import { Icon } from './icons';
import { Sheet } from './Sheet';

type Draft = Omit<Contact, 'household_id' | 'id'> & { id?: string };
const blank = (): Draft => ({ name: '', trade: 'plumber', company: null, phone: null, email: null, notes: null });

export function TradesView({ household, contacts, appliances, tasks, onChanged }: { household: Household; contacts: Contact[]; appliances: Appliance[]; tasks: MaintenanceTask[]; onChanged: () => Promise<void> }) {
  const { t, tn } = useI18n();
  const [draft, setDraft] = useState<Draft | null>(null);
  const linked = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of [...appliances, ...tasks]) if (x.contact_id) m.set(x.contact_id, (m.get(x.contact_id) ?? 0) + 1);
    return m;
  }, [appliances, tasks]);

  return (
    <>
      <div className="row spread"><span className="muted">{contacts.length}</span><button className="btn small primary" onClick={() => setDraft(blank())}><Icon name="plus" size={14} /> {t('trade.add')}</button></div>
      {contacts.length === 0 && <p className="muted">{t('trade.empty')}</p>}
      <div className="cards-grid">
        {contacts.map((c) => {
          const tel = telHref(c.phone), mail = mailHref(c.email), n = linked.get(c.id) ?? 0;
          return (
            <article key={c.id} className="card reg-item">
              <div className="row spread"><h3>{c.name}</h3><span className="chip plain">{t(`trade.t.${c.trade}` as 'trade.t.other')}</span></div>
              {c.company && <span className="muted">{c.company}</span>}
              {c.phone && <span>{c.phone}</span>}
              {n > 0 && <span className="muted">{tn('trade.linked', n)}</span>}
              {c.notes && <p className="muted notes">{c.notes}</p>}
              <div className="row">
                {tel && <a className="btn small primary" href={tel}>{t('trade.call')}</a>}
                {mail && <a className="btn small" href={mail}>{t('trade.mail')}</a>}
                <button className="btn small" onClick={() => setDraft({ ...c })}>{t('trade.edit')}</button>
              </div>
            </article>
          );
        })}
      </div>
      {draft && <ContactSheet draft={draft} onClose={() => setDraft(null)}
        onSave={async (d) => { await saveContact(household.id, d); setDraft(null); await onChanged(); }}
        onDelete={draft.id ? async () => { if (confirm(t('trade.deleteAsk'))) { await deleteContact(draft.id as string); setDraft(null); await onChanged(); } } : undefined} />}
    </>
  );
}

function ContactSheet({ draft, onClose, onSave, onDelete }: { draft: Draft; onClose: () => void; onSave: (d: Draft) => Promise<void>; onDelete?: () => Promise<void> }) {
  const { t } = useI18n();
  const [d, setD] = useState<Draft>(draft);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const text = (k: 'company' | 'phone' | 'email', type = 'text') => <input type={type} value={d[k] ?? ''} onChange={(e) => set(k, e.target.value.trim() ? e.target.value : null)} />;
  async function save() {
    if (!d.name.trim()) return setErr(t('trade.nameErr'));
    setBusy(true);
    try { await onSave({ ...d, name: d.name.trim() }); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  return (
    <Sheet label={d.id ? t('trade.edit') : t('trade.new')} onClose={onClose} tall>
      <div className="row spread"><h2>{d.id ? t('trade.edit') : t('trade.new')}</h2><button className="btn small icon" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={16} /></button></div>
      {err && <p className="error" role="alert">{err}</p>}
      <label className="field"><span>{t('trade.name')}</span><input value={d.name} maxLength={80} onChange={(e) => set('name', e.target.value)} /></label>
      <label className="field"><span>{t('trade.trade')}</span>
        <select value={d.trade} onChange={(e) => set('trade', e.target.value)}>{TRADES.map((x) => <option key={x} value={x}>{t(`trade.t.${x}` as 'trade.t.other')}</option>)}</select></label>
      <label className="field"><span>{t('trade.company')}</span>{text('company')}</label>
      <label className="field"><span>{t('trade.phone')}</span>{text('phone', 'tel')}</label>
      <label className="field"><span>{t('trade.email')}</span>{text('email', 'email')}</label>
      <label className="field"><span>{t('trade.notes')}</span><textarea rows={3} value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} /></label>
      <div className="row spread">
        {onDelete ? <button className="btn danger" onClick={() => void onDelete()}>{t('trade.delete')}</button> : <span />}
        <button className="btn primary" disabled={busy} onClick={() => void save()}>{t('common.save')}</button>
      </div>
    </Sheet>
  );
}
