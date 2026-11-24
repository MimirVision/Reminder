// If a screen fails while drawing itself, it shows what happened and a way on, instead of a blank app. Around each
// page (cleared when you go to another one) and around the whole app. Nothing is lost: data is in the database.
import { Component, type ReactNode } from 'react';
import { AlertTriangle, Copy, Home, RotateCcw } from 'lucide-react';

interface Props { children: ReactNode; resetKey?: string; onHome?: () => void }
interface State { error: Error | null; copied: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, copied: false });
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('Ledger screen failed', error, info.componentStack);
  }

  render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;
    const details = `${error.name}: ${error.message}\n${error.stack ?? ''}\n${__BUILD__}\n${location.href}`;
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-danger-soft text-danger"><AlertTriangle className="size-5" /></span>
        <h1 className="text-[17px] font-semibold">This screen hit a problem</h1>
        <p className="text-[13px] text-ink-2">Your data is safe. Reloading usually fixes it; if it keeps happening, copy the details and send them on.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <button onClick={() => location.reload()} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-hover"><RotateCcw className="size-4" /> Reload</button>
          {this.props.onHome && <button onClick={() => { this.setState({ error: null }); this.props.onHome!(); }} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[13px] hover:bg-hover"><Home className="size-4" /> Go to Home</button>}
          <button onClick={() => void navigator.clipboard?.writeText(details).then(() => this.setState({ copied: true }), () => {})}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] text-ink-2 hover:bg-hover"><Copy className="size-4" /> {copied ? 'Copied' : 'Copy details'}</button>
        </div>
        <p className="num mt-1 max-w-full truncate text-[11.5px] text-ink-3">{error.message}</p>
      </div>
    );
  }
}
