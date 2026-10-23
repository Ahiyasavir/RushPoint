// A mission's countdown follows the difficulty the creator asked for (change: composer-time-by-difficulty).
//
// Ahiya, 23.10: "if the user asked for easy, add about 50% to the missions that have a time". Only a
// real countdown is scaled: a mission with `timeLimitMinutes` whose text says the same number
// ("יש לכם 4 דקות"). A length that is part of the content ("a 30 second video") is a format, not a
// difficulty, and stays. The text and the timer change together or not at all, so a team never reads
// "4 minutes" while the clock gives them 6.
//
// Pure and total: a malformed task comes back as it went in.
import type { Task } from '@rushpoint/shared';

export type TimePreference = 'easy' | 'balanced' | 'hard';

/** How much of the authored time a team gets. Easy is generous; hard is tighter, never below a minute. */
export const TIME_FACTOR: Record<TimePreference, number> = { easy: 1.5, balanced: 1, hard: 0.75 };

/** The minutes a countdown of `minutes` becomes under this preference. */
export function scaledMinutes(minutes: number, preference: TimePreference): number {
  const f = TIME_FACTOR[preference] ?? 1;
  if (!Number.isFinite(minutes) || minutes <= 0) return minutes;
  return Math.max(1, Math.round(minutes * f));
}

const heMinutes = (n: number) => (n === 1 ? 'דקה' : `${n} דקות`);
const enMinutes = (n: number) => (n === 1 ? 'a minute' : `${n} minutes`);

/** "יש לכם 4 דקות" / "יש לכם דקה" / "You have 4 minutes" / "You have a minute" for exactly `n`. */
function phrasePatterns(n: number): { he: RegExp; en: RegExp } {
  const heNum = n === 1 ? '(?:דקה אחת|דקה)' : `${n} דקות`;
  const enNum = n === 1 ? '(?:a minute|one minute|1 minute)' : `${n} minutes`;
  return { he: new RegExp(`יש לכם ${heNum}`), en: new RegExp(`[Yy]ou have ${enNum}`) };
}

/**
 * The task with its countdown scaled, or the same task when there is nothing to scale: no
 * `timeLimitMinutes`, balanced, an unchanged number, or a text that does not state that very number.
 */
export function scaleMissionTime(task: Task, preference: TimePreference): Task {
  const limit = task?.timeLimitMinutes;
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return task;
  const next = scaledMinutes(limit, preference);
  if (next === limit) return task;
  const text = typeof task.description === 'string' ? task.description : '';
  const { he, en } = phrasePatterns(limit);
  const hasHe = he.test(text);
  const hasEn = en.test(text);
  if (!hasHe && !hasEn) return task;
  let description = text;
  if (hasHe) description = description.replace(he, `יש לכם ${heMinutes(next)}`);
  if (hasEn) description = description.replace(en, (m) => `${m[0] === 'Y' ? 'You' : 'you'} have ${enMinutes(next)}`);
  return { ...task, description, timeLimitMinutes: next };
}
