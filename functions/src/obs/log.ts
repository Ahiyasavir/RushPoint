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
import { withCallableAttribution, invocationFirestoreCost } from '../opCounter';

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
    // The MESSAGE, not just the code. `invalid-argument` is thrown from a dozen
    // separate guards in updateGame and the message is the only thing that names
    // WHICH one (and which stage/task) — without it a refused autosave logs a line
    // that proves only "something was invalid". That gap cost a live debugging
    // session on 2026-08-20, where a creator's every save was being rejected and
    // the logs could not say why.
    const message = (err as { message?: unknown } | undefined)?.message;
    if (code) {
      active.warn('callable.error', {
        ...meta,
        errorCode: code,
        // Omitted rather than stringified when absent, so a blank never shows up
        // as the literal "undefined" in a log search.
        ...(typeof message === 'string' && message.trim() !== '' ? { errorMessage: message } : {}),
        ms,
      });
    }
    else active.error('callable.crash', { ...meta, err: String(err), ms });
    throw err;
  }
}

/** A best-effort (non-fatal) side effect failed — log a warn, never throw. */
export function logBestEffort(op: string, ctx: Record<string, unknown>, err: unknown): void {
  active.warn('bestEffort.failed', { op, ...redact(ctx), err: String(err) });
}

/**
 * A best-effort side effect SUCCEEDED — log an info, never throw. Exists so a
 * success breadcrumb isn't emitted through logBestEffort, which stamps every
 * record `warn`/`bestEffort.failed`: a delivered email showing up as a failure is
 * exactly the sort of thing that misleads the next person reading the log.
 */
export function logBestEffortOk(op: string, ctx: Record<string, unknown>): void {
  active.info('bestEffort.ok', { op, ...redact(ctx) });
}

// Cost containment (change: cost-containment-max-instances): no callable in this
// codebase has ever set maxInstances, so a runaway loop or an abuse spike can
// scale to Google's project-wide instance ceiling and generate a real bill. Every
// callable is built via loggedCallable (verified: zero direct
// `functions.https.onCall` call sites elsewhere), so capping here bounds the
// worst case for all ~96 of them by construction — no per-call-site discipline
// required.
//
// THE DEFAULT IS 3, NOT 10. The operating budget for this project is ~$10/month
// on Blaze, and a uniform ceiling of 10 does not respect it: 96 callables x 10 is
// 960 concurrent gen1 instances, which if flooded bills on the order of
// $2,000-2,500 per 24h. 3 is still far above real demand — the app's realistic
// peak is a few hundred participants firing SHORT callables, and at ~200ms per
// call 3 concurrent instances serve ~15 requests/second PER CALLABLE, which
// comfortably covers a 100-200 player event with headroom to spare. The callables
// that genuinely see per-player-per-action traffic keep a higher ceiling via
// HOT_PATH_MAX_INSTANCES below, so nothing a real event does gets throttled.
export const DEFAULT_MAX_INSTANCES = 3;

/**
 * Per-callable ceilings for the genuinely hot paths — the callables a live event
 * hits once per player per action, plus the two fan-out ones that already ask for
 * extra time/memory. Everything absent from this map runs at
 * DEFAULT_MAX_INSTANCES.
 *
 * This lives HERE, as data, rather than as a `maxInstances` argument at each call
 * site: the whole cost property of this codebase is "one file decides the
 * ceiling", and spraying the numbers across functions/src is how a cap quietly
 * becomes 96 independent decisions nobody re-reads. One map, one review.
 *
 * PRECEDENCE (widest to narrowest — narrowest wins):
 *   1. DEFAULT_MAX_INSTANCES              — applied by resolveRuntimeOpts.
 *   2. HOT_PATH_MAX_INSTANCES[name]       — overrides the default for this name.
 *   3. runtimeOpts.maxInstances (explicit) — overrides both, at the call site.
 * Implemented by spread order in withHotPathCeiling/resolveRuntimeOpts: each
 * later spread overwrites the earlier one's maxInstances.
 *
 * WORST-CASE ARITHMETIC (what these numbers cost):
 *   before: 96 callables x 10                    =  960 concurrent instances
 *   now:    13 hot x 10  +  ~83 others x 3       =  ~379 concurrent instances
 * i.e. the flooded ceiling drops ~2.5x, and the ceiling for the ~83 cold
 * callables — the ones an abuser would pick precisely because nobody watches
 * them — drops 3.3x. Sustained-flood exposure scales with that number, so the
 * $2,000-2,500/24h worst case becomes roughly $800-1,000/24h; a Blaze budget
 * alert remains the actual stop, this is the ceiling that makes the alert
 * survivable.
 */
