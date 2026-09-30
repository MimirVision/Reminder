import { useEffect, useState } from 'react';
import { getSetupStatus } from '../lib/api';
import { buildSteps, progress, type SetupStep, type SetupTarget } from '../lib/setup';
import type { Household } from '../lib/types';
import { Icon } from './icons';

const HIDE_KEY = 'hm.setupHidden';
const hidden = () => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } };

// A compact card that steers a new household to the features that keep the app useful: house calendar, emergency card,
// iPhone reminders, and the partner. It shows only the next step (all steps one tap away), ticks itself off from real
// data, and can be hidden. It stays small so your actual to-dos are still the first thing you see.
export function SetupChecklist({ household, onNavigate }: { household: Household; onNavigate: (t: SetupTarget) => void }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getSetupStatus>> | null>(null);
  const [hide, setHide] = useState(hidden);
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (hide) return;
    getSetupStatus(household.id).then(setStatus).catch(() => setStatus(null));
  }, [household.id, hide]);

  if (hide || !status) return null;
  const steps = buildSteps(status);
  const p = progress(steps);
  if (p.complete) return null;
  const next = steps.find((s) => !s.done)!;

  const go = (s: SetupStep) => {
    if (s.id === 'emergency') { try { sessionStorage.setItem('hm.houseMode', 'Facts'); } catch { /* ignore */ } }
    onNavigate(s.go);
  };

  return (
    <section className="card setup" aria-label="Get set up">
      <div className="row spread">
        <span><strong>Get set up</strong> <span className="muted">{p.done} of {p.total}</span></span>
        <button className="link quiet" onClick={() => { try { localStorage.setItem(HIDE_KEY, '1'); } catch { /* ignore */ } setHide(true); }}>Hide</button>
      </div>
      <div className="dots" role="img" aria-label={`${p.done} of ${p.total} steps done`}>
        {steps.map((s) => <span key={s.id} className={s.done ? 'on' : ''} />)}
      </div>

      {!all ? (
        <div className="setup-next">
          <strong>{next.title}</strong>
          <span className="muted">{next.why}</span>
          <div className="row">
            <button className="btn small primary" onClick={() => go(next)}>{next.cta}</button>
            <button className="link" onClick={() => setAll(true)}>All steps</button>
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
          <button className="link" style={{ textAlign: 'left' }} onClick={() => setAll(false)}>Show only the next step</button>
        </>
      )}
    </section>
  );
}
