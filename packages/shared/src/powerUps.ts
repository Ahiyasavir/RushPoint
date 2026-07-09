// Power-ups (change: power-ups). A seeded-deterministic award roll at task
// completion — pure logic, no Firestore, no DOM, and NEVER Math.random (the roll
// must reproduce identically for tests and for idempotent completion replays).
//
// Determinism is the idempotency story: a retried/replayed completion recomputes
// the identical roll, and completeTaskForTeam's existing "already-completed ⇒
// return" guard means the award block is never reached twice at all.

export type PowerUpType = 'double_points' | 'bonus_points';

export const POWER_UP_RATE = 25;   // percent chance a completed task awards a power-up
export const POWER_UP_BONUS = 15;  // flat points for a bonus_points award

/**
 * FNV-1a 32-bit hash of `${runId}:${teamId}:${taskId}`. Dependency-free and
 * stable across Node/browser — the e2e script embeds a copy of this exact routine,
 * pinned by the property test's known vectors so the two can never drift.
 */
export function powerUpHash(runId: string, teamId: string, taskId: string): number {
  const input = `${runId}:${teamId}:${taskId}`;
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts, kept in uint32.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * The deterministic award decision for a single completed task.
 *   - award  iff  hash % 100 < POWER_UP_RATE
 *   - type   = (hash >>> 8) % 2 === 0 ? 'double_points' : 'bonus_points'
 * Returns null when no award. Same inputs ⇒ same output, forever.
 */
export function rollPowerUp(runId: string, teamId: string, taskId: string): PowerUpType | null {
  const h = powerUpHash(runId, teamId, taskId);
  if (h % 100 >= POWER_UP_RATE) return null;
  return (h >>> 8) % 2 === 0 ? 'double_points' : 'bonus_points';
}

// ─── Team power-up state (rides the RunTeam doc; server-write-only) ─────────────

export interface PowerUpLogEntry {
  taskId: string;              // the completion that triggered the roll
  type: PowerUpType;
  awardedAt: string;
  // bonus_points: the flat amount (+POWER_UP_BONUS). double_points (on consumption):
  // the extra points granted (the pre-double earnedScore).
  amount?: number;
  consumedByTaskId?: string;   // double_points only: set when the ×2 fires
}

export interface TeamPowerUps {
  active?: 'double_points';    // single armed slot; absent = nothing armed
  log: PowerUpLogEntry[];
}