export const HOT_PATH_MAX_INSTANCES: Record<string, number> = {
  // Per player, per task, throughout the whole run — the true hot loop.
  requestNextTask: 10,
  completeTask: 10,
  submitTaskAnswer: 10,
  submitSequenceStep: 10,
  reportArrival: 10,
  getMyTeamState: 10,
  verifyStationCode: 10,
  submitStationPhoto: 10,
  // Continuous background GPS pings from every device at once.
  updateLocation: 10,
  // Thundering herd: a whole event scans the join code within the same minute.
  getJoinInfo: 10,
  joinRun: 10,
  // Fan-out over every team in one invocation (already runWith 180s/512MB).
  startTeams: 10,
  finalizeRun: 10,
};

/**
 * Merge a per-callable `maxInstances` cost cap into runtimeOpts. Additive, not
 * exclusive: existing timeout/memory settings are preserved, and an explicit
 * `maxInstances` on the passed opts always wins (lets a heavy callable raise its
 * own ceiling) — the default only fills the gap when the caller didn't set one.
 * That "caller wins" rule is what lets withHotPathCeiling raise a hot callable.
 */
export function resolveRuntimeOpts(runtimeOpts?: functions.RuntimeOptions): functions.RuntimeOptions {
  return { maxInstances: DEFAULT_MAX_INSTANCES, ...runtimeOpts };
}

/**
 * Fold this callable's HOT_PATH_MAX_INSTANCES entry (if any) into its runtimeOpts,
 * BELOW an explicit per-call-site `maxInstances` — see the precedence block above.
 * A name with no entry is returned untouched, so it falls through to the default.
 */
export function withHotPathCeiling(
  name: string,
  runtimeOpts?: functions.RuntimeOptions,
): functions.RuntimeOptions | undefined {
  const hot = Object.prototype.hasOwnProperty.call(HOT_PATH_MAX_INSTANCES, name)
    ? HOT_PATH_MAX_INSTANCES[name]
    : undefined;
  if (typeof hot !== 'number' || !Number.isFinite(hot) || hot <= 0) return runtimeOpts;
  return { maxInstances: hot, ...runtimeOpts };
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
 *
 * The instance ceiling is resolved here, by NAME, so no call site has to know
 * about cost: withHotPathCeiling applies HOT_PATH_MAX_INSTANCES (an explicit
 * runtimeOpts.maxInstances still wins) and resolveRuntimeOpts fills
 * DEFAULT_MAX_INSTANCES into whatever gap is left.
 */
/**
 * Emit one invocation's Firestore cost as a structured record (change:
 * spark-tier-location-load). A no-op unless RUSHPOINT_FS_OPCOUNT=1.
 *
 * The marker string is stable and greppable on purpose — it is what an offline aggregator
 * keys on to total a whole run's cost from the logs, which is the only way to measure a
 * multi-process runtime (see opCounter.ts). Never throws: instrumentation must not be able
 * to fail the call it just measured.
 */
function logFirestoreCost(callable: string): void {
  try {
    const cost = invocationFirestoreCost();
    if (!cost) return;
    functions.logger.info('fsops', {
      callable,
      reads: cost.reads,
      writes: cost.writes,
    });
  } catch {
    // Swallowed by design — see above.
  }
}

export function loggedCallable(
  name: string,
  handler: CallableHandler,
  runtimeOpts?: functions.RuntimeOptions,
) {
  return functions.runWith(resolveRuntimeOpts(withHotPathCeiling(name, runtimeOpts))).https.onCall(async (data, context) =>
    // Firestore op attribution (change: spark-tier-location-load) wraps the OUTERMOST
    // layer so every read and write the invocation performs — including inside logCall's
    // own work — is charged to this callable. It is an AsyncLocalStorage context, so it
    // survives every await below; when counting is disabled it calls straight through.
    withCallableAttribution(name, async () => {
      try {
        return await logCall(
          { callable: name, uid: context.auth?.uid, ...idsFromPayload(data) },
          // Backstop: a callable must never return a non-finite number — one Infinity
          // crashes the ENTIRE response at JSON-encode. Degrade any to null here so a
          // computation bug becomes a benign null field, not a failed call.
          async () => sanitizeFinite(await handler(data, context)),
        );
      } finally {
        // In `finally`, so a FAILED call still reports what it spent — a callable that
        // throws after twenty reads has still spent twenty reads of the daily quota, and
        // that is exactly the sort of cost that otherwise hides.
        logFirestoreCost(name);
      }
    }),
  );
}
