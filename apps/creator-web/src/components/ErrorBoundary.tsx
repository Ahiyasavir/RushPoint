import React from 'react';
import { reportError } from '../services/telemetry';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level crash guard. A render error in any page would otherwise blank the
 * whole creator console mid-event; instead we catch it, log it (a production
 * Sentry hook would slot into componentDidCatch), and show a recover button that
 * resets the boundary so the creator can keep working without a full reload.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportError(error, { componentStack: info.componentStack, boundary: 'admin-root' });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-app-bg p-6">
          <div className="max-w-md w-full bg-app-surface/80 backdrop-blur-xl border border-glass-border rounded-2xl p-8 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <h1 className="font-brand text-xl font-bold text-zinc-100 mb-2">
              Something went wrong
            </h1>
            <p className="text-zinc-400 text-sm mb-6">
              The dashboard hit an unexpected error. Your data is safe — try again,
              and if it keeps happening reload the page.
            </p>
            <pre className="text-start text-xs text-red-300/70 bg-black/30 rounded-lg p-3 mb-6 overflow-auto max-h-32">
              {this.state.error.message}
            </pre>
            <div className="flex gap-2 justify-center">
              <button
                onClick={this.reset}
                className="bg-neon-green/10 text-neon-green border border-neon-green/20 rounded-lg px-4 py-2 text-sm font-medium hover:bg-neon-green/20 transition-all"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="border border-glass-border bg-glass-bg hover:bg-glass-hover text-zinc-300 hover:text-zinc-100 rounded-lg px-4 py-2 text-sm transition-all"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
