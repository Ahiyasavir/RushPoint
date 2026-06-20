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

  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (dsn && !reporter) {
    // eslint-disable-next-line no-console
    console.warn('[RushPoint] VITE_SENTRY_DSN is set but no crash reporter is registered — call setCrashReporter() to activate it.');
  }

  window.addEventListener('error', (e) => reportError(e.error ?? e.message, { source: 'window.onerror' }));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, { source: 'unhandledrejection' }));
}
