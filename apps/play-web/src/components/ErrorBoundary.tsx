import React from 'react';

interface Props { children: React.ReactNode }
interface State { error: Error | null }

/**
 * Top-level crash guard for the participant app. A render error in any screen
 * would otherwise blank the whole app mid-race; instead we catch it, log it
 * (a production Sentry hook slots into componentDidCatch), and offer a recover
 * button so the team can keep racing without losing their session.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Seam for crash reporting (Sentry, etc.). Console for now.
    console.error('[play-web] crash:', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-app-bg p-6">
          <div className="max-w-sm w-full bg-app-card border border-glass-border rounded-2xl p-7 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <h1 className="font-brand text-xl font-bold text-zinc-900 mb-2">Something went wrong</h1>
            <p className="text-zinc-500 text-sm mb-6">
              The app hit an unexpected error. Your progress is saved — try again, or
              reload if it keeps happening.
            </p>
            <div className="flex gap-2 justify-center">
              <button onClick={this.reset}
                className="bg-accent text-black rounded-lg px-4 py-2 text-sm font-semibold">
                Try again
              </button>
              <button onClick={() => window.location.reload()}
                className="border border-glass-border text-zinc-600 rounded-lg px-4 py-2 text-sm">
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
