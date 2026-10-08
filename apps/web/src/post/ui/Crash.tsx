import { Component, useState, type ReactNode } from 'react';
import type { Controller } from '../core/controller.ts';
import { healthReport } from '../core/health.ts';
import { healthInput } from './Health.tsx';
import { copyText, reloadPost } from './recover.ts';
import { go, useC } from './ctx.tsx';
import { Mark } from './ui.tsx';

interface Props { controller: Controller; /** the outermost one has no theme around it, so it brings its own page */ page?: boolean; children: ReactNode }
interface Snap { error: unknown }

/**
 * Catches a screen that throws while it is drawn, so that one broken screen never leaves a white page. It writes the error down for the Health
 * page, and shows a way out instead.
 */
export class ErrorBoundary extends Component<Props, Snap> {
  state: Snap = { error: null };
  static getDerivedStateFromError(error: unknown): Snap { return { error: error ?? new Error('Unknown error') }; }
  componentDidCatch(error: unknown) { try { this.props.controller.note('screen', error); } catch { /* writing it down must never be the next problem */ } }
  reset = () => { this.setState({ error: null }); };
  render() {
    if (this.state.error === null) return this.props.children;
    const crashed = <Crashed reset={this.reset} />;
    return this.props.page ? <div className="post">{crashed}</div> : crashed;
  }
}

function Crashed({ reset }: { reset: () => void }) {
  const c = useC();
  const [report, setReport] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    let text: string;
    try { text = healthReport(healthInput(c, c.getState(), Date.now())); } catch { text = `Post problem report\n${navigator.userAgent}\n${c.problems().map((p) => p.text).join('\n')}`; }
    setReport(text);
    setSaid((await copyText(text)) ? 'Copied. Paste it where you report problems.' : 'Press and hold the text below to copy it.');
  };
  const again = () => { reset(); go({ name: 'inbox' }, { replace: true }); };
  const reread = async () => { setBusy(true); try { await c.readAgain(); } catch (e) { c.note('screen', e); } setBusy(false); again(); };
  return (
    <div className="crash" role="alert">
      <div className="mark"><Mark size={40} /></div>
      <h1 className="h2">Something went wrong on this screen</h1>
      <p className="crash-tag">Your mail is safe in Outlook, and anything that was waiting to be sent is still saved on this phone.</p>
      <button className="cta" onClick={again}>Back to the inbox</button>
      <button className="alt" disabled={busy} onClick={() => void reread()}>{busy ? 'Reading your mail…' : 'Read my mail again'}</button>
      <button className="alt" onClick={() => void reloadPost()}>Start Post over</button>
      <button className="alt" onClick={() => void copy()}>Copy problem report</button>
      {said && <p className="auth-fine" role="status">{said}</p>}
      {report && <textarea className="field code-box" readOnly aria-label="Problem report" rows={9} value={report} onFocus={(e) => e.currentTarget.select()} />}
    </div>
  );
}
