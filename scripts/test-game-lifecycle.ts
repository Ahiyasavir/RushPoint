// Pure-logic tests for the game trash / tombstone lifecycle
// (change: recoverable-game-deletion).
//
// A creator lost a real game to a single click because deleteGame ran
// db.recursiveDelete immediately. Deletion is now a tombstone (`deletedAt`) plus a
// grace period, and these are the predicates every surface reads: what counts as
// deleted, what is safe to destroy, and how long the owner has left. No emulator.
//   npx tsx scripts/test-game-lifecycle.ts
import type { Game } from '../packages/shared/src/types';
import {
  GAME_TRASH_RETENTION_DAYS,
  isGameDeleted,
  visibleGames,
  deletedGames,
  gamePurgeDueAt,
  isPurgeDue,
  daysUntilPurge,
  restoreEligibility,
} from '../packages/shared/src/gameLifecycle';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const g = (over: Partial<Game>): Game => ({
  id: over.id ?? 'g1',
  ownerUid: 'owner',
  title: 'T',
  mode: 'individual',
  stages: [],
  scoringPreset: 'time_only',
  registrationFields: [],
  visibility: 'private',
  tags: [],
  playCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
} as Game);

// ── The retention window is a single named constant ──────────────────────────
check('GAME_TRASH_RETENTION_DAYS is 30', GAME_TRASH_RETENTION_DAYS === 30, String(GAME_TRASH_RETENTION_DAYS));

// ── isGameDeleted: presence of a non-empty deletedAt IS the tombstone ────────
check('a game with no deletedAt is not deleted', isGameDeleted(g({})) === false);
check('a game with deletedAt is deleted', isGameDeleted(g({ deletedAt: '2026-07-01T00:00:00.000Z' })) === true);
check('an empty-string deletedAt is NOT a tombstone', isGameDeleted(g({ deletedAt: '' })) === false);
check('a whitespace deletedAt is NOT a tombstone', isGameDeleted(g({ deletedAt: '   ' })) === false);
check('an undefined game is not deleted', isGameDeleted(undefined) === false);

// ── The two filters partition a list exactly ─────────────────────────────────
{
  const list = [g({ id: 'a' }), g({ id: 'b', deletedAt: '2026-07-01T00:00:00.000Z' }), g({ id: 'c' })];
  const live = visibleGames(list);
  const trash = deletedGames(list);
  check('visibleGames keeps only the live games', live.map((x) => x.id).join(',') === 'a,c', live.map((x) => x.id).join(','));
  check('deletedGames keeps only the tombstoned games', trash.map((x) => x.id).join(',') === 'b', trash.map((x) => x.id).join(','));
  check('the two filters partition the list', live.length + trash.length === list.length);
  check('visibleGames does not mutate its input', list.length === 3);
}

// ── gamePurgeDueAt = deletedAt + retention ───────────────────────────────────
{
  const deletedAt = '2026-07-01T12:00:00.000Z';
  const due = gamePurgeDueAt(deletedAt);
  const expected = new Date(Date.parse(deletedAt) + GAME_TRASH_RETENTION_DAYS * DAY_MS).toISOString();
  check('gamePurgeDueAt adds the retention window', due === expected, `${due} vs ${expected}`);
  check('gamePurgeDueAt honours an explicit window', gamePurgeDueAt(deletedAt, 1) === new Date(Date.parse(deletedAt) + DAY_MS).toISOString());
  check('gamePurgeDueAt on a missing tombstone is null', gamePurgeDueAt(undefined) === null);
  check('gamePurgeDueAt on garbage is null', gamePurgeDueAt('not-a-date') === null);
}

// ── isPurgeDue: inclusive at the boundary, exclusive 1ms before ──────────────
{
  const deletedAt = '2026-07-01T00:00:00.000Z';
  const dueMs = Date.parse(deletedAt) + GAME_TRASH_RETENTION_DAYS * DAY_MS;
  check('not purge-due one day in', isPurgeDue(deletedAt, new Date(Date.parse(deletedAt) + DAY_MS)) === false);
  check('not purge-due 1ms before the boundary', isPurgeDue(deletedAt, new Date(dueMs - 1)) === false);
  check('purge-due exactly at the boundary (inclusive)', isPurgeDue(deletedAt, new Date(dueMs)) === true);
  check('purge-due 1ms after the boundary', isPurgeDue(deletedAt, new Date(dueMs + 1)) === true);
  check('a game that was never deleted is never purge-due', isPurgeDue(undefined, new Date(dueMs + DAY_MS)) === false);
}

// ── FAIL-CLOSED: a corrupt timestamp hides the game but never destroys it ────
{
  const corrupt = g({ deletedAt: 'garbage' });
  check('a corrupt deletedAt still counts as deleted (hidden)', isGameDeleted(corrupt) === true);
  check('a corrupt deletedAt is NEVER purge-due', isPurgeDue('garbage', new Date('2099-01-01T00:00:00.000Z')) === false);
}

// ── daysUntilPurge: the owner-facing countdown, floored at 0 ─────────────────
{
  const deletedAt = '2026-07-01T00:00:00.000Z';
  const at = (ms: number) => new Date(Date.parse(deletedAt) + ms);
  check('30 days left at the moment of deletion', daysUntilPurge(deletedAt, at(0)) === 30, String(daysUntilPurge(deletedAt, at(0))));
  check('29 days left one day in', daysUntilPurge(deletedAt, at(DAY_MS)) === 29, String(daysUntilPurge(deletedAt, at(DAY_MS))));
  check('a part-day rounds up to a whole day left', daysUntilPurge(deletedAt, at(DAY_MS * 1.5)) === 29, String(daysUntilPurge(deletedAt, at(DAY_MS * 1.5))));
  check('0 days left at the boundary', daysUntilPurge(deletedAt, at(DAY_MS * 30)) === 0);
  check('never negative past the boundary', daysUntilPurge(deletedAt, at(DAY_MS * 99)) === 0);
  check('0 for a game that was never deleted', daysUntilPurge(undefined, at(0)) === 0);
}

// ── restoreEligibility ───────────────────────────────────────────────────────
{
  const now = new Date('2026-07-10T00:00:00.000Z');
  const live = restoreEligibility(g({}), now);
  check('a live game reports not_deleted', live.ok === false && live.reason === 'not_deleted', JSON.stringify(live));

  const fresh = restoreEligibility(g({ deletedAt: '2026-07-09T00:00:00.000Z' }), now);
  check('a freshly deleted game is restorable', fresh.ok === true, JSON.stringify(fresh));

  const stale = restoreEligibility(g({ deletedAt: '2026-01-01T00:00:00.000Z' }), now);
  check('a game past its grace period reports purged', stale.ok === false && stale.reason === 'purged', JSON.stringify(stale));

  const corrupt = restoreEligibility(g({ deletedAt: 'garbage' }), now);
  check('a corrupt tombstone is still restorable (fail-closed, never lost)', corrupt.ok === true, JSON.stringify(corrupt));
}

console.log(`\n${failures === 0 ? 'ALL GAME-LIFECYCLE TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
