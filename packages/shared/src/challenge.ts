// Challenge-a-friend (viral single-task teaser). Pure helpers shared by the
// play-web teaser route and the checkChallengeAnswer callable. The answer key
// is never shipped to the client — matchesTaskAnswer runs server-side only.
import type { Task } from './types';

/**
 * Parse a `?challenge=<gameId>:<taskId>` deep-link value into its parts.
 * Splits on the FIRST colon (gameId before, taskId after) so a taskId may not
 * contain a colon, which our nanoid-style ids never do. Returns null for any
 * malformed / empty input so the teaser route can fall through cleanly.
 */
export function parseChallengeParam(
  raw: string | null | undefined,
): { gameId: string; taskId: string } | null {
  if (!raw) return null;
  const idx = raw.indexOf(':');
  if (idx <= 0) return null;
  const gameId = raw.slice(0, idx).trim();
  const taskId = raw.slice(idx + 1).trim();
  if (!gameId || !taskId) return null;
  return { gameId, taskId };
}

/** Build the deep-link param value for a task — inverse of parseChallengeParam. */
export function buildChallengeParam(gameId: string, taskId: string): string {
  return `${gameId}:${taskId}`;
}

/**
 * Case-insensitive answer match for quiz / numeric tasks. Lifted verbatim from
 * the runs module so submitTaskAnswer and checkChallengeAnswer share one source
 * of truth. SERVER-ONLY: never call with a key that reached the client.
 */
export function matchesTaskAnswer(
  task: Pick<Task, 'type' | 'numericAnswer' | 'numericTolerance' | 'answers'>,
  raw: string,
): boolean {
  const given = raw.trim().toLowerCase();
  if (task.type === 'numeric') {
    const n = parseFloat(raw);
    if (Number.isNaN(n) || task.numericAnswer == null) return false;
    return Math.abs(n - task.numericAnswer) <= (task.numericTolerance ?? 0);
  }
  // quiz (and any answer-list task): match any accepted answer, case-insensitive
  return (task.answers ?? []).some((a) => a.trim().toLowerCase() === given);
}
