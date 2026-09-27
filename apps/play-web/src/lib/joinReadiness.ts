// What is still missing before this phone can join (change: join-button-never-dead).
//
// The join form's primary button used to be `disabled` whenever anything required
// was blank:
//
//     disabled={busy || !members.some((m) => m.trim()) || (!isSolo && !values.teamName?.trim())}
//
// That is the most consequential button in the participant app — a group standing
// in a car park, one phone, a host waiting — and when it is disabled it explains
// NOTHING. A player who filled the team name but left the member row empty taps
// the big orange button and it simply does not respond. There is no message,
// because a disabled button cannot fire a click, so the submit path that populates
// `fieldErrors` is unreachable by construction. The only cue is a `*` further up a
// scrolled page.
//
// Three separate problems, all fixed by the same move:
//
//   * **Control.** An unresponsive control reads as a broken app, not as an
//     incomplete form. The player has no way to discover what the app wants, so
//     they retry the same tap, then blame the phone or the signal.
//   * **Accessibility.** `disabled` removes the button from the tab order and
//     gives assistive tech nothing to announce. A blind player gets a button that
//     is simply not there.
//   * **Recoverability.** Nothing focuses the offending field, so on a long form
//     the missing input may be off-screen.
//
// So the button stays ENABLED and answers every tap. This module is the pure
// decision behind that answer: what is missing, which field to focus, and which
// localized sentence to say. Total — every input shape yields a verdict, nothing
// throws.

/** A required input the join form collects, in the order it appears on screen. */
export type JoinRequirement = 'teamName' | 'memberName' | 'field';

export interface JoinReadinessInput {
  /** True for solo/individual mode, where there is no team name and one name row. */
  isSolo: boolean;
  /** The member-name rows exactly as typed (untrimmed). */
  members: string[];
  /** The team name exactly as typed (untrimmed); ignored when `isSolo`. */
  teamName: string;
  /** Ids of custom registration fields the validator found empty. */
  emptyFieldIds: string[];
}

export interface JoinReadiness {
  /** Nothing is missing — the join may be sent. */
  ready: boolean;
  /**
   * Every field id that should be marked, so the form can highlight ALL of them
   * at once rather than making the player discover them one tap at a time.
   */
  missingIds: string[];
  /**
   * The single field to focus and scroll to: the FIRST missing one in visual
   * order (team name, then member name, then custom fields). Null when ready.
   */
  focusId: string | null;
  /** Which message to show. Null when ready. */
  reason: JoinRequirement | null;
}

/**
 * The member-name row is stored under the id 'name' so it shares the highlight
 * mechanism (`fieldErrors`) with every other required field.
 */
export const MEMBER_NAME_FIELD_ID = 'name';

/** Whitespace-only counts as empty — " " is not a team name. */
function blank(v: unknown): boolean {
  return typeof v !== 'string' || v.trim().length === 0;
}

export function joinReadiness(input: JoinReadinessInput): JoinReadiness {
  const members = Array.isArray(input.members) ? input.members : [];
  const hasMember = members.some((m) => !blank(m));
  const needsTeamName = !input.isSolo && blank(input.teamName);
  const emptyFieldIds = Array.isArray(input.emptyFieldIds)
    ? input.emptyFieldIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];

  const missingIds: string[] = [];
  if (needsTeamName) missingIds.push('teamName');
  if (!hasMember) missingIds.push(MEMBER_NAME_FIELD_ID);
  for (const id of emptyFieldIds) if (!missingIds.includes(id)) missingIds.push(id);

  if (missingIds.length === 0) {
    return { ready: true, missingIds: [], focusId: null, reason: null };
  }

  // Visual order, so the focus jump is always forward from where the player is
  // looking rather than bouncing back up past fields they already filled.
  const reason: JoinRequirement = needsTeamName ? 'teamName' : !hasMember ? 'memberName' : 'field';
  return { ready: false, missingIds, focusId: missingIds[0] ?? null, reason };
}
