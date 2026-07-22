// Structured observability for callables (change: observability-instrumentation).
//
// Two helpers + one wrapper, all funneling through `firebase-functions` logger so
// records are queryable JSON in Cloud Logging (never string-concatenated):
//   - logCall(meta, body)        — one entry/exit line per callable invocation.
//   - logBestEffort(op, ctx, err)— a non-fatal side effect failed (was a silent catch).
//   - loggedCallable(name, fn)   — wraps functions.https.onCall, adding logCall.
//
// Redaction is structural: logCall accepts only the typed CallMeta (ids + sizes),
// so a caller cannot pass a display name / answer key into the success log; the
// best-effort context is run through `redact()` to drop known-sensitive keys.

import * as functions from 'firebase-functions';
import { sanitizeFinite } from '@rushpoint/shared';

export interface CallMeta {
  callable: string;
  uid?: string;
  runId?: string;
  gameId?: string;
}

/** Minimal logger surface — the seam a test fake implements. */
export interface ObsLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

// Keys that must never reach a log record (answer keys, secrets, PII).
const REDACT_KEYS = new Set<string>([
  'answer', 'answers', 'numericAnswer', 'steps', 'hint', 'secretCode',
  'pin', 'code', 'customToken', 'photoUrl', 'displayName', 'memberNames',
  'registrationData', 'email', 'password', 'recoveryKey',
]);

/** Drop known-sensitive keys from a free-form context object before logging. */
export function redact(ctx?: Record<string, unknown>): Record<string, unknown> {
  if (!ctx) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (REDACT_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

let active: ObsLogger = functions.logger;

/** Test seam — swap the active logger. */
export function __setObsLogger(logger: ObsLogger): void {
  active = logger;
}
/** Test seam — restore the real firebase logger. */
export function __resetObsLogger(): void {
  active = functions.logger;
}

/**
 * Wrap a callable's body. Emits exactly one structured record per invocation —
 * info on success, warn (with errorCode) for a thrown HttpsError, error for an
 * unexpected throw — and ALWAYS re-throws (changes visibility, not control flow).
 */
export async function logCall<T>(meta: CallMeta, body: () => Promise<T>): Promise<T> {
  const startedAtMs = Date.now();
  try {
    const result = await body();
    active.info('callable.ok', { ...meta, ms: Date.now() - startedAtMs });
    return result;
  } catch (err) {
    const ms = Date.now() - startedAtMs;
    const code = (err as { code?: string } | undefined)?.code;
    if (code) active.warn('callable.error', { ...meta, errorCode: code, ms });
    else active.error('callable.crash', { ...meta, err: String(err), ms });
    throw err;
  }
}

/** A best-effort (non-fatal) side effect failed — log a warn, never throw. */
export function logBestEffort(op: string, ctx: Record<string, unknown>, err: unknown): void {
  active.warn('bestEffort.failed', { op, ...redact(ctx), err: String(err) });
}

// Cost containment (change: cost-containment-max-instances): no callable in this
// codebase has ever set maxInstances, so a runaway loop or an abuse spike can
// scale to Google's project-wide instance ceiling and generate a real bill. Every
// callable is built via loggedCallable (verified: zero direct
// `functions.https.onCall` call sites elsewhere), so capping here bounds the
// worst case for all ~85 of them by construction — no per-call-site discipline
// required. 10 concurrent instances comfortably covers this app's realistic peak
// (a few hundred concurrent participants firing short, cheap callables) while
// keeping worst-case spend bounded; a genuinely heavy callable can still opt
// into a higher ceiling by passing its own `maxInstances` in runtimeOpts.
export const DEFAULT_MAX_INSTANCES = 10;

/**
 * Merge a per-callable `maxInstances` cost cap into runtimeOpts. Additive, not
 * exclusive: existing timeout/memory settings are preserved, and an explicit
 * `maxInstances` on the passed opts always wins (lets a heavy callable raise its
 * own ceiling) — the default only fills the gap when the caller didn't set one.
 */
export function resolveRuntimeOpts(runtimeOpts?: functions.RuntimeOptions): functions.RuntimeOptions {
  return { maxInstances: DEFAULT_MAX_INSTANCES, ...runtimeOpts };
}

// firebase-functions v1 onCall handler signature is (data: any, context). We
// mirror it so loggedCallable is a drop-in for functions.https.onCall — only the
// opening line of each callable changes.
type CallableHandler = (
  data: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  context: functions.https.CallableContext,
) => unknown | Promise<unknown>;

/** Pull stable correlation ids (never secrets) from a callable payload. */
function idsFromPayload(data: unknown): Pick<CallMeta, 'runId' | 'gameId'> {
  const d = (data ?? {}) as Record<string, unknown>;
  const out: Pick<CallMeta, 'runId' | 'gameId'> = {};
  if (typeof d.runId === 'string') out.runId = d.runId;
  if (typeof d.gameId === 'string') out.gameId = d.gameId;
  return out;
}

/**
 * Drop-in replacement for `functions.https.onCall` that adds one structured log
 * line per invocation via logCall. The callable body is unchanged. The log record
 * carries `runId`/`gameId` from the payload when present so a reported issue can
 * be correlated to its run (ids only — never answer keys / PII).
 *
 * `runtimeOpts` is optional and additive: every existing call site keeps the v1
 * default (60s / 256MB). Pass e.g. `{ timeoutSeconds: 180, memory: '512MB' }` for
 * a callable whose work legitimately needs more time/headroom than the default
 * (bulk per-team fan-out) — see startTeams/finalizeRun (perf: run-perf-scale).
 */
export function loggedCallable(
  name: string,
  handler: CallableHandler,
  runtimeOpts?: functions.RuntimeOptions,
) {
  return functions.runWith(resolveRuntimeOpts(runtimeOpts)).https.onCall(async (data, context) =>
    logCall(
      { callable: name, uid: context.auth?.uid, ...idsFromPayload(data) },
      // Backstop: a callable must never return a non-finite number — one Infinity
      // crashes the ENTIRE response at JSON-encode. Degrade any to null here so a
      // computation bug becomes a benign null field, not a failed call.
      async () => sanitizeFinite(await handler(data, context)),
    ),
  );
}
