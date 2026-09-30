import { useCallback, useEffect, useState } from 'react';
import { addFact, deleteFact, listFacts, readLabel } from '../lib/api';
import { Icon } from './icons';
import { groupFacts, FACT_ORDER, type Fact, type FactCategory } from '../lib/facts';
import { CATEGORIES, shopName } from '../lib/labels';
import type { Household } from '../lib/types';
import { useI18n } from '../i18n';
import { useToast } from './Toast';

// What size was it? Where is the shutoff? Emergency facts come first.
export function FactsView({ household }: { household: Household }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [reading, setReading] = useState(false);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [category, setCategory] = useState<FactCategory>('other');
  const [shops, setShops] = useState<string[]>([]);

  const load = useCallback(async () => {
    try { setFacts(await listFacts(household.id)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [household.id]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<void>) {
    try { setErr(null); await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  async function fromPhoto(file: File | undefined) {
    if (!file) return;
    setReading(true); setErr(null);
    try {
      const f = await readLabel(household.id, file, lang);
      setTitle(f.title); setValue(f.value); setCategory(f.category); setShops(f.surface_at); setAdding(true);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(m.startsWith('label:') ? t(`label.err.${m.slice(6)}` as 'label.err.failed') : m);
    } finally { setReading(false); }
  }

  const groups = groupFacts(facts);
  return (
    <>
      <span className="muted">{t('facts.intro')}</span>
      {err && <p className="error">{err}</p>}
      {groups.length === 0 && <p className="muted">{t('facts.empty')}</p>}
      {groups.map((g) => (
        <div key={g.category} className="contents">
          <div className="label">{g.category === 'emergency' ? t('facts.emergencyCard') : t(`facts.cat.${g.category}` as const)}</div>
          {g.items.map((f) => (
            <div className="card" key={f.id}>
              <strong className={g.category === 'emergency' ? 'big' : undefined}>{f.title}</strong>
              {f.value && <span className={`prewrap${g.category === 'emergency' ? ' big' : ''}`}>{f.value}</span>}
              {f.surface_at.length > 0 && <span className="muted">{t('facts.shownAt', { shops: f.surface_at.map((s) => shopName(s, t)).join(', ') })}</span>}
              <div className="row"><button className="btn small danger" onClick={() => confirm(t('facts.confirmDelete')) && void run(() => deleteFact(f.id))}>{t('common.delete')}</button></div>
            </div>
          ))}
        </div>
      ))}
      {adding ? (
        <form className="card" onSubmit={(e) => { e.preventDefault(); void run(async () => {
          await addFact({ household_id: household.id, title: title.trim(), value: value.trim(), category, surface_at: shops });
          setTitle(''); setValue(''); setCategory('other'); setShops([]); setAdding(false);
          toast({ text: t('toast.saved') });
        }); }}>
          <input placeholder={t('facts.titlePh')} required value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea placeholder={t('facts.valuePh')} value={value} onChange={(e) => setValue(e.target.value)} />
          <div className="label nopad">{t('facts.type')}</div>
          <div className="chips">{FACT_ORDER.map((c) => (
            <button type="button" key={c} className={`chipbtn${category === c ? ' on' : ''}`} aria-pressed={category === c} onClick={() => setCategory(c)}>{t(`facts.cat.${c}` as const)}</button>
          ))}</div>
          <div className="label nopad">{t('facts.showAt')}</div>
          <div className="chips">{CATEGORIES.map((id) => (
            <button type="button" key={id} className={`chipbtn${shops.includes(id) ? ' on' : ''}`} aria-pressed={shops.includes(id)}
              onClick={() => setShops((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}>{shopName(id, t)}</button>
          ))}</div>
          <button className="btn primary">{t('facts.save')}</button>
          <button type="button" className="btn" onClick={() => setAdding(false)}>{t('common.cancel')}</button>
        </form>
      ) : (
        <div className="row">
          <button className="btn" onClick={() => setAdding(true)}>{t('facts.add')}</button>
          <label className={`btn${reading ? ' disabled' : ''}`}>
            <Icon name="camera" size={16} /> {reading ? t('label.reading') : t('label.button')}
            <input type="file" accept="image/*" capture="environment" hidden disabled={reading} onChange={(e) => { void fromPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <span className="muted">{t('label.intro')}</span>
        </div>
      )}
    </>
  );
}
