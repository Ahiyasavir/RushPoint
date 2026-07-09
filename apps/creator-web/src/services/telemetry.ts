/**
 * Crash-reporting seam (admin).
 *
 * Dependency-free by design: there's no Sentry SDK or DSN yet, so this just
 * tags errors to the console and routes them through a single funnel. When a
 * provider is adopted, call `setCrashReporter(Sentry.captureException)` once at
 * startup and every existing call site (ErrorBoundary, global handlers) starts
 * shipping to it — no other code changes.
 *
 * `initTelemetry()` installs window-level handlers so errors that escape React
 * (async callbacks, rejected promises) are captured too, not just render errors.
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

  // Wire the real crash provider behind the seam, gated on a DSN. The SDK is
  // dynamically imported (kept out of the main bundle) and only loaded when a
  // DSN is configured — with no DSN this is a no-op and behavior is console-only.
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
