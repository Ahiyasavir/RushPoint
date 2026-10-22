// How much players will love each bank mission, and what creators taught us since
// (changes: composer-v2-quality, composer-v2-learning).
//
// The founder: "תקדם משימות חזקות ותשים משימות חלשות כברירה אחרונה, ובכל זאת ... רנדומליות", and
// "תלמד על בסיס כמה היוצרים אוהבים את המשימות".
//
// THE RATING (1-5) comes only from his own verdicts in the mission-studio review history:
//   5  praised outright ("משימה נדירה!", "חזק מאוד!!!", rounds 1-2 "מעולות", "מאוד חזקים")
//   4  approved as written
//   3  approved after a fix, or reviewed and kept in an earlier round
//   2  never reviewed by him (the old kids / party / chores missions)
// A new mission enters at the rating its review earns. Not shown to creators (his decision, 22.10).
//
// THE LEARNING. The rating is a PRIOR worth PRIOR_STRENGTH observations, not a coin flip: starting a
// mission at 50% over-explores weak ones (Roblox, "Dynamic Prior Thompson Sampling", 2026). Creators'
// signals are the evidence: a mission still in a game that launched was KEPT, one regenerated away was
// SWAPPED. The posterior mean (Beta-Bernoulli) replaces the rating as data accumulates.
//
// THE RANDOMNESS is the composer's own: it samples inside the band of near-best scores, weighted by
// score, so a strong mission wins more often, never always. A deterministic posterior mean (rather than
// a Thompson draw per candidate) keeps the composer's rng sequence untouched, which its reproducibility
// contract requires; the band sampling already supplies the exploration.
//
// Pure and total.

export interface MissionStats { kept: number; swapped: number }

export const BANK_QUALITY: Readonly<Record<string, number>> = {
  'ad-for-nothing': 3,
  'agent-in-crowd': 5,
  'anagram-easy': 2,
  'anagram-hard': 2,
  'anagram-medium': 2,
  'animal-signs': 3,
  'backwards-name': 2,
  'balloon-message': 2,
  'beach-boat': 3,
  'birthday-wish': 2,
  'blanket-fort': 2,
  'blind-describe': 3,
  'bottle-flip': 5,
  'cache-swap': 4,
  'cairn-record': 3,
  'cap-toss': 3,
  'celebrants-favorites-ranking': 2,
  'chain-reaction': 4,
  'chalk-code': 2,
  'challenge-beatles-crossing': 3,
  'challenge-shampoo-pitch': 3,
  'chore-before-after': 2,
  'chore-bin-round': 2,
  'chore-clear-the-counter': 2,
  'chore-fridge-audit': 2,
  'chore-laundry-sort': 2,
  'chore-room-reset': 2,
  'chore-sock-pairs': 2,
  'chore-table-set': 3,
  'chore-ten-things': 2,
  'chore-the-drawer': 2,
  'city-sentence': 4,
  'code-names': 3,
  'color-code-trail': 2,
  'common-thread': 4,
  'corporate-landmark-navigate': 3,
  'couple-wish': 2,
  'dead-drop': 3,
  'double-agent': 5,
  'egg-teammate': 5,
  'elevator-pitch': 3,
  'elevator-race': 4,
  'empty-square': 4,
  'escalator-mannequins': 4,
  'everyone-hidden': 3,
  'exact-count': 3,
  'exact-kilo': 4,
  'face-in-things': 4,
  'family-feud': 3,
  'family-photo-remake': 3,
  'farthest-origin': 5,
  'farthest-stranger': 3,
  'finish-all-or-nothing': 3,
  'finish-podium': 3,
  'finish-what-we-didnt-know': 3,
  'first-job': 4,
  'five-cities': 3,
  'five-objects': 3,
  'five-questions': 4,
  'flying-ball': 3,
  'forty-seconds': 3,
  'four-places': 3,
  'four-things': 5,
  'guess-the-height': 3,
  'hand-drawn-map': 3,
  'height-line-up': 2,
  'highest-note': 3,
  'historic-speech': 3,
  'home-museum': 4,
  'honest-compliment': 3,
  'household-riddle-comb': 2,
  'how-many-steps': 3,
  'human-gps': 3,
  'human-letter': 3,
  'humans-of-the-city': 3,
  'kid-drawing': 4,
  'kims-game': 2,
  'kitchen-tower': 3,
  'lie-about-city': 4,
  'living-room-obstacle': 3,
  'local-legend': 3,
  'long-receipt': 3,
  'longest-line': 5,
  'movie-trailer': 5,
  'my-letter': 3,
  'mystery-gift': 2,
  'mystery-sound': 4,
  'name-on-the-street': 4,
  'namesake-stranger': 3,
  'nature-documentary': 3,
  'nature-letters': 3,
  'next-department': 4,
  'ninjas': 3,
  'odd-one-planted': 3,
  'office-olympics': 3,
  'office-portrait': 3,
  'official-photo': 5,
  'old-dance': 4,
  'old-word': 4,
  'oldest-couple': 4,
  'oldest-shop': 3,
  'oldest-thing-here': 3,
  'one-colour-five-things': 3,
  'one-to-five': 3,
  'ongoing-spoon': 5,
  'open-everyone-airborne': 3,
  'open-one-take-intro': 3,
  'our-sign': 4,
  'paper-airplane-trial': 3,
  'passphrase-handoff': 3,
  'pause-freeze': 4,
  'photo-vantage-point': 3,
  'pirate-map': 4,
  'price-target': 3,
  'priciest-car': 3,
  'pun-shop': 4,
  'pushups-stranger': 4,
  'rainbow-hunt': 3,
  'rare-triple-plate': 3,
  'record-board': 3,
  'reverse-shoplifting': 3,
  'rock-cairn': 3,
  'rolling-challenge': 3,
  'russian-accent': 3,
  'same-pose': 4,
  'sand-sculpture': 3,
  'sand-wall': 3,
  'sand-word': 3,
  'satellite-x': 4,
  'scytale': 3,
  'shadow-puppets': 4,
  'shelter': 3,
  'shoe-twins': 4,
  'sign-cipher': 3,
  'sign-word-cipher': 3,
  'silent-library': 3,
  'six-legs': 4,
  'slow-motion': 4,
  'song-of-then': 4,
  'stranger-charades': 4,
  'stranger-portrait': 4,
  'strangers-mission': 4,
  'strangers-story': 4,
  'street-beat': 3,
  'street-miracle': 3,
  'street-order': 3,
  'sum-to-hundred': 3,
  'taste-test': 4,
  'teach-a-stranger': 3,
  'team-pull-ups': 4,
  'telling-object': 4,
  'ten-high-fives': 4,
  'the-combination-lock': 2,
  'the-curse': 3,
  'the-hidden-key': 3,
  'the-translator': 5,
  'then-and-here': 4,
  'thinking-room': 3,
  'thirty-second-interview': 3,
  'three-feet': 4,
  'three-languages': 4,
  'three-words': 4,
  'tiny-detail': 5,
  'trade-up': 3,
  'twelve-thumbs': 3,
  'twenty-litter': 3,
  'two-truths-one-lie': 3,
  'vendor-secret-code': 3,
  'victory-signs': 4,
  'waiters-race': 3,
  'water-cup': 4,
  'wave-jump': 4,
  'weirdest-product': 3,
  'what-are-you-listening': 4,
  'whisper-chain': 3,
  'who-goes-alone': 5,
  'youth-absurd-petition': 3,
  'youth-breaking-news': 3,
  'youth-emoji-riddle': 3,
  'youth-find-place-one': 3,
  'youth-finish-point': 3,
  'youth-great-escape': 3,
  'youth-human-pyramid': 3,
  'youth-israeli-pride': 3,
  'youth-start-point': 3,
  'youth-winning-rap': 3,
};

