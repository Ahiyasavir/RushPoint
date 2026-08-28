// ══════════════════════════════════════════════════════════════════════════════
// ⚠️  TEMPORARY per-run CAPACITY CAP — SINGLE SOURCE OF TRUTH
// ──────────────────────────────────────────────────────────────────────────────
// The maximum number of phones (devices) that may join ONE run, counted across
// ALL teams. A safety ceiling matched to current server capacity so an unbounded
// number of live phones can't destabilize a run.
//
// This constant is the ONLY knob. To change the policy later (e.g. after moving to
// stronger servers), edit THIS ONE LINE — nothing else:
//   • RAISE the cap   → set a bigger number (e.g. 64).
//   • REMOVE the cap  → set it to `Infinity`. Enforcement becomes a no-op AND the
//                       creator-facing warning hides itself automatically.
//
// Both the backend join guard (functions/) and the creator-web warning import this
// same value, so the enforced limit and the number shown to creators can never
// disagree.
// ══════════════════════════════════════════════════════════════════════════════
// RAISED 100 -> 150 (change: hot-path-read-cost, 2026-08-28) on MEASURED capacity rather than
// on optimism. Against production with the op counter: a 120 team, 75 minute run projects to
// ~34,250 Firestore reads of a 50,000 daily ceiling (0.69x) and ~15,600 writes of 20,000
// (0.78x), and the VPS sat at load 0.14 with 2.8 GB free while serving a 100 team rehearsal.
// The previous 100 was set before any of that could be measured.
//
// ⚠️ Each ADDITIONAL phone polls team state on its own, so devices, not teams, is what the read
// budget actually scales with. 150 is chosen to cover ~120 teams plus their second phones while
// keeping the projection under 0.8x. Raising it further without re-running the measurement
// (npm run measure:location, scripts/fs-ops-report.mjs) is how a run walks into
// RESOURCE_EXHAUSTED mid game.
export const MAX_RUN_DEVICES = 150;

export type RunDeviceDecision = { ok: true } | { ok: false; reason: 'run-full' };

/** Whether one more phone may join a run that currently holds `currentDeviceCount`. */
export function canAddRunDevice(currentDeviceCount: number): RunDeviceDecision {
  return currentDeviceCount >= MAX_RUN_DEVICES ? { ok: false, reason: 'run-full' } : { ok: true };
}

/**
 * Whether the cap is currently active. Returns false once `MAX_RUN_DEVICES` is
 * raised to `Infinity` (the "removed" state), so UI can hide the warning without
 * any separate flag.
 */
export function isRunDeviceCapActive(): boolean {
  return Number.isFinite(MAX_RUN_DEVICES);
}
