// Pure test for the Builder's readiness auto-open decision
// (change: builder-readiness-autoopen).
//
// WHY THIS EXISTS: the decision to force the readiness popover open used to be two
// scattered inline `setReadinessOpen(true)` calls inside BuilderPage — one in the
// save-failure catch, one in the launch guard. Nothing could assert on it, and the
// save-failure branch was firing constantly because `updateGame` rejected every
// autosave of an unfinished answer key (fixed separately by
// builder-draft-save-tolerance / test-draft-save-tolerance.ts). Once the trigger
// became rare it also became worth pinning: the popover interrupts the creator, so
// each reason it opens has to be a deliberate, testable choice.
//
// THE RULE: the popover force-opens only for a trigger the creator cannot otherwise
// see the cause of.
//   • 'saveRejected' — the server refused the save on STRUCTURE. Open: the creator
//     needs to know WHICH stage/task, and nothing else on screen says so.
//   • 'launchBlocked' — the launch guard refused. Open: same reason.
//   • Everything else (an offline blip, a transient/retryable failure, a plain
//     unsaved state) must NOT open it — those are self-explanatory and resolve on
//     their own, so interrupting for them is the flicker the creator complained of.
//
// No emulator. Import SOURCE directly.
//   npx tsx scripts/test-readiness-autoopen.ts
import { shouldAutoOpenReadiness } from '../apps/creator-web/src/lib/gameReadiness';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── Opens: a structural refusal the creator cannot otherwise diagnose ──────────
check('opens on a structural save rejection',
  shouldAutoOpenReadiness('saveRejected') === true);
check('opens when the launch guard refuses',
  shouldAutoOpenReadiness('launchBlocked') === true);

// ── Stays shut: self-explanatory / transient states ───────────────────────────
for (const trigger of ['offline', 'retryable', 'unsaved', 'saved', 'unknown'] as const) {
  check(`stays shut on '${trigger}'`,
    shouldAutoOpenReadiness(trigger as never) === false);
}

// Total, never throws: an unrecognized trigger must not open the popover and must
// not crash the Builder's save path (it runs inside a catch block).
check('an unrecognized trigger is inert, not a throw',
  shouldAutoOpenReadiness('something-new-later' as never) === false);
check('undefined is inert', shouldAutoOpenReadiness(undefined as never) === false);
check('null is inert', shouldAutoOpenReadiness(null as never) === false);

console.log(failures === 0 ? '\n✅ ALL PASS' : `\n❌ ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
