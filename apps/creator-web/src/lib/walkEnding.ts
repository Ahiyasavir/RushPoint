// How the setup walk ends (change: creator-stays-to-the-end). Launching mints a join code that works at
// once, so for an event days away "launch" is not the end of the build: it is a step nobody can take yet,
// and the only way out of the walk was walking away. A game with a later date ends on "it is ready".
//
// Pure and total: a date that cannot be read means no date.
import { daysUntilEvent } from '@rushpoint/shared';

// 'now' is a date that passed, which launches like any undated game.
export type WalkEnding = 'now' | 'today' | 'later' | 'noDate';

export function walkEnding(eventAt: unknown, nowIso: string): WalkEnding {
  if (typeof eventAt !== 'string') return 'noDate';
  if (!Number.isFinite(new Date(eventAt).getTime())) return 'noDate';
  const days = daysUntilEvent(eventAt, nowIso);
  if (days === null || days < 0) return 'now';
  return days === 0 ? 'today' : 'later';
}

/**
 * A creator coming back to a game that waits for its date lands on what is left to do before it, not on the
 * raw builder. Once a visit: after that they came to edit. A link to a mission goes to the mission.
 */
export function returnsToReady(input: {
  gameId: string | undefined; eventAt: unknown; nowIso: string; path: string; search: string; seen: boolean;
}): boolean {
  if (input.seen || input.search || !input.gameId) return false;
  if (input.path.replace(/\/$/, '') !== `/build/${input.gameId}`) return false;
  const ending = walkEnding(input.eventAt, input.nowIso);
  return ending === 'later' || ending === 'today';
}

const stamp = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

/** A whole-day calendar entry: the one reminder that reaches someone who never opens the app again. */
export function calendarUrl(input: { title: string; eventAt: string; details: string }): string | null {
  const start = new Date(input.eventAt);
  if (!Number.isFinite(start.getTime())) return null;
  const end = new Date(start.getTime() + 86_400_000);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: input.title, dates: `${stamp(start)}/${stamp(end)}`, details: input.details });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
