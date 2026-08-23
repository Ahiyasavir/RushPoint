// Which ONE status line a mission card shows (change: play-card-simplification).
//
// The card used to render every applicable status as its own tinted, bordered
// box, stacked: a pause-clock notice, a wrong-answer-cost notice, and a retry
// lockout could all be on screen at once, above the actual mission. A player
// outdoors, walking, on a phone, does not read four boxes to find the one that
// changes what they do next — they read the first and act, or they read none.
//
// So the card gets ONE slot and this decides what goes in it. The rule is
// "what changes what I do RIGHT NOW":
//
//   1. cooldown   — you literally cannot answer yet, and it is counting down.
//   2. cost       — the next wrong answer costs something. Say it BEFORE they
//                   answer, which is the only moment it can change a decision.
//   3. freeTries  — the friendlier half of the same rule; only when nothing is
//                   actually at stake yet.
//   4. paused     — informational, and good news. It never needs to outrank a
//                   warning; a team that does not notice their clock stopped has
//                   lost nothing.
//
// Nothing is DROPPED that the player must act on: the two hidden by this
// ordering (freeTries, paused) are both non-blocking, and each resurfaces the
// moment the higher-priority one clears.
//
// Pure and total: no DOM, no clock reads, no throw. The caller passes the
// already-computed cooldown so the component owns the ticking, not this.
import type { AnswerCostDisplay } from '@rushpoint/shared';

export type MissionNoticeKind = 'cooldown' | 'cost' | 'costTime' | 'freeTries' | 'paused';

export interface MissionNotice {
  kind: MissionNoticeKind;
  /** Drives the icon + colour. `warn` is the only one that reads as a problem. */
  tone: 'warn' | 'info' | 'good';
  /** Values the caller interpolates into the localized string. */
  seconds?: number;
  points?: number;
  tries?: number;
}

export interface MissionNoticeInput {
  /** `Task.pausesTimer` — this mission stops the team's race clock. */
  pausesTimer?: boolean;
  /** Server-computed wrong-answer economics for this task, when the creator set one. */
  answerCost?: AnswerCostDisplay | null;
  /** Seconds left on a retry lockout; <= 0 (or absent) means not locked out. */
  cooldownLeft?: number;
}

/** A finite, non-negative integer, or 0. Never NaN — the copy interpolates it. */
function count(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0;
  return n > 0 ? n : 0;
}

export function selectMissionNotice(input: MissionNoticeInput | null | undefined): MissionNotice | null {
  const i = input ?? {};

  const cooldown = count(i.cooldownLeft);
  if (cooldown > 0) return { kind: 'cooldown', tone: 'warn', seconds: cooldown };

  const cost = i.answerCost;
  if (cost) {
    const free = count(cost.freeAttemptsLeft);
    const points = count(cost.nextPoints);
    const secs = count(cost.nextCooldownSeconds);
    if (free > 0) return { kind: 'freeTries', tone: 'good', tries: free };
    // Points first: losing points is the sharper consequence, and a time_only run
    // reports 0 points, which is exactly when the seconds version is the true one.
    if (points > 0) return { kind: 'cost', tone: 'warn', points, seconds: secs };
    if (secs > 0) return { kind: 'costTime', tone: 'warn', seconds: secs };
    // A cost object with nothing at stake says nothing — fall through rather than
    // render an empty warning.
  }

  if (i.pausesTimer === true) return { kind: 'paused', tone: 'info' };
  return null;
}
