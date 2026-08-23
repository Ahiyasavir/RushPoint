// Server-side App Check guard (change: app-check-ready) — PROVIDED, NOT WIRED.
//
// `assertAppCheck` is the single place that decides whether a callable rejects a
// request that arrived without a verified App Check token. It is deliberately NOT
// called by any callable yet: turning it on before the real web apps are registered
// in the Firebase console (and before every deployed client actually attaches a
// token) would reject 100% of real traffic, and the emulator never mints App Check
// tokens at all, so the e2e/rules/simulate suites would go red as a body.
//
// Rollout, once the console registration exists:
//   1. call `assertAppCheck(context, 'monitor')` at the top of a callable and read
//      the `appCheck.missing` warnings in Cloud Logging until they stop appearing;
//   2. only then move that callable to 'enforce'.
// The mode should come from config/env — never hardcode 'enforce' at a call site.
//
// Contract:
//   * mode 'off'     — pure no-op (no log, no throw).
//   * mode 'monitor' — logs one structured warn when the token is missing; serves.
//   * mode 'enforce' — throws failed-precondition ONLY when `context.app` is absent.
// Anything else (an unknown mode string, a missing context) is treated as 'off' —
// the guard must never be the reason a legitimate request fails.

import * as functions from 'firebase-functions';
import type { AppCheckEnforcement } from '@rushpoint/shared';

/** Minimal view of the callable context this guard needs (v1 CallableContext). */
export interface AppCheckContext {
  app?: unknown;
  auth?: { uid?: string } | null;
}

/**
 * Enforce (or merely observe) App Check attestation for one callable invocation.
 *
 * @param context the callable context — `context.app` is populated by the Functions
 *                runtime only when a VERIFIED App Check token accompanied the call.
 * @param mode    'off' | 'monitor' | 'enforce' (see AppCheckEnforcement). Defaults
 *                to 'off', so an omitted/garbled mode can never lock users out.
 * @param callable optional callable name, for the monitor-mode log record.
 * @throws functions.https.HttpsError('failed-precondition') in 'enforce' mode only.
 */
export function assertAppCheck(
  context: AppCheckContext | undefined | null,
  mode: AppCheckEnforcement | undefined = 'off',
  callable?: string,
): void {
  if (mode !== 'monitor' && mode !== 'enforce') return; // 'off' and anything unknown
  const verified = !!context && context.app !== undefined && context.app !== null;
  if (verified) return;
  if (mode === 'monitor') {
    // Ids only — never a payload (matches obs/log.ts's structural redaction rule).
    functions.logger.warn('appCheck.missing', {
      callable: callable ?? 'unknown',
      uid: context?.auth?.uid,
      mode,
    });
    return;
  }
  throw new functions.https.HttpsError(
    'failed-precondition',
    'App Check verification failed.',
  );
}
