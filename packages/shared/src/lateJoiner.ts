// A team that joins a run already in progress (change: late-joiner-autostart).
//
// `startTeams` is point in time: it launches the teams that exist when it runs, and
// nothing asks the question again. In production run `ijI9JMITSf8C9heN1Cwp` team
// גלעד joined a minute after the organizer pressed start, stayed `launched:false`
// for 27 minutes with nothing on screen, pressed SOS to be noticed at all, and
// finished the run having completed zero missions. Nothing threw and nothing was
// logged — an unlaunched team is not "at risk", it is simply not playing, so no
// triage rule fired.
//
// TWO DECISIONS LIVE HERE AND THEY ARE DELIBERATELY SEPARATE:
//
//   • `lateJoinerVerdict` — may this team start ITSELF, right now? OFF by default,
//     because taking the start button away removes the organizer's "everyone
//     ready?" moment. Guardian consent is strictly upstream of it.
//
//   • `pendingLateJoiners` — who is stranded and needs a human told? This does NOT
//     consult the auto start setting. The organizer who never turned it on is
//     exactly the organizer this run stranded, so a safety net that only listed
//     teams the platform had already rescued would be silent in the only case that
//     matters.
//
// Both are total and never throw: the first runs inside `joinRun` and the second
// inside a render. The first fails toward NOT starting — a malformed run must not
// hand a team a mission the organizer never released.
//
// Dependency-free — scripts/test-late-joiner.ts.

/**
 * How long after the start button a join still counts as part of the same moment.
 *
 * A team joining in the same few seconds the organizer presses start is not "late"
 * in any sense a human would recognise, and flagging them would make the console
 * cry wolf during the busiest ten seconds of the run.
 */
export const LATE_JOIN_GRACE_MS = 30_000;

/** Why a late joiner was not started on its own. */
export type LateJoinBlock = 'none' | 'setting' | 'consent' | 'noStages' | 'notLate';

export interface LateJoinerInput {
  /** When the organizer started the cohort. Absent ⇒ the run has not started. */
  teamsStartedAt?: string | null;
  /** When this team joined. */
  joinedAt?: string | null;
  /** Does the game have anything to hand out? */
  hasStages?: boolean;
  /** The game's opt-in. Only a literal `true` enables it. */
  autoStartLateJoiners?: boolean;
  /** The game's guardian-consent requirement. */
  requiresGuardianConsent?: boolean;
}

export interface LateJoinerVerdict {
  /** Did this team join after play had already begun? */
  isLate: boolean;
  /** May `joinRun` launch it immediately? */
  autoStart: boolean;
  /** What stopped it, for the log and for the console's copy. */
  blockedBy: LateJoinBlock;
}

const NOT_LATE: LateJoinerVerdict = { isLate: false, autoStart: false, blockedBy: 'notLate' };

/** An ISO instant, or null for anything unusable. Never throws. */
function instant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Should this team be started by the act of joining?
 *
 * Evaluation order is load-bearing. Consent is checked BEFORE the setting so that
 * `blockedBy` names the real obstacle: an organizer whose game requires guardian
 * consent needs to know consent held the team, not that a setting was off — turning
 * the setting on would change nothing and they would have no way to find that out.
 */
export function lateJoinerVerdict(input: LateJoinerInput): LateJoinerVerdict {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ...NOT_LATE };

  const startedAt = instant(input.teamsStartedAt);
  if (startedAt === null) return { ...NOT_LATE };

  const joinedAt = instant(input.joinedAt);
  // An unparseable join time cannot prove lateness. Fail toward not starting.
  if (joinedAt === null) return { ...NOT_LATE };
  if (joinedAt - startedAt <= LATE_JOIN_GRACE_MS) return { ...NOT_LATE };

  // From here the team IS late, and is reported as such whatever blocks it — the
  // console's safety net depends on that being true even when nothing can start it.
  if (input.requiresGuardianConsent === true) {
    return { isLate: true, autoStart: false, blockedBy: 'consent' };
  }
  if (input.hasStages !== true) {
    return { isLate: true, autoStart: false, blockedBy: 'noStages' };
  }
  // Only a literal `true`. This flag starts a team playing on its own; "not false"
  // is not consent to that, and a stored `"true"` string or a legacy truthy value
  // must not be read as the organizer having asked for it.
  if (input.autoStartLateJoiners !== true) {
    return { isLate: true, autoStart: false, blockedBy: 'setting' };
  }
  return { isLate: true, autoStart: true, blockedBy: 'none' };
}

/** The minimum a team row needs for the console's stranded list. */
export interface LateJoinerTeam {
  id: string;
  displayName?: string;
  joinedAt?: string | null;
  launched?: boolean;
}

export interface StrandedTeam {
  id: string;
  displayName: string;
  /** How long they have been waiting, or null when the join time is unusable. */
  waitingMs: number | null;
  waitingMinutes: number | null;
}

/**
 * Teams that joined after play began and are still not playing.
 *
 * Deliberately does NOT read the auto start setting — see the header. A team whose
 * join time is unusable is still LISTED, with an unknown wait: "I cannot tell how
 * long they have been stuck" is a reason to surface them, not to hide them.
 *
 * Sorted longest wait first, because that is the team to rescue next.
 */
export function pendingLateJoiners(
  teams: readonly LateJoinerTeam[] | null | undefined,
  teamsStartedAt: string | null | undefined,
  opts?: { nowMs?: number },
): StrandedTeam[] {
  const startedAt = instant(teamsStartedAt);
  if (startedAt === null) return [];
  if (!Array.isArray(teams)) return [];

  const nowMs = typeof opts?.nowMs === 'number' && Number.isFinite(opts.nowMs)
    ? opts.nowMs
    : Date.now();

  const out: StrandedTeam[] = [];
  for (const team of teams) {
    if (!team || typeof team !== 'object' || Array.isArray(team)) continue;
    if (typeof team.id !== 'string' || !team.id) continue;
    if (team.launched === true) continue;

    const joinedAt = instant(team.joinedAt);
    // A team whose join time we cannot read is only stranded if the run started —
    // which we already know. Include it; the unknown wait is the honest answer.
    if (joinedAt !== null && joinedAt - startedAt <= LATE_JOIN_GRACE_MS) continue;

    const waitingMs = joinedAt === null ? null : Math.max(0, nowMs - joinedAt);
    out.push({
      id: team.id,
      displayName: typeof team.displayName === 'string' && team.displayName
        ? team.displayName
        : team.id,
      waitingMs,
      waitingMinutes: waitingMs === null ? null : Math.floor(waitingMs / 60_000),
    });
  }
  // Longest wait first; an unknown wait sorts last rather than pretending to be 0,
  // because a known 27 minutes is more urgent than an unreadable timestamp.
  out.sort((a, b) => (b.waitingMs ?? -1) - (a.waitingMs ?? -1));
  return out;
}
