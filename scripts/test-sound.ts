// Pure-logic tests for the play-web audio/haptic feedback layer.
// Change: audio-haptic-feedback. Run by scripts/run-unit-tests.mjs via `npm test`.
// No emulator, no DOM — asserts only the DOM-free pieces of lib/sound.ts + the
// persisted-preference default in store.ts (localStorage is absent in Node, so the
// guarded loaders fall back to their defaults, which is exactly what we assert).
import {
  CUES,
  ENVELOPES,
  CUE_HAPTIC,
  isRankUp,
  shouldFeedback,
  withinQuietWindow,
  QUIET_WINDOW_MS,
  type Cue,
} from '../apps/play-web/src/lib/sound';
import { loadSound } from '../apps/play-web/src/store';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── Persisted preference default ────────────────────────────────────────────
ok(loadSound() === true, 'loadSound() defaults to true (sound on)');

// ── Mute gate ───────────────────────────────────────────────────────────────
ok(shouldFeedback(true) === true, 'shouldFeedback(true) → true');
ok(shouldFeedback(false) === false, 'shouldFeedback(false) → false (muted)');

// ── withinQuietWindow (change: test-mode-game-feel) ──────────────────────────
// Two paths cue the same completion (the submit handler, then the poll effect on
// the next refresh). The backstop one is swallowed by time — and only ever the
// backstop, so a cue nobody else fired still plays.
ok(withinQuietWindow(1000, 1000 + QUIET_WINDOW_MS - 1) === true, 'inside the window → suppress');
ok(withinQuietWindow(1000, 1000 + QUIET_WINDOW_MS) === false, 'at the window edge → play');
ok(withinQuietWindow(1000, 5000) === false, 'well past the window → play');
ok(withinQuietWindow(null, 1000) === false, 'nothing cued yet → play');
// Fails OPEN in every degenerate case: a missed cue is worse than a doubled one.
for (const [last, now] of [[NaN, 1000], [1000, NaN], [Infinity, 1000], [1000, Infinity], [2000, 1000]] as const) {
  ok(withinQuietWindow(last as number, now as number) === false,
    `degenerate (${String(last)}, ${String(now)}) → play`);
}
ok(withinQuietWindow(undefined as unknown as number, 1000) === false, 'undefined last cue → play');

// ── Every cue maps to a synthesizable envelope + a haptic pattern ───────────
const expectedCues: Cue[] = ['task', 'stage', 'alert', 'rankUp'];
ok(
  CUES.length === expectedCues.length && expectedCues.every((c) => CUES.includes(c)),
  'CUES lists exactly task/stage/alert/rankUp',
);
for (const cue of expectedCues) {
  const env = ENVELOPES[cue];
  ok(!!env, `ENVELOPES has an entry for "${cue}"`);
  ok(Array.isArray(env.freqs) && env.freqs.length > 0, `"${cue}" envelope has >=1 frequency`);
  ok(env.freqs.every((f) => f > 0), `"${cue}" frequencies are positive`);
  ok(env.durationMs > 0, `"${cue}" envelope has positive duration`);
  ok(env.gain > 0 && env.gain <= 1, `"${cue}" gain in (0,1]`);
  ok(!!CUE_HAPTIC[cue], `CUE_HAPTIC has a pattern for "${cue}"`);
}
// The two SOS sites share one urgent cue.
ok(CUE_HAPTIC.alert === 'error', 'alert cue uses the "error" haptic pattern');

// ── Rank-up fires only on strict improvement (lower number) ─────────────────
ok(isRankUp(3, 1) === true, 'rank 3 → 1 is a rank-up');
ok(isRankUp(2, 1) === true, 'rank 2 → 1 is a rank-up');
ok(isRankUp(1, 1) === false, 'same rank is not a rank-up');
ok(isRankUp(1, 3) === false, 'dropping rank is not a rank-up');
ok(isRankUp(undefined, 1) === false, 'no previous rank is not a rank-up');
ok(isRankUp(1, undefined) === false, 'no next rank is not a rank-up');
ok(isRankUp(0, 1) === false, 'guards against a nonsense prev rank of 0');

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\ntest-sound: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
