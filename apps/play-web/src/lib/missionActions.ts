// What a mission card puts in front of the player, and what it tucks away.
// (change: play-card-simplification)
//
// The card grew one control at a time, each reasonable on its own, and ended up
// showing — at once, for a single mission — a submit button, a "navigate here"
// link, a Waze link, a paid-hint button, a request-help button, and (on a test
// drive) a rehearsal button. Six tappable things for one instruction.
//
// The split is by ONE question: does this move the mission forward, or is it for
// when the mission is not going well?
//
//   PRIMARY   the thing you came here to do. Exactly one, always visible.
//   OVERFLOW  the recovery kit — navigate, hint, help. You only look for these
//             when you are lost, stuck, or out of ideas, and at that moment you
//             will happily open a menu. Until then they are noise.
//
// `longInstructions` is content, not an action, so it gets its own disclosure
// rather than a menu slot — a wall of text behind a "…" is undiscoverable.
//
// Pure and total: describes intent only. It knows nothing about React, holds no
// handlers, and never throws — the component maps these ids to its own callbacks,
// so an id this file invents that the card does not implement simply is not
// rendered (the caller filters by what it can handle).

export type MissionActionId =
  /** Open the map/Waze links for a located mission. */
  | 'navigate'
  /** Reveal the creator's paid hint. */
  | 'hint'
  /** Tell the organizer this team is stuck (GPS denied, blocked, geofence). */
  | 'help';

export interface MissionActionsInput {
  /** The mission has a usable map target (located, unsealed, real coordinates). */
  hasLocation?: boolean;
  /** `Task.hasHint` — a hint exists and has not been revealed yet. */
  hasHint?: boolean;
  /**
   * `Task.hintFreeNow` — the server has escalated this hint to FREE because the
   * team is visibly stuck. That one stays inline and loud: the whole point of
   * making it free is that a struggling team takes it, and a free offer nobody
   * finds is the same as no offer. Only a hint that COSTS points is overflow.
   */
  hintFree?: boolean;
  /** The stuck-escape is currently offered (GPS failed, geofence, blocked task). */
  canRequestHelp?: boolean;
  /** Help was already requested for this mission — the affordance becomes a receipt. */
  helpSent?: boolean;
  /** This device is a viewer, not the controller: every action is inert. */
  readOnly?: boolean;
}

export interface MissionActionsPlan {
  /** Secondary actions, in a stable order, for the overflow menu. */
  overflow: MissionActionId[];
  /**
   * True when the menu is worth rendering at all. A menu holding one item is a
   * worse button than the button, and a menu holding none is a dead control — so
   * the card renders the single item inline and drops the trigger entirely.
   */
  showMenu: boolean;
  /** Set when exactly one action exists: render it inline instead of a menu. */
  soleAction: MissionActionId | null;
}

/** Stable display order — recovery goes: find it, get a nudge, ask a human. */
const ORDER: MissionActionId[] = ['navigate', 'hint', 'help'];

export function planMissionActions(input: MissionActionsInput | null | undefined): MissionActionsPlan {
  const i = input ?? {};
  const empty: MissionActionsPlan = { overflow: [], showMenu: false, soleAction: null };

  // A viewer's controls are all inert, so offering them is a lie. The card still
  // shows the mission; it just stops pretending the buttons do something.
  if (i.readOnly === true) return empty;

  const available = new Set<MissionActionId>();
  if (i.hasLocation === true) available.add('navigate');
  if (i.hasHint === true && i.hintFree !== true) available.add('hint');
  // A sent request is a receipt the card shows inline, not an action to repeat.
  if (i.canRequestHelp === true && i.helpSent !== true) available.add('help');

  const overflow = ORDER.filter((id) => available.has(id));
  if (overflow.length === 0) return empty;
  if (overflow.length === 1) return { overflow, showMenu: false, soleAction: overflow[0] };
  return { overflow, showMenu: true, soleAction: null };
}
