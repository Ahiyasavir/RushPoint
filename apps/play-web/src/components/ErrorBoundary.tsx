import React from 'react';
import { translations } from '../i18n';
import { loadLang } from '../store';
import { reportError } from '../services/telemetry';

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
    // Funnel through the telemetry seam (console-only until a Sentry DSN is set).
    reportError(error, { boundary: 'play-root', componentStack: info.componentStack });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      // Class component → no hooks; read the stored language directly so the crash
      // fallback still renders in the participant's language.
      const c = translations[loadLang()].common;
      return (
        <div className="min-h-screen flex items-center justify-center bg-app-bg p-6" dir={loadLang() === 'he' ? 'rtl' : 'ltr'}>
          <div className="max-w-sm w-full bg-app-card border border-glass-border rounded-2xl p-7 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <h1 className="font-brand text-xl font-bold text-zinc-100 mb-2">{c.errorTitle}</h1>
            <p className="text-zinc-500 text-sm mb-6">{c.errorBody}</p>
            <div className="flex gap-2 justify-center">
              <button onClick={this.reset}
                className="bg-accent text-black rounded-lg px-4 py-2 text-sm font-semibold">
                {c.tryAgain}
              </button>
              <button onClick={() => window.location.reload()}
                className="border border-glass-border text-zinc-500 rounded-lg px-4 py-2 text-sm">
                {c.reload}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
