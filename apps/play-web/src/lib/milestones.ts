// Mid-run milestone beats (change: test-mode-game-feel).
//
// A sealed assessment run has no score, no streak, no rank and no board, so
// between the first question and the last there is nothing telling a player they
// are getting anywhere. A milestone is the one celebration test mode may keep:
// it measures PERSISTENCE, and it is byte-for-byte identical for a player getting
// everything right and a player getting everything wrong, so it leaks nothing the
// mode exists to withhold.
//
// Thresholds are RATIOS rather than the literals 5/10/15/20 — an assessment of 12
// or 30 questions has to get sensible beats too.
//
// Pure, DOM-free; covered by scripts/test-milestones.ts.

/** The full set. Deliberately NOT an ordering: `lastFive` sits before
 *  `threeQuarters` in a 20-question run and after it in a 100-question one, so
 *  order is derived from the thresholds themselves, never from this list. */
export const MILESTONES = ['quarter', 'half', 'threeQuarters', 'lastFive'] as const;
export type Milestone = (typeof MILESTONES)[number];

/** Below this there is no middle worth marking — every beat would be adjacent. */
const MIN_TOTAL = 4;
/** "Five to go" only means something in a run appreciably longer than five. */
const LAST_FIVE_MIN_TOTAL = 10;

function whole(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/**
 * The completion count at which each milestone fires, or `undefined` when this run
 * is too short for it.
 *
 * Every threshold is strictly inside `(0, total)`: a beat at 0 fires before the
 * player has done anything, and a beat at `total` collides with the finish screen,
 * which is a real celebration and must not be pre-empted by a banner.
 *
 * Deduplicated on the way out. In a 20-question run `threeQuarters` (15) and
 * `lastFive` (15) land on the same count, and in a 6-question run several ratios
 * collapse onto the same one; the FIRST milestone in `MILESTONES` order keeps the
 * count and the later ones drop, so a player never gets two banners for one answer.
 */
export function milestoneThresholds(total: unknown): Partial<Record<Milestone, number>> {
  const n = whole(total);
  if (n === null || n < MIN_TOTAL) return {};

  const candidates: Record<Milestone, number> = {
    quarter: Math.ceil(n * 0.25),
    half: Math.ceil(n * 0.5),
    threeQuarters: Math.ceil(n * 0.75),
    lastFive: n - 5,
  };

  const out: Partial<Record<Milestone, number>> = {};
  const claimed = new Map<number, Milestone>();
  for (const m of MILESTONES) {
    if (m === 'lastFive' && n < LAST_FIVE_MIN_TOTAL) continue;
    const at = candidates[m];
    if (at <= 0 || at >= n) continue;
    const holder = claimed.get(at);
    if (holder) {
      // Collision (threeQuarters and lastFive both land on 15 in a 20-question
      // run; several ratios collapse in a 6-question one). A countdown beats a
      // fraction — "five to go" is the more motivating of the two — so lastFive
      // takes the count and the loser is dropped rather than shown twice.
      if (m === 'lastFive') { delete out[holder]; claimed.set(at, m); out[m] = at; }
      continue;
    }
    claimed.set(at, m);
    out[m] = at;
  }
  return out;
}

/**
 * Which milestone (if any) this team just crossed.
 *
 * `prevDone` matters because a single server write can move the counter by more
 * than one — a partial stage auto-skips its siblings the moment the requirement is
 * met — and firing four banners at once for one answer would read as a glitch.
 * When several are crossed together the most significant one wins, since that is
 * the one the player earned.
 *
 * Total: it runs inside a render/effect on the participant's only screen, so a
 * nonsense count returns `null` rather than throwing.
 */
export function crossedMilestone(prevDone: unknown, done: unknown, total: unknown): Milestone | null {
  const prev = whole(prevDone);
  const now = whole(done);
  const n = whole(total);
  if (prev === null || now === null || n === null) return null;
  if (now <= prev) return null;
  // Reaching the end is the FINISH, which has its own celebration one screen
  // later. A run completed in a single jump must not flash a mid-run banner on
  // the way out.
  if (now >= n) return null;

  const thresholds = milestoneThresholds(n);
  let best: Milestone | null = null;
  for (const m of MILESTONES) {
    const at = thresholds[m];
    if (at == null) continue;
    if (at > prev && at <= now && (best === null || at > (thresholds[best] as number))) best = m;
  }
  return best;
}
