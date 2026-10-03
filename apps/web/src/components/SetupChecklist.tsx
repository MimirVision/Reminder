import { useEffect, useState } from 'react';
import { getSetupStatus } from '../lib/api';
import { buildSteps, progress, type SetupStep, type SetupTarget } from '../lib/setup';
import type { Household } from '../lib/types';
import { Icon } from './icons';
import { useI18n } from '../i18n';

const HIDE_KEY = 'hm.setupHidden';
const hidden = () => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } };

// A compact card that steers a new household to the features that keep the app useful: house calendar, emergency card,
// iPhone reminders, and the partner. It shows only the next step (all steps one tap away), ticks itself off from real
// data, and can be hidden. It stays small so your actual to-dos are still the first thing you see.
export function SetupChecklist({ household, onNavigate, onVisible }: { household: Household; onNavigate: (t: SetupTarget) => void; onVisible?: (v: boolean) => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getSetupStatus>> | null>(null);
  const [hide, setHide] = useState(hidden);
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (hide) return;
    getSetupStatus(household.id).then(setStatus).catch(() => setStatus(null));
  }, [household.id, hide]);

  const steps = status ? buildSteps(status, t) : [];
  const p = progress(steps);
  const visible = !hide && !!status && !p.complete;
  useEffect(() => { onVisible?.(visible); }, [visible, onVisible]);
  if (!visible) return null;
  const next = steps.find((s) => !s.done)!;

  const go = (s: SetupStep) => {
    if (s.id === 'emergency') { try { sessionStorage.setItem('hm.houseMode', 'Facts'); } catch { /* ignore */ } }
    onNavigate(s.go);
  };

  return (
    <section className="card setup" aria-label={t('setup.title')}>
      <div className="row spread">
        <span><strong>{t('setup.title')}</strong> <span className="muted">{t('setup.progress', { done: p.done, total: p.total })}</span></span>
        <button className="link quiet" onClick={() => { try { localStorage.setItem(HIDE_KEY, '1'); } catch { /* ignore */ } setHide(true); }}>{t('setup.hideBtn')}</button>
      </div>
      <div className="dots" role="img" aria-label={t('setup.aria', { done: p.done, total: p.total })}>
        {steps.map((s) => <span key={s.id} className={s.done ? 'on' : ''} />)}
      </div>

      {!all ? (
        <div className="setup-next">
          <strong>{next.title}</strong>
          <span className="muted">{next.why}</span>
          <div className="row">
            <button className="btn small primary" onClick={() => go(next)}>{next.cta}</button>
            <button className="link" onClick={() => setAll(true)}>{t('setup.all')}</button>
          </div>
        </div>
      ) : (
        <>
          {steps.map((s) => (
            <div key={s.id} className={`setup-step${s.done ? ' done' : ''}`}>
              <span className={`check${s.done ? ' on' : ''}`} aria-hidden="true">{s.done && <Icon name="check" size={14} />}</span>
              <div className="setup-text">
                <strong>{s.title}</strong>
                {!s.done && <span className="muted">{s.why}</span>}
                {!s.done && <div><button className="btn small" onClick={() => go(s)}>{s.cta}</button></div>}
              </div>
            </div>
          ))}
          <button className="link left" onClick={() => setAll(false)}>{t('setup.onlyNext')}</button>
        </>
      )}
    </section>
  );
}
