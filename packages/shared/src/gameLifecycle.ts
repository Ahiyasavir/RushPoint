// Game trash / tombstone lifecycle (change: recoverable-game-deletion).
//
// A creator permanently lost a real game to one click: deleteGame ended in
// db.recursiveDelete, which destroys the game document AND every run, team, feed
// item, feedback and location-track document beneath it. Deletion is now a
// TOMBSTONE plus a grace period, and these pure predicates are the single source
// of truth every surface reads:
//
//   • the server (which games listGames returns, which games the purge sweep may
//     destroy, whether a restore is still possible), and
//   • the creator console (the "recently deleted" countdown).
//
// Keeping them here (rather than inline in functions/) is what stops the server
// and the UI from disagreeing about whether a game is gone.
//
// TWO INVARIANTS THIS MODULE ENCODES ON PURPOSE:
//   1. Presence of a non-empty `deletedAt` IS the tombstone. Absence of the field
//      is the normal state, so no migration is needed for existing games.
//   2. FAIL CLOSED. A `deletedAt` that cannot be parsed still HIDES the game, but
//      is NEVER purge-due. A corrupt timestamp must never become a licence to
//      destroy data — that is the exact failure mode this whole change exists to
//      prevent.

import type { Game } from './types';

/** Days a deleted game stays recoverable before it is permanently destroyed. */
export const GAME_TRASH_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse an ISO tombstone; null when absent, blank or unparseable. */
function tombstoneMs(deletedAt: string | undefined | null): number | null {
  if (typeof deletedAt !== 'string' || deletedAt.trim() === '') return null;
  const ms = Date.parse(deletedAt);
  return Number.isFinite(ms) ? ms : null;
}

/** True when the game carries a tombstone and must be hidden from every surface. */
export function isGameDeleted(game: Pick<Game, 'deletedAt'> | undefined | null): boolean {
  const raw = game?.deletedAt;
  return typeof raw === 'string' && raw.trim() !== '';
}

/** The games a creator should actually see (listGames). */
export function visibleGames<T extends Pick<Game, 'deletedAt'>>(games: readonly T[]): T[] {
  return games.filter((g) => !isGameDeleted(g));
}

/** The games in the trash (listDeletedGames). */
export function deletedGames<T extends Pick<Game, 'deletedAt'>>(games: readonly T[]): T[] {
  return games.filter((g) => isGameDeleted(g));
}

/**
 * The instant a tombstoned game becomes eligible for permanent destruction.
 * DERIVED, never stored: a persisted copy would go stale the moment the retention
 * constant changes and would create a second source of truth for "may I destroy
 * this". Null when there is no usable tombstone.
 */
export function gamePurgeDueAt(
  deletedAt: string | undefined | null,
  days: number = GAME_TRASH_RETENTION_DAYS,
): string | null {
  const ms = tombstoneMs(deletedAt);
  if (ms === null) return null;
  return new Date(ms + days * DAY_MS).toISOString();
}

/**
 * May this game be permanently destroyed now? Inclusive at the boundary.
 * Fail-closed: no tombstone, or an unparseable one, is never destroyable.
 */
export function isPurgeDue(
  deletedAt: string | undefined | null,
  now: Date = new Date(),
  days: number = GAME_TRASH_RETENTION_DAYS,
): boolean {
  const ms = tombstoneMs(deletedAt);
  if (ms === null) return false;
  return now.getTime() >= ms + days * DAY_MS;
}

/**
 * Whole days of recovery left, for the console countdown. Rounded UP (a part-day
 * still reads as a day the creator has), floored at 0, and 0 for a game that is
 * not in the trash at all.
 */
export function daysUntilPurge(
  deletedAt: string | undefined | null,
  now: Date = new Date(),
  days: number = GAME_TRASH_RETENTION_DAYS,
): number {
  const ms = tombstoneMs(deletedAt);
  if (ms === null) return 0;
  const remaining = ms + days * DAY_MS - now.getTime();
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / DAY_MS);
}

export type RestoreEligibility =
  | { ok: true }
  | { ok: false; reason: 'not_deleted' | 'purged' };

/**
 * Can this game be restored? `not_deleted` is a benign no-op (a double click, or
 * two tabs); `purged` means the grace period has elapsed and the data is either
 * already gone or about to be, so the console must say so rather than promise a
 * recovery it cannot deliver.
 *
 * A CORRUPT tombstone reports restorable, matching isPurgeDue's fail-closed
 * stance: if we will never destroy it, we must always let the owner recover it.
 */
export function restoreEligibility(
  game: Pick<Game, 'deletedAt'> | undefined | null,
  now: Date = new Date(),
  days: number = GAME_TRASH_RETENTION_DAYS,
): RestoreEligibility {
  if (!isGameDeleted(game)) return { ok: false, reason: 'not_deleted' };
  if (isPurgeDue(game?.deletedAt, now, days)) return { ok: false, reason: 'purged' };
  return { ok: true };
}
