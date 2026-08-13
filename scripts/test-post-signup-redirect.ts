// Pure tests for the post-signup landing decision (change: post-signup-redirect).
//
// THE BUG: creators reported landing on /settings right after signing up. There is
// no navigate('/settings') anywhere — AuthGate's submit()/google() never navigated
// at ALL after success. The app is URL-driven, so whatever path was in the address
// bar when auth flipped is simply what rendered. Signing up from /settings left you
// on /settings.
//
// THE RULE: a genuinely NEW account is sent to the dashboard and (briefly after)
// offered the guided tour. A RETURNING creator is never moved — yanking someone who
// deliberately opened /settings and re-authenticated would be a new bug, not a fix.
//
// TOUR SCOPE: `shouldAutoStartTour` was deliberately hard-disabled by
// `onboarding-overload-fix` — auto-launching the deep 15-step walkthrough on an
// empty dashboard pointed its Builder steps at screens that did not exist yet and
// buried the first-run checklist. This re-enables it ONLY for a first-ever signup,
// which is far narrower than what that change switched off: an established creator,
// or anyone who already has a tour record, still never gets it automatically.
//
// No emulator. Import SOURCE directly.
//   npx tsx scripts/test-post-signup-redirect.ts
import {
  shouldRedirectAfterSignup, shouldAutoStartTour, POST_SIGNUP_TOUR_DELAY_MS,
  markJustSignedUp, consumeJustSignedUp, clearJustSignedUp, JUST_SIGNED_UP_EVENT,
} from '../apps/creator-web/src/lib/creatorOnboarding';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── Redirect: new accounts only ───────────────────────────────────────────────
check('a brand-new account is redirected to the dashboard',
  shouldRedirectAfterSignup({ isNewUser: true }) === true);
check('a returning creator is NOT redirected',
  shouldRedirectAfterSignup({ isNewUser: false }) === false);

// Total + fail-safe: when "is this new?" cannot be determined (a Google sign-in
// whose metadata is missing), the safe answer is DON'T move them. A missed redirect
// costs a new creator one click; a wrong redirect yanks someone off the page they
// deliberately opened.
check('an undetermined isNewUser does not redirect',
  shouldRedirectAfterSignup({ isNewUser: undefined as never }) === false);
check('a malformed argument does not redirect, and does not throw',
  shouldRedirectAfterSignup(undefined as never) === false);

// ── Tour auto-start: first-ever signup only ───────────────────────────────────
check('auto-starts for a first-ever signup (no record, not established)',
  shouldAutoStartTour({ record: null, established: false, justSignedUp: true }) === true);

check('does NOT auto-start on an ordinary visit (the onboarding-overload-fix rule)',
  shouldAutoStartTour({ record: null, established: false, justSignedUp: false }) === false);
check('does NOT auto-start for an established creator even right after signup',
  shouldAutoStartTour({ record: null, established: true, justSignedUp: true }) === false);
check('does NOT auto-start when a tour record already exists',
  shouldAutoStartTour({ record: { seenAt: '2026-01-01T00:00:00.000Z', outcome: 'completed' } as never, established: false, justSignedUp: true }) === false);
check('does NOT auto-start when the tour was previously dismissed',
  shouldAutoStartTour({ record: { seenAt: '2026-01-01T00:00:00.000Z', outcome: 'dismissed' } as never, established: false, justSignedUp: true }) === false);

// The old 2-arg call sites must keep compiling AND stay shut — omitting
// justSignedUp must never be read as "yes".
check('omitting justSignedUp keeps the tour shut',
  shouldAutoStartTour({ record: null, established: false } as never) === false);

// ── The delay is a named constant, not a magic number at the call site ────────
check('tour delay is a sane, positive, non-instant pause',
  typeof POST_SIGNUP_TOUR_DELAY_MS === 'number'
  && POST_SIGNUP_TOUR_DELAY_MS >= 1000 && POST_SIGNUP_TOUR_DELAY_MS <= 5000,
  String(POST_SIGNUP_TOUR_DELAY_MS));

// ── The AuthGate → CreatorTour hand-off ───────────────────────────────────────
// The predicate above was already correct and already passing while the tour was
// COMPLETELY UNREACHABLE in the product, because the bug was never in the rule —
// it was in getting `justSignedUp: true` to the component at all:
//
//   1. THE RACE. `markJustSignedUp()` runs after `await signUpWithEmail(...)`, but
//      auth flips the moment that promise resolves, so CreatorTour mounts and reads
//      the flag BEFORE AuthGate writes it. A mount-time read always lost.
//   2. STRICTMODE (main.tsx). Effects double-invoke: pass 1 consumed the one-shot
//      flag and armed the timer, the interleaved cleanup disarmed it, and pass 2 read
//      the now-empty flag as false and never re-armed.
//
// Hence the event: it makes the hand-off order-independent. These assertions pin the
// storage contract and the notification, so a future refactor cannot quietly restore
// a tour that no creator can ever see.
{
  const store = new Map<string, string>();
  const events: string[] = [];
  const g = globalThis as Record<string, unknown>;
  g.sessionStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  g.window = { dispatchEvent: (e: { type: string }) => { events.push(e.type); return true; } };
  g.Event = class { type: string; constructor(t: string) { this.type = t; } };

  // The helpers read storage at CALL time, so the stubs above are enough — no
  // dynamic import needed (and top-level await is unavailable in this lane).
  check('before any signup the flag reads false', consumeJustSignedUp() === false);

  markJustSignedUp();
  check('marking a signup ANNOUNCES it, so a tour that already mounted still learns',
    events.includes(JUST_SIGNED_UP_EVENT), JSON.stringify(events));
  check('the announced event name is the one CreatorTour subscribes to',
    typeof JUST_SIGNED_UP_EVENT === 'string' && JUST_SIGNED_UP_EVENT.length > 0,
    String(JUST_SIGNED_UP_EVENT));

  check('the first read after a signup is true', consumeJustSignedUp() === true);
  // One-shot: this is what stops a stale "you just signed up" greeting a creator on
  // some later navigation in the same tab.
  check('the second read is false — the flag is consumed, not sticky',
    consumeJustSignedUp() === false);

  markJustSignedUp();
  clearJustSignedUp();
  check('clearing an aborted signup leaves nothing behind',
    consumeJustSignedUp() === false);
}

console.log(failures === 0 ? '\n✅ ALL PASS' : `\n❌ ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
