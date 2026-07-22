// Read-path audit for the game tombstone (change: recoverable-game-deletion).
//
// Soft-deleting a game only works if EVERY path that can surface a game learns to
// exclude a tombstoned one. A single missed read path means a "deleted" game still
// shows up somewhere — the join screen, the gallery, the shareable leaderboard —
// which is worse than no soft delete at all, because the creator was told it was
// gone.
//
// There is no type error and no runtime failure for a forgotten guard, so this is
// a static source scan in the style of scripts/test-callable-exports.ts: for each
// callable, isolate its body in the source and assert the guard appears inside it.
// A new read path added later without a guard fails `npm test` with no emulator.
//   npx tsx scripts/test-game-tombstone-readpaths.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FN = (p: string) => join(ROOT, 'functions/src', p);

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── Callables that load a game document and must refuse a tombstoned one ──────
// (design D2 table (a)). The guard is assertGameNotDeleted / loadOwnedLiveGame
// from functions/src/games/lifecycle.ts, or a direct isGameDeleted test.
const GUARDED: Array<[module: string, callable: string]> = [
  ['games/index.ts', 'getGame'],
  ['games/index.ts', 'updateGame'],
  ['games/index.ts', 'publishGame'],
  ['games/index.ts', 'duplicateGame'],
  ['games/index.ts', 'translateGame'],
  ['games/index.ts', 'checkChallengeAnswer'],
  ['runs/index.ts',  'launchRun'],
  ['runs/index.ts',  'startInstantPlay'],
  ['runs/index.ts',  'getJoinInfo'],
  ['runs/index.ts',  'joinRun'],
  ['runs/index.ts',  'getPublicLeaderboard'],
  ['runs/index.ts',  'getRunRecap'],
  ['runs/index.ts',  'listLiveRuns'],
];

// ── Callables that must filter a LIST of games (design D2 table (b)) ─────────
const FILTERED: Array<[module: string, callable: string, helper: string]> = [
  ['games/index.ts', 'listGames',        'visibleGames'],
  ['games/index.ts', 'listDeletedGames', 'deletedGames'],
];

const GUARD_TOKENS = ['assertGameNotDeleted', 'loadOwnedLiveGame', 'isGameDeleted'];

const cache = new Map<string, string>();
function read(rel: string): string {
  if (!cache.has(rel)) cache.set(rel, readFileSync(FN(rel), 'utf8'));
  return cache.get(rel)!;
}

/**
 * The source text of one callable: from `export const <name> = loggedCallable(`
 * up to the start of the next top-level `export const`. Coarse but sufficient —
 * it can only ever include MORE text than the body, and every false positive it
 * could produce would still have to name the guard token nearby.
 */
function callableBody(src: string, name: string): string | null {
  const start = src.search(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*loggedCallable\\s*\\(`));
  if (start < 0) return null;
  const after = src.slice(start + 10);
  const next = after.search(/\nexport\s+const\s+\w+\s*=/);
  return next < 0 ? after : after.slice(0, next);
}

// ── (1) Every game-loading callable guards against a tombstone ───────────────
for (const [mod, name] of GUARDED) {
  const body = callableBody(read(mod), name);
  if (body === null) {
    check(`${mod}: callable "${name}" exists`, false, 'callable not found — was it renamed?');
    continue;
  }
  const guarded = GUARD_TOKENS.some((t) => body.includes(t));
  check(`${mod}: "${name}" refuses a tombstoned game`, guarded,
    guarded ? '' : `add assertGameNotDeleted(game) after the game read (see games/lifecycle.ts)`);
}

// ── (2) Every game-listing callable filters the list ─────────────────────────
for (const [mod, name, helper] of FILTERED) {
  const body = callableBody(read(mod), name);
  if (body === null) {
    check(`${mod}: callable "${name}" exists`, false, 'callable not found — was it renamed?');
    continue;
  }
  check(`${mod}: "${name}" filters with ${helper}()`, body.includes(helper),
    body.includes(helper) ? '' : `use ${helper}() from @rushpoint/shared`);
}

// ── (3) The guard helper itself exists and throws not-found ─────────────────
{
  const src = readFileSync(FN('games/lifecycle.ts'), 'utf8');
  check('games/lifecycle.ts exports assertGameNotDeleted', /export\s+function\s+assertGameNotDeleted/.test(src));
  check('games/lifecycle.ts exports loadOwnedLiveGame', /export\s+async\s+function\s+loadOwnedLiveGame/.test(src));
  // not-found, never a distinct code: a caller must not be able to tell a
  // tombstoned game apart from one that never existed.
  check('the tombstone guard throws not-found (never a distinct code)', src.includes("'not-found'"));
}

// ── (4) deleteGame must NOT destroy anything any more ───────────────────────
{
  const body = callableBody(read('games/index.ts'), 'deleteGame') ?? '';
  check('deleteGame no longer calls recursiveDelete directly', !body.includes('recursiveDelete'),
    body.includes('recursiveDelete') ? 'soft delete must destroy nothing — purgeGameTree owns destruction' : '');
  check('deleteGame writes a tombstone', body.includes('deletedAt'));
  check('deleteGame refuses a game with a run that is not finished', body.includes("'finished'"));
  check('deleteGame revokes the access codes (the RQH3DG orphan bug)', body.includes('accessCodes'));
}

console.log(`\n${failures === 0 ? 'ALL TOMBSTONE READ-PATH TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
