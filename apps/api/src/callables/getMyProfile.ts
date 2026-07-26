// ─── getMyProfile — ported from functions/src/runs/index.ts:2530-2536 ────────
//
// Proof-of-port #2, chosen because it is the smallest callable that still
// exercises every layer: auth (`requireAuth`), rate limiting, one repository
// read, and a "never 404, synthesise an empty aggregate" response contract.
//
// Original:
//     const snap = await db.doc(`players/${uid}`).get();
//     const profile = snap.exists ? snap.data() as PlayerProfile : emptyProfile(uid);
//     return { profile };
//
// A uid that has never finished a run gets `emptyProfile(uid)` — NOT a
// `not-found`. That is load-bearing: play-web renders the profile card on first
// visit, and a 404 here would surface as an error toast on a brand-new player's
// very first screen.

import { emptyProfile } from '@rushpoint/shared';
import type { PlayerProfile } from '@rushpoint/shared';
import { defineCallable } from '../callable.js';
import { requireAuth } from '../auth.js';
import type { ApiDeps } from '../deps.js';

export const getMyProfile = defineCallable<ApiDeps>('getMyProfile', async (_data, context, deps) => {
  const uid = requireAuth(context);
  await deps.enforceRateLimit(uid, 'getMyProfile');

  // NOTE: `@rushpoint/data`'s `PlayerProfileDoc` is the storage row and carries
  // an index signature; `@rushpoint/shared`'s `PlayerProfile` is the wire shape
  // play-web types against. They overlap but are not identical (`runsPlayed` vs
  // `gamesPlayed`). The repository returns the row; the wire shape is what the
  // client already parses, so the cast happens HERE, at the boundary, once —
  // not inside the repository, which must stay storage-shaped.
  const row = await deps.repo.getPlayerProfile(uid);
  const profile = (row as unknown as PlayerProfile | null) ?? emptyProfile(uid);

  return { profile };
});
