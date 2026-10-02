import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode; label: string; closeLabel: string; reloadLabel: string; onClose?: () => void };

// If one screen throws, show what happened and a way out instead of a blank page.
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('screen crashed', error); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="card crash" role="alert">
        <strong>{this.props.label}</strong>
        <span className="muted">{error.message}</span>
        <div className="row">
          {this.props.onClose && <button className="btn" onClick={() => { this.setState({ error: null }); this.props.onClose?.(); }}>{this.props.closeLabel}</button>}
          <button className="btn primary" onClick={() => window.location.reload()}>{this.props.reloadLabel}</button>
        </div>
      </div>
    );
  }
}
