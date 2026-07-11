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
export const MAX_RUN_DEVICES = 16;

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