/** The prior "kept" probability per rating. 3 is the neutral middle. */
const PRIOR: Readonly<Record<number, number>> = { 1: 0.25, 2: 0.4, 3: 0.55, 4: 0.7, 5: 0.85 };
const NEUTRAL = PRIOR[3];
/** How many observations the rating is worth. */
export const PRIOR_STRENGTH = 10;
/** The most quality adds to (or takes from) a candidate's score: below a real fit mismatch. */
export const QUALITY_WEIGHT = 0.1;

export function priorFor(rating: unknown): number {
  const r = typeof rating === 'number' && Number.isFinite(rating) ? Math.round(rating) : 3;
  return PRIOR[Math.max(1, Math.min(5, r))];
}

function count(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/** The posterior "kept" probability: the rating's prior plus creators' evidence. */
export function posteriorMean(rating: unknown, stats?: Partial<MissionStats> | null): number {
  const p = priorFor(rating);
  const kept = count(stats?.kept);
  const swapped = count(stats?.swapped);
  if (kept + swapped === 0) return p;
  return (PRIOR_STRENGTH * p + kept) / (PRIOR_STRENGTH + kept + swapped);
}

/** The score bonus for a posterior: 0 at the neutral rating, ±QUALITY_WEIGHT at the ends. */
export function qualityBonus(p: unknown): number {
  const v = typeof p === 'number' && Number.isFinite(p) ? p : NEUTRAL;
  const span = PRIOR[5] - NEUTRAL;
  return Math.max(-QUALITY_WEIGHT, Math.min(QUALITY_WEIGHT, QUALITY_WEIGHT * (v - NEUTRAL) / span));
}

/** A bank mission's current quality: its rating, updated by creators' signals. */
export function qualityOf(key: unknown, stats?: Readonly<Record<string, Partial<MissionStats>>> | null): number {
  const k = typeof key === 'string' ? key : '';
  return posteriorMean(BANK_QUALITY[k] ?? 3, stats?.[k]);
}

/**
 * The `missionStats/all` document as `key → { kept, swapped }`. Total: anything malformed is
 * dropped, so a broken document reads as "no evidence yet", never as a crash.
 */
export function parseMissionStats(doc: unknown): Record<string, MissionStats> {
  const counts = (doc && typeof doc === 'object' ? (doc as { counts?: unknown }).counts : undefined);
  if (!counts || typeof counts !== 'object') return {};
  const out: Record<string, MissionStats> = {};
  for (const [k, v] of Object.entries(counts as Record<string, unknown>)) {
    const c = (v && typeof v === 'object' ? v : {}) as { kept?: unknown; swapped?: unknown };
    out[k] = { kept: count(c.kept), swapped: count(c.swapped) };
  }
  return out;
}
