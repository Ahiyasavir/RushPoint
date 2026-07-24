// Optimistic card-out decision (change: optimistic-card-out). Pure, total, no
// side effects. The single source of truth for two invariants of the outgoing
// task card's exit animation:
//   1. the advance delay is always a small bounded constant (or 0), never derived
//      from an animation event and never unbounded;
//   2. under reduced motion there is no animation and a zero delay, so progression
//      is byte-for-byte the app's prior synchronous behavior.
export const CARD_EXIT_MS = 220; // bounded, short; matches the CSS transition duration

export function resolveCardExit(reducedMotion: boolean): { animate: boolean; delayMs: number } {
  return reducedMotion
    ? { animate: false, delayMs: 0 }
    : { animate: true, delayMs: CARD_EXIT_MS };
}
