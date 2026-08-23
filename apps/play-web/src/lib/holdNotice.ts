// "Why am I still standing here?" — the held-team notice (change: held-team-visibility).
//
// `startTeams` partitions the cohort and launches only the teams that are cleared
// to start. A team it holds back is not written to at all: `launched` stays false,
// and the participant app rendered the SAME screen it renders for a run that has
// not started yet — "waiting for the host to start". For a held team that sentence
// is false and it never resolves, so they watch the field leave with no idea that
// anything is wrong or who could fix it.
//
// This module is the whole mapping from the server's hold state to what the card
// says, and nothing more. It GRANTS nothing: there is no input that clears a hold,
// because the server is the only thing that can, and no output that names a cause
// the server did not state.
//
// Two rules, and they pull in opposite directions on purpose (see the change's
// design.md, D3):
//   • NEVER BLANK. An unrecognized reason still produces a held notice. A held
//     player looking at the ordinary waiting copy is being lied to; a held player
//     looking at a generic "the host is sorting something out" is merely
//     under-informed, and can act on it.
//   • NEVER FABRICATED. An unrecognized reason names no cause. This is why the
//     module fails CLOSED on the claim while the `stuckGuards` siblings fail open
//     on the action: those decide whether a player may try something, this decides
//     what a player is told.
//
// Like `stuckGuards`, nothing here takes a clock, performs I/O, or throws. It
// renders on a screen a participant is already stuck on, where a throw is a blank
// phone and a clock is a bug waiting for a badly-set device.

/** The stable id the held card latches the host-help affordance onto: it has no task. */
export const HELD_HELP_KEY = 'held-team';

export type HeldKind =
  | 'none'              // not held: either launched, or nothing says otherwise
  | 'guardian_consent'  // the server is waiting on the run's guardian-consent step
  | 'unknown';          // held for a reason this app version does not know

export interface HeldNotice {
  kind: HeldKind;
  /** True exactly when `kind !== 'none'`. */
  held: boolean;
  /**
   * Always true. No hold this function can report is something the participant
   * did, so no copy driven by it may imply otherwise.
   */
  blameless: true;
  /** True exactly when held: the host is the ONLY route out of a hold. */
  offerHelp: boolean;
}

/** The reasons this app version understands. Anything else is `unknown`, never invented. */
const KNOWN: Record<string, HeldKind> = {
  guardian_consent: 'guardian_consent',
};

const NOT_HELD: HeldNotice = { kind: 'none', held: false, blameless: true, offerHelp: false };

/**
 * Decide what a not-yet-playing team should be told.
 *
 * TOTAL by design: `holdReason` is typed as `unknown` because it arrives over the
 * wire from a server that may be a version ahead, from a cached response, or from
 * a build that predates the field entirely.
 *
 * Order matters:
 *  1. `launched === true` wins over any reason. A response in flight when the
 *     organizer clears the hold, or a stale cache, must never leave a team that is
 *     now playing staring at a hold card. Only an explicit `true` counts, so a
 *     truthy non-boolean cannot silently un-hold a held team.
 *  2. No usable reason ⇒ no hold. Absence of information is not evidence, and the
 *     ordinary "waiting for the host" copy is correct when nothing is known.
 *  3. A known reason is named; anything else is held-but-generic.
 */
export function heldNotice(input?: {
  launched?: boolean;
  holdReason?: unknown;
}): HeldNotice {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return NOT_HELD;
  if (input.launched === true) return NOT_HELD;

  const raw = input.holdReason;
  if (typeof raw !== 'string') return NOT_HELD;
  const reason = raw.trim();
  if (!reason) return NOT_HELD;

  const kind = KNOWN[reason] ?? 'unknown';
  return { kind, held: true, blameless: true, offerHelp: true };
}
