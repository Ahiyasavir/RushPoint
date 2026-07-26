// ─── getJoinInfo — ported from functions/src/runs/index.ts:381-421 ───────────
//
// Proof-of-port #1. The response shape is byte-identical to the Cloud Function's
// so `apps/play-web/src/services/calls.ts` needs no change: same keys, same
// order-independent values, same error codes at the same decision points.
//
// WHAT CHANGED (and only this):
//   * three `db.doc(...).get()` calls  → three repository reads.
//   * `functions.https.HttpsError`     → the protocol layer's `HttpsError`
//                                        (same constructor signature, same codes).
//   * `validate(() => normalizeAccessCode(code))` → a try/catch that maps the
//     shared validator's throw to `invalid-argument`, because `validate()` lives
//     in the functions package and is itself just that mapping.
//
// WHAT DID NOT CHANGE: the order of the checks. `revoked` is refused BEFORE the
// game is read, and `assertGameNotDeleted` still runs even though a soft-delete
// revokes the code — the "belt and braces" comment in the original explains why
// (a code predating that change, or one hand-edited back to unused).
//
// The parallel game+run read from the original (run-perf-scale, Task 2) is kept:
// once the access code has resolved ownerUid/gameId/runId the two reads are
// independent, and on a 2-vCPU box with a network hop to Postgres the round-trip
// saving matters more, not less.

import { describeGameRequirements, normalizeAccessCode } from '@rushpoint/shared';
import type { Game, Run } from '@rushpoint/shared';
import { defineCallable, HttpsError } from '../callable.js';
import type { ApiDeps } from '../deps.js';

export const getJoinInfo = defineCallable<ApiDeps>('getJoinInfo', async (data, context, deps) => {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  await deps.enforceRateLimit(context.auth.uid, 'getJoinInfo');

  const { code } = (data ?? {}) as { code?: unknown };

  let normalizedCode: string;
  try {
    normalizedCode = normalizeAccessCode(code);
  } catch (err) {
    throw new HttpsError('invalid-argument', (err as Error)?.message ?? 'Invalid access code');
  }

  const accessCode = await deps.repo.getAccessCode(normalizedCode);
  if (!accessCode) throw new HttpsError('not-found', 'Invalid access code');
  if (accessCode.status === 'revoked') throw new HttpsError('permission-denied', 'Code revoked');

  const { ownerUid, gameId, runId } = accessCode;
  const [game, run] = await Promise.all([
    deps.repo.getGame({ ownerUid, gameId }),
    deps.repo.getRun({ ownerUid, gameId, runId }),
  ]);

  if (!game) throw new HttpsError('not-found', 'Game not found');
  assertGameNotDeleted(game);

  return {
    context: { ownerUid, gameId, runId },
    title: game.title,
    description: game.description ?? '',
    mode: game.mode,
    branding: game.branding ?? null,
    registrationFields: game.registrationFields,
    runStatus: (run as Run | null)?.status ?? 'live',
    isTestDrive: (run as Run | null)?.isTestDrive ?? false,
    requirement: describeGameRequirements(game),
  };
});

/**
 * The local twin of `functions/src/games/lifecycle.ts:20`. A tombstoned game is
 * `not-found`, never `permission-denied` — leaking "this exists but you may not
 * have it" about a trashed game is a change in observable behaviour.
 */
function assertGameNotDeleted(game: Pick<Game, 'deletedAt'>): void {
  if (game.deletedAt) throw new HttpsError('not-found', 'Game not found');
}
