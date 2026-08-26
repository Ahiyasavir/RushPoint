// What KIND of event this is, and what that changes about the composed game
// (change: smart-build-occasion-and-prep-scale).
//
// ─── Why this is not a bank tag ──────────────────────────────────────────────
//
// `bankTags.ts` is a vocabulary MISSIONS are tagged with, and every consumer
// reads it as `entry.tags.includes(id)`. No mission is tagged "wedding" and none
// will be: an occasion is a property of the EVENT, expressed as a bias over
// activity tags that already exist. Putting it in the tag registry would create
// ids nothing carries, and a tag nothing carries is invisible at runtime —
// filtering on it yields an empty pool, silently, which is the exact failure
// `scripts/test-bank-tags.ts` exists to catch.
//
// ─── Why the labels are not here ─────────────────────────────────────────────
//
// Same reason `SMART_BUILD_WHO` carries no labels: this file is pure data the
// composer reads, and keeping user-facing text out of it means the whole thing
// is unit-testable without a dictionary. The chips render `t.smartBuild.occasionOptions[id]`.
//
// ─── What an occasion actually moves ─────────────────────────────────────────
//
// 1. MISSION FIT — `favouredTags` becomes a bounded ADDITIVE bonus in
//    `fitScore`. Soft by construction: it lifts a favoured mission, it never
//    excludes an unfavoured one. The creator's other answers have already
//    narrowed the pool, and a preference that empties it drops the game.
// 2. STAGE STRUCTURE — `blueprint` is used when the mission budget can hold it,
//    and today's random pick runs when it cannot. A wedding is not a
//    team-building day: guests are dressed up and not walking far, so it wants
//    few stages holding many missions each, while a team-building day wants a
//    real arc with a twist in the middle.
// 3. STAGE TITLES — supplied as copy by the caller, keyed on the occasion id.
//
// And `other` — the default — moves NOTHING. It is the honest reading of "we
// were not told what this event is", and it is what keeps every existing
// composer suite (all of which compose with no occasion at all) meaningful.
import type { ActivityTagId } from '../bankTags';
import type { StageBlueprint } from './composeGame';

/**
 * The occasions, in the order the questionnaire offers them.
 *
 * Ordered by how common they are in the events this platform actually runs, with
 * the neutral answer LAST — it is the escape hatch, not the first thing a
 * creator should be reading.
 */
export const OCCASION_IDS = [
  'birthday',
  'mitzvah',
  'wedding',
  'teamBuilding',
  'youthGroup',
  'other',
] as const;
export type OccasionId = typeof OCCASION_IDS[number];

/** The answer that means "we were not told". Biases nothing, shapes nothing. */
export const NEUTRAL_OCCASION: OccasionId = 'other';

export interface OccasionProfile {
  /**
   * Activity tags this occasion favours. EMPTY means no bias at all — not a
   * weak one — so the neutral occasion reproduces the pre-occasion behaviour
   * exactly rather than approximately.
   */
  favouredTags: readonly ActivityTagId[];
  /**
   * The stage shape this occasion prefers, or `null` to keep the random pick.
   * Used only when the mission budget can hold it; see `pickBlueprint`.
   */
  blueprint: StageBlueprint | null;
}

/**
 * At most three favoured tags each, deliberately.
 *
 * The bonus is shared out across the favoured list (see `occasionBonus`), so a
 * profile favouring five tags favours nothing in particular — it just adds a
 * near-constant to most of the bank. Three is enough to describe the feel of an
 * event and few enough that carrying one of them is a real distinction.
 */
export const OCCASIONS: Record<OccasionId, OccasionProfile> = {
  // Short, loud, and photographable. Front-loaded so the energy is highest while
  // everyone is still together, and a gentle curve — a birthday that gets
  // genuinely hard stops being a party.
  birthday: {
    favouredTags: ['action', 'creative', 'camera'],
    blueprint: { key: 'birthday-3', stageCount: 3, taskWeights: [1.2, 1.0, 0.8], difficultyCurve: [2, 4, 6] },
  },
  // A crowd that spans grandparents and classmates, which is why teamwork and
  // camera missions carry it: both are playable by anyone at any pace. Four
  // stages with a real finale — there is a ceremony to build toward.
  mitzvah: {
    favouredTags: ['teamwork', 'camera', 'thinking'],
    blueprint: { key: 'mitzvah-4', stageCount: 4, taskWeights: [0.9, 1.1, 1.0, 1.0], difficultyCurve: [3, 5, 6, 8] },
  },
  // Guests are dressed up and are not walking far. FEW stages holding MANY
  // missions each, and the easiest curve of the six: the game is the
  // entertainment between the parts of the evening, not the evening.
  wedding: {
    favouredTags: ['camera', 'creative', 'teamwork'],
    blueprint: { key: 'wedding-3', stageCount: 3, taskWeights: [1.0, 1.2, 0.8], difficultyCurve: [2, 4, 5] },
  },
  // The one occasion where difficulty IS the point — the group is there to be
  // made to cooperate under pressure. Five stages with the twist in the middle.
  teamBuilding: {
    favouredTags: ['teamwork', 'thinking', 'action'],
    blueprint: { key: 'teamwork-5', stageCount: 5, taskWeights: [0.8, 1.0, 1.3, 1.0, 0.9], difficultyCurve: [3, 5, 7, 6, 9] },
  },
  // A madrich running a weekly activity: something to do, something to learn,
  // and a hard finish worth talking about next week.
  youthGroup: {
    favouredTags: ['action', 'teamwork', 'educational'],
    blueprint: { key: 'youth-4', stageCount: 4, taskWeights: [0.9, 1.2, 1.1, 0.8], difficultyCurve: [4, 6, 7, 9] },
  },
  // Neutral by construction, not by omission. See the note at the top.
  other: { favouredTags: [], blueprint: null },
};

/** Is this an occasion the registry actually knows? Total — accepts anything. */
export function isOccasionId(value: unknown): value is OccasionId {
  return typeof value === 'string' && (OCCASION_IDS as readonly string[]).includes(value);
}

/**
 * The profile for an occasion.
 *
 * Total: anything unrecognised resolves to the NEUTRAL profile rather than
 * throwing — and neutral specifically, never a guess. A malformed answer means
 * we do not know what the event is, and inventing a bias from that would shape
 * a creator's game around a value nobody chose.
 */
export function occasionProfile(id: unknown): OccasionProfile {
  return isOccasionId(id) ? OCCASIONS[id] : OCCASIONS[NEUTRAL_OCCASION];
}
