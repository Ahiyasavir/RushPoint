import React from 'react';
import { translations } from '../i18n';
import { loadLang } from '../store';
import { reportError } from '../services/telemetry';

interface Props { children: React.ReactNode }
interface State { error: Error | null; autoRetries: number }

// How many times this boundary silently re-renders its children before showing
// the crash UI. Bounded to 1 per boundary lifetime so a persistent error can't
// loop forever — the manual buttons handle anything the single auto-retry missed.
const MAX_AUTO_RETRIES = 1;
// Delay before the automatic re-render, giving a transient blip (a data-consistency
// window, a stale lazy chunk mid-redeploy) a moment to clear.
const AUTO_RETRY_DELAY_MS = 1_200;

/**
 * Top-level crash guard for the participant app. A render error in any screen
 * would otherwise blank the whole app mid-race; instead we catch it, log it
 * (a production Sentry hook slots into componentDidCatch), and — for the common
 * TRANSIENT throw (a brief data window, a stale lazy chunk during a redeploy) —
 * auto-retry ONCE before falling back to the manual recover button so the team
 * keeps racing without losing their session.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, autoRetries: 0 };
  private retryTimer: number | undefined;

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Merge ONLY `error` — leave `autoRetries` intact so componentDidCatch can see
    // how many auto-retries this boundary has already spent and stop at the bound.
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Funnel through the telemetry seam (console-only until a Sentry DSN is set) —
    // on EVERY catch, including the one that precedes an auto-retry.
    reportError(error, { boundary: 'play-root', componentStack: info.componentStack });
    // First transient throw: schedule ONE silent re-render. If the same boundary
    // catches again (autoRetries already spent) we leave the error set and the
    // crash UI with its manual try-again / reload buttons shows.
    if (this.state.autoRetries < MAX_AUTO_RETRIES) {
      this.retryTimer = window.setTimeout(() => {
        this.setState((s) => ({ error: null, autoRetries: s.autoRetries + 1 }));
      }, AUTO_RETRY_DELAY_MS);
    }
  }

  componentWillUnmount() {
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer);
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
