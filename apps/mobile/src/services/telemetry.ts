/**
 * Crash-reporting seam (mobile).
 *
 * Dependency-free by design: no Sentry SDK or DSN yet, so this tags errors to
 * the console and routes them through a single funnel. When a provider is
 * adopted, call `setCrashReporter(Sentry.captureException)` once at startup and
 * every call site (ErrorBoundary, the global handler) ships to it unchanged.
 *
 * `initTelemetry()` chains React Native's global `ErrorUtils` handler so fatal
 * errors outside the React tree are captured, and adds an unhandledrejection
 * listener on Expo web.
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

interface ErrorUtilsLike {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}

let installed = false;

/** Chain the global error handlers. Idempotent. */
export function initTelemetry(): void {
  if (installed) return;
  installed = true;

  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (dsn && !reporter) {
    // eslint-disable-next-line no-console
    console.warn('[RushPoint] EXPO_PUBLIC_SENTRY_DSN is set but no crash reporter is registered — call setCrashReporter() to activate it.');
  }

  // React Native: chain the existing ErrorUtils handler so we report but still
  // let the runtime show its red-box / crash as before.
  const eu = (globalThis as unknown as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (eu?.setGlobalHandler && eu.getGlobalHandler) {
    const prev = eu.getGlobalHandler();
    eu.setGlobalHandler((error, isFatal) => {
      reportError(error, { source: 'ErrorUtils', isFatal });
      prev?.(error, isFatal);
    });
  }

  // Expo web: also catch rejected promises.
  const w = globalThis as unknown as {
    addEventListener?: (t: string, cb: (e: { reason?: unknown }) => void) => void;
  };
  w.addEventListener?.('unhandledrejection', (e) =>
    reportError(e.reason, { source: 'unhandledrejection' }),
  );
}
