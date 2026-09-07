// The Builder's mission-editor URL contract (change: builder-mission-editor-route).
//
// The open mission used to be `BuilderPage`'s local `editing` state, set by SIX
// call sites and cleared by FIVE. Nothing tied it to the page's history, so on a
// phone — where back is the primary navigation — back did not close the editor,
// it left the Builder entirely. Moving the open mission into the URL makes one
// addressable value out of eleven scattered assignments, and hands dismissal to
// the platform.
//
// Everything here is pure and TOTAL. `BuilderPage` re-renders on every navigation,
// so a throw in any of these is a blank console, and the inputs genuinely are
// arbitrary: a hand-typed URL, a stale bookmark, a game still loading, a task id
// that was deleted last week. Every function answers "no mission" rather than
// failing. scripts/test-mission-editor-route.ts pins all of it.
import type { Game, Stage, Task } from '@rushpoint/shared';

/** The search key carrying the open mission. `/build/:gameId?task=<id>`. */
export const MISSION_PARAM = 'task';

/** Coerce whatever the router hands us into URLSearchParams, never throwing. */
function toParams(search: string | URLSearchParams | null | undefined): URLSearchParams | null {
  if (search instanceof URLSearchParams) return search;
  if (typeof search !== 'string') return null;
  try {
    // URLSearchParams tolerates a leading '?' itself, but be explicit.
    return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  } catch {
    return null;
  }
}

/**
 * Which mission the URL says is open, or null.
 *
 * A blank or whitespace-only value reads as NO mission rather than as a mission
 * with an empty id: `?task=` is what a half-built link looks like, and treating it
 * as an id would send `resolveOpenMission` hunting for a task named ''.
 */
export function readOpenMissionId(search: string | URLSearchParams | null | undefined): string | null {
  const params = toParams(search);
  if (!params) return null;
  const raw = params.get(MISSION_PARAM);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The search string for a given open mission, preserving every unrelated param.
 *
 * Closing REMOVES the key rather than blanking it. `?task=` would round-trip
 * through readOpenMissionId as "no mission", but it leaves a URL that reads as
 * half-open and would be shared that way.
 *
 * Returns the bare `a=b&c=d` form with no leading '?', which is what
 * `URLSearchParams.toString()` produces and what react-router's `{ search }`
 * accepts; an empty string means "no query at all".
 */
export function missionEditorSearch(
  search: string | URLSearchParams | null | undefined,
  taskId: string | null | undefined,
): string {
  const params = toParams(search) ?? new URLSearchParams();
  const clean = typeof taskId === 'string' ? taskId.trim() : '';
  if (clean === '') params.delete(MISSION_PARAM);
  else params.set(MISSION_PARAM, clean);
  return params.toString();
}

/** A resolved open mission: the task itself plus the stage that actually holds it. */
export interface OpenMission {
  stageId: string;
  task: Task;
}

/**
 * Find the addressed mission in the loaded game, and DERIVE its stage.
 *
 * Deriving is the point. The old state carried `{ stageId, taskId }` as a pair set
 * by eleven call sites, so the two could disagree — and a mission dragged to
 * another stage while its editor was open made them disagree. There is now one id
 * and one lookup.
 *
 * Returns null for: a game that has not loaded yet (a deep link renders before
 * getGame resolves), a task id the game does not have (deleted, or from another
 * game), and any malformed stored shape.
 */
export function resolveOpenMission(
  game: Game | null | undefined,
  taskId: string | null | undefined,
): OpenMission | null {
  const wanted = typeof taskId === 'string' ? taskId.trim() : '';
  if (wanted === '') return null;
  const stages: unknown = game?.stages;
  if (!Array.isArray(stages)) return null;
  for (const stage of stages as Stage[]) {
    if (!stage || typeof stage !== 'object') continue;
    const tasks: unknown = (stage as Stage).tasks;
    if (!Array.isArray(tasks)) continue;
    for (const task of tasks as Task[]) {
      if (!task || typeof task !== 'object') continue;
      if (task.id === wanted) return { stageId: stage.id, task };
    }
  }
  return null;
}

/** What the router should do to move from one open mission to another. */
export type MissionNavAction = 'push' | 'replace' | 'back' | 'none';

/**
 * The history discipline, as one decision instead of eleven inline `nav()` calls.
 *
 * Four transitions, four different correct answers, and getting any of them wrong
 * is a back button that misbehaves on somebody's phone:
 *
 *   closed -> open        push     back should now dismiss the editor
 *   open A -> open B      replace  ONE editor holds exactly ONE entry, so one back
 *                                  dismisses it however many missions were visited
 *   open -> closed, ours  back     consume the entry we pushed, leaving history clean
 *   open -> closed, not   replace  we never pushed one; `back` here would walk a
 *                                  deep-linked or reloaded creator off the site
 *
 * `weOwnEntry` is the caller's record of whether IT pushed the live editor entry.
 * It is meaningless when nothing is open, which is why the closed -> open rows
 * ignore it.
 */
export function missionEditorNavAction(
  prev: string | null | undefined,
  next: string | null | undefined,
  weOwnEntry: boolean,
): MissionNavAction {
  const from = typeof prev === 'string' && prev !== '' ? prev : null;
  const to = typeof next === 'string' && next !== '' ? next : null;
  if (from === to) return 'none';
  if (from === null) return 'push';
  if (to === null) return weOwnEntry ? 'back' : 'replace';
  return 'replace';
}
