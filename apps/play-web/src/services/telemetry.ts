/**
 * Crash-reporting funnel (participant app).
 *
 * Mirrors the creator-web telemetry seam so play-web captures crashes the same
 * way: a single `reportError` funnel, an injectable `setCrashReporter` provider,
 * and `initTelemetry()` global handlers for errors that escape React (async
 * callbacks, rejected promises). The real provider (Sentry) is wired behind the
 * seam via a DSN-gated dynamic import — with no `VITE_SENTRY_DSN` it is
 * console-only, exactly as before.
 */

type Reporter = (error: unknown, context?: Record<string, unknown>) => void;

let reporter: Reporter | null = null;

/** Register the real crash reporter (e.g. Sentry.captureException). */
export function setCrashReporter(fn: Reporter): void {
  reporter = fn;
}

/** Funnel every caught error through here. Safe to call before init. */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error('[RushPoint] reportError:', error, context ?? '');
  try {
    reporter?.(error, context);
  } catch {
    // A broken reporter must never mask the original error.
  }
}

let installed = false;

/** Install global error / unhandled-rejection handlers. Idempotent. */
export function initTelemetry(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e) => reportError(e.error ?? e.message, { source: 'window.onerror' }));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, { source: 'unhandledrejection' }));

  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (dsn && !reporter) {
    // The specifier is a variable (not a literal) + @vite-ignore so the bundler
    // never tries to resolve the OPTIONAL @sentry/browser at build time. With no
    // DSN this branch never runs, so the SDK is loaded only when actually wired.
    const mod = '@sentry/browser';
    void import(/* @vite-ignore */ mod)
      .then((Sentry: { init(o: { dsn: string; tracesSampleRate?: number }): void;
                       captureException(e: unknown, h?: { extra?: Record<string, unknown> }): void }) => {
        Sentry.init({ dsn, tracesSampleRate: 0 });
        setCrashReporter((error, context) => Sentry.captureException(error, { extra: context }));
      })
      .catch(() => {
        // @sentry/browser not installed → stay console-only. Never mask app startup.
        // eslint-disable-next-line no-console
        console.warn('[RushPoint] VITE_SENTRY_DSN is set but @sentry/browser is not installed.');
      });
  }
}
