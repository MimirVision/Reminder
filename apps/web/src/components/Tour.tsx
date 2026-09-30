import { useState } from 'react';
import { addMemory, addPlace, notifyPartnerIfSet } from '../lib/api';
import { CATEGORIES, categoryName } from '../lib/labels';
import type { Household } from '../lib/types';
import { useI18n } from '../i18n';
import { Icon } from './icons';
import { Sheet } from './Sheet';
import { pushSupport } from '../lib/push';
import { NotificationsControl } from './NotificationsControl';

export const tourKey = (hid: string) => `hm.tourDone.${hid}`;

// Three quick steps for the first visit: one real to-do, the shops you use, and the home screen and notifications.
export function Tour({ household, onClose, onChanged }: { household: Household; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [text, setText] = useState('');
  const [added, setAdded] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const finish = () => { try { localStorage.setItem(tourKey(household.id), '1'); } catch { /* ignore */ } onClose(); };

  async function next() {
    setBusy(true); setErr(null);
    try {
      if (step === 1 && text.trim() && !added) { const m = await addMemory({ household_id: household.id, body: text.trim() }); notifyPartnerIfSet([m.id]); setAdded(true); onChanged(); }
      if (step === 2 && picked.length) {
        for (const c of picked) await addPlace({ household_id: household.id, name: categoryName(c, t), kind: 'category', category: c, lat: null, lon: null, radius_m: 150 });
        setPicked([]); onChanged();
      }
      if (step === 3) return finish();
      setStep(step + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <Sheet label={t('tour.title')} onClose={finish}>
      <div className="row spread"><h2>{t('tour.title')}</h2><button className="link quiet" onClick={finish}>{t('tour.skip')}</button></div>
      <span className="muted">{t('tour.step', { n: step })}</span>
      <div className="dots" role="img" aria-label={t('tour.step', { n: step })}>{[1, 2, 3].map((n) => <span key={n} className={n <= step ? 'on' : ''} />)}</div>
      <h3 className="tour-h">{t(`tour.${step}.title` as 'tour.1.title')}</h3>
      <p className="muted nomargin">{t(`tour.${step}.body` as 'tour.1.body')}</p>
      {step === 1 && (added
        ? <span className="chip"><Icon name="check" size={13} />{t('tour.added')}: {text}</span>
        : <input autoFocus placeholder={t('tour.1.ph')} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void next(); }} />)}
      {step === 2 && (
        <div className="chips">{CATEGORIES.map((c) => (
          <button key={c} type="button" className={`chipbtn${picked.includes(c) ? ' on' : ''}`} aria-pressed={picked.includes(c)}
            onClick={() => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))}>{categoryName(c, t).replace(/ \(.*\)$/, '')}</button>
        ))}</div>
      )}
      {step === 3 && (
        <>
          <p className="muted nomargin">{t('tour.ios')}</p>
          {pushSupport() !== 'needs-install' && <NotificationsControl />}
        </>
      )}
      {err && <p className="error" role="alert">{err}</p>}
      <button className="btn primary big" disabled={busy} onClick={() => void next()}>{step === 3 ? t('tour.finish') : t('tour.next')}</button>
    </Sheet>
  );
}
