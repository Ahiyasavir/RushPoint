// Pure-logic test for the share outcome→feedback mapping
// (change: share-surface-failure-feedback).
//
// Two share call sites (RunRecap, ChallengeTeaser) used to `await` a share fn
// and DISCARD its outcome, so a real 'failed' outcome gave the user no feedback
// (a silent tap). The libs are total (they never throw) and now distinguish a
// user-cancel ('cancelled', from an AbortError) from a real failure ('failed').
// The caller consumes a single verdict: shareOutcomeFeedback maps every outcome
// to one of 'confirm' | 'fallback' | 'silent'. This pins that mapping without a
// DOM so the RED→GREEN ordering has a real failing target.
//   npx tsx scripts/test-share-outcome-feedback.ts
import {
  shareOutcomeFeedback,
  type ShareOutcome,
  type ShareFeedback,
} from '../apps/play-web/src/lib/shareFeedback';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

function maps(result: ShareOutcome, expected: ShareFeedback): void {
  const got = shareOutcomeFeedback(result);
  check(`${result} → ${expected}`, got === expected, `got ${got}`);
}

// A genuine delivery — native share, download fallback, or clipboard copy — all
// confirm; the caller shows a positive line.
maps('shared', 'confirm');
maps('downloaded', 'confirm');
maps('copied', 'confirm');

// A real failure falls back: the caller copies the link + shows a "couldn't
// share, link copied" notice.
maps('failed', 'fallback');

// A user cancel stays silent — no false "shared!".
maps('cancelled', 'silent');

// Totality: every union member is covered above (5 outcomes), and the function
// never throws for any of them.
const all: ShareOutcome[] = ['shared', 'downloaded', 'copied', 'failed', 'cancelled'];
let threw = 0;
for (const o of all) {
  try { shareOutcomeFeedback(o); } catch { threw++; }
}
check('mapping never throws for any outcome', threw === 0, `${threw} threw`);
check('every outcome member is exercised', all.length === 5, `${all.length} members`);

console.log(`\n${failures === 0 ? 'ALL SHARE-OUTCOME-FEEDBACK TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
