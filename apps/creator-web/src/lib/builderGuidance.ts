// Which Builder guidance surface may be on screen (change: builder-guidance-arbiter).
//
// Five guidance surfaces render into one Builder screen, each added by a different
// change with its own trigger and its own persistence: the first-launch
// confirmation, הקמה מהירה, the guided tour, the first-open spotlight and the ready
// nudge. Before this module only 2 of the 10 pairs yielded to each other, by two
// different mechanisms — a module-level mutable flag `BuilderSpotlight` read out of
// `CreatorTour`, and a boolean prop — so pressing the nav's "?" while הקמה מהירה was
// mid-step put two spotlight overlays on screen, each dimming the other's scrim and
// pointing at a different control.
//
// The fix is representational, not another pair of checks: ONE ordered list, and a
// pure function that picks its first present member. Adding a sixth surface is then
// one line here instead of five yields spread across three components — and
// `scripts/test-builder-guidance.ts` fails if the new surface is never ranked, so it
// cannot silently default to "never renders".
//
// Everything here is total: it runs on the render path of every creator screen, and
// a throw would take the console down to the ErrorBoundary over a hint bubble.

/** Every guidance surface that competes for the Builder screen. */
export type GuidanceSurface =
  | 'launch-confirm'
  | 'quick-setup'
  | 'tour'
  | 'spotlight'
  | 'ready-nudge';

/**
 * The union, enumerated. Exists so the test can sweep every subset and so the
 * completeness guard has something to compare `GUIDANCE_PRIORITY` against — a type
 * alone is erased at runtime and could not catch an unranked surface.
 */
export const GUIDANCE_SURFACES: readonly GuidanceSurface[] = [
  'launch-confirm',
  'quick-setup',
  'tour',
  'spotlight',
  'ready-nudge',
];

/**
 * Highest priority first. The ONLY place the order is expressed.
 *
 * 1. `launch-confirm` — a modal answering an action the creator took one keystroke
 *    ago. Suppressing it would strand a launch.
 * 2. `quick-setup` — a multi-step flow the creator explicitly accepted. Interrupting
 *    it loses their place in a sequence the app itself is walking them through.
 * 3. `tour` — user-initiated, or a deliberate post-signup welcome; but it is a tour
 *    OF the screen, not a step of the creator's own work.
 * 4. `spotlight` — a one-shot two-step explainer, already written to yield.
 * 5. `ready-nudge` — a passive status banner. Postponing it costs nothing.
 */
export const GUIDANCE_PRIORITY: readonly GuidanceSurface[] = [
  'launch-confirm',
  'quick-setup',
  'tour',
  'spotlight',
  'ready-nudge',
];

/**
 * Which of the surfaces that WANT to be on screen actually may be, or null.
 *
 * Deliberately independent of the order the candidates arrive in — the caller holds
 * a `Set`, whose iteration order is insertion order, i.e. whichever surface happened
 * to mount first. That is precisely the input the old ad-hoc yields were accidentally
 * sensitive to, so the result is derived by walking `GUIDANCE_PRIORITY`, never the
 * input.
 *
 * Total: null/undefined, a non-iterable, duplicates, null members and unrecognised
 * names all resolve to a defined value. An unrecognised name never wins — an unknown
 * surface is not evidence that the known ones should be hidden.
 */
export function activeGuidance(
  candidates: Iterable<GuidanceSurface> | null | undefined,
): GuidanceSurface | null {
  if (candidates == null) return null;
  let present: Set<GuidanceSurface>;
  try {
    // A non-iterable reaches `new Set(...)` as a TypeError rather than as a silent
    // empty set, so the try is load-bearing, not decorative.
    present = new Set(candidates);
  } catch {
    return null;
  }
  for (const surface of GUIDANCE_PRIORITY) {
    if (present.has(surface)) return surface;
  }
  return null;
}

/** What to do with a request to start the guided tour. */
export type TourRequestOutcome = 'start' | 'hold' | 'drop';

/**
 * The tour was requested — start it, hold it until the screen is free, or drop it?
 *
 * `help` is a creator pressing the "?" button. A user-initiated action that resolves
 * silently is a dead button (CLAUDE.md), so a help press that cannot run right now is
 * HELD and fires when the blocking surface closes.
 *
 * `auto` is the post-signup welcome. If it loses it is DROPPED, never held: an
 * unrequested tour that appears minutes later, after the creator has started working,
 * is a new bug rather than a repair of this one.
 *
 * An unrecognised source is treated as automatic — the conservative side, because
 * holding is the behaviour that can surprise someone who never asked.
 */
export function tourRequestOutcome(
  source: 'help' | 'auto',
  wins: boolean,
): TourRequestOutcome {
  if (wins === true) return 'start';
  return source === 'help' ? 'hold' : 'drop';
}
