// Pure derivation of the Cloud Storage prefixes this backend deletes
// (change: storage-rules-hardening).
//
// WHY THIS IS A MODULE AND NOT INLINE TEMPLATE LITERALS: every Storage cleanup
// here is a PREFIX delete (`bucket().deleteFiles({ prefix })`). A prefix built
// from an id that turns out to be `''`/`undefined` does not throw — it widens.
// `runs/${runId}/` with an empty runId is `runs/`, which deletes EVERY run's
// participant photos in the bucket, irreversibly and without an error. Same for
// `gameMedia/${ownerUid}/`. These functions are total, throw on any input that
// would widen or escape the intended scope, and are unit-tested without an
// emulator (storagePaths.test.ts).
//
// The strings themselves must stay in lockstep with `storage.rules`:
//   runs/{runId}/teams/{teamId}/…      participant photo + audio submissions
//   gameMedia/{ownerUid}/games/{gameId}/…  creator-authored task media

/** Reject ids that are absent, blank, or contain a path separator. */
function requireId(value: string | undefined | null, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`storagePaths: ${label} is required (refusing to widen a delete prefix)`);
  }
  if (value.includes('/')) {
    throw new Error(`storagePaths: ${label} must not contain "/" (prefix escape)`);
  }
  return value;
}

/** Everything a single run's participants uploaded (photos + audio clips). */
export function runPhotoPrefix(runId: string): string {
  return `runs/${requireId(runId, 'runId')}/`;
}

/**
 * Creator-authored task media. Pass `gameId` for one game; OMIT it (explicit
 * `undefined`) to purge the creator's entire media tree on account deletion.
 * An EMPTY-STRING gameId throws rather than silently becoming the whole tree —
 * a one-game purge quietly widening to an account-wide purge is unrecoverable.
 */
export function gameMediaPrefix(ownerUid: string, gameId?: string): string {
  const owner = requireId(ownerUid, 'ownerUid');
  if (gameId === undefined) return `gameMedia/${owner}/`;
  return `gameMedia/${owner}/games/${requireId(gameId, 'gameId')}/`;
}

/**
 * The complete set of Storage prefixes a game purge must delete: every run's
 * participant uploads plus the game's authored media. Authored media is the
 * known leak class — it used to outlive the game document forever.
 */
export function gamePurgePrefixes(
  ownerUid: string,
  gameId: string,
  runIds: readonly string[],
): string[] {
  const runs = Array.from(new Set(runIds)).map(runPhotoPrefix);
  return [...runs, gameMediaPrefix(ownerUid, gameId)];
}
