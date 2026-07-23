// Pure-logic tests for the touch-target / RTL / dialog-a11y change
// (change: play-touch-rtl-a11y).
//
// Almost all of that change is markup, which play-web has no component runner
// for. Exactly one real DECISION hides inside it, and it is the one that can
// permanently lock a player out of a task:
//
//   "does tapping this quiz choice need a confirmation first, and how many
//    attempts are actually left?"                        → quizAttemptGuard
//
// submitTaskAnswer refuses with `resource-exhausted` once a team hits
// task.smart.attemptLimit (functions/src/runs/index.ts), and QuizEntry submits
// on the choice button's own onClick — so on an attempt-limited task ONE
// misclick burns a finite attempt. The guard must therefore:
//   • fire ONLY when a finite positive limit exists (no limit ⇒ no friction —
//     a wrong answer costs nothing there, so a blanket confirm is pure tax);
//   • never report a negative or fractional "remaining";
//   • never throw on junk input (it runs on a hot tap path).
//
// The touch constants are asserted too, because Tailwind only ever sees STATIC
// class strings (CLAUDE.md) — an interpolated one silently produces no CSS, and
// a 44px target that renders as nothing is worse than the 32px one it replaced.
//
//   npx tsx scripts/test-touch-a11y.ts
import { quizAttemptGuard, TAP_TARGET, TAP_PAD, TAP_INLINE } from '../apps/play-web/src/lib/interaction';
import { translations as playT } from '../apps/play-web/src/i18n';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── 1. quizAttemptGuard — no limit means NO confirmation ──────────────────────
// This half matters as much as the other: the common case is an unlimited quiz
// where a wrong answer is free, and a modal there would slow every player down
// for nothing.
check('an absent limit needs no confirm', quizAttemptGuard(undefined, 0).needsConfirm === false);
check('a zero limit needs no confirm', quizAttemptGuard(0, 0).needsConfirm === false);
check('a negative limit needs no confirm', quizAttemptGuard(-3, 0).needsConfirm === false);
check('NaN needs no confirm', quizAttemptGuard(Number.NaN, 0).needsConfirm === false);
check('Infinity needs no confirm', quizAttemptGuard(Number.POSITIVE_INFINITY, 0).needsConfirm === false);
check('an unlimited task reports remaining 0 (nothing to spend)',
  quizAttemptGuard(undefined, 0).remaining === 0);

// ── 2. quizAttemptGuard — a finite limit DOES confirm, with a count ───────────
check('a limit of 3 needs a confirm', quizAttemptGuard(3, 0).needsConfirm === true);
check('a limit of 1 needs a confirm', quizAttemptGuard(1, 0).needsConfirm === true);
check('with no wrong answers yet, all 3 remain', quizAttemptGuard(3, 0).remaining === 3);
check('one wrong answer leaves 2', quizAttemptGuard(3, 1).remaining === 2);
check('three wrong answers leave 0', quizAttemptGuard(3, 3).remaining === 0);

// ── 3. quizAttemptGuard — the count is never nonsense ─────────────────────────
// `wrongSoFar` is a CLIENT-side session count (the server's taskAttempts is not
// in the participant payload), so it can be stale or absurd. It may never
// produce a negative "attempts left", and a bogus negative count must not be
// able to INFLATE the bound either.
check('more wrong answers than the limit still reports 0, never negative',
  quizAttemptGuard(3, 99).remaining === 0);
check('a negative wrong-count cannot inflate the bound', quizAttemptGuard(3, -5).remaining === 3);
check('NaN wrong-count falls back to the full limit', quizAttemptGuard(3, Number.NaN).remaining === 3);
check('remaining is always an integer', Number.isInteger(quizAttemptGuard(3.7, 0.4).remaining));
check('remaining is never fractional after subtraction',
  Number.isInteger(quizAttemptGuard(5, 1.6).remaining));

// Totality: this runs inside an onClick, so a throw would swallow the tap.
for (const junk of [undefined, null, 'x', {}, [], true]) {
  let ok = true;
  try {
    const g = quizAttemptGuard(junk as never, junk as never);
    ok = typeof g.needsConfirm === 'boolean' && Number.isInteger(g.remaining) && g.remaining >= 0;
  } catch { ok = false; }
  check(`junk input ${JSON.stringify(junk) ?? 'undefined'} is handled without throwing`, ok);
}

// ── 4. Touch constants are real, static Tailwind ──────────────────────────────
check('TAP_TARGET is a non-empty string', typeof TAP_TARGET === 'string' && TAP_TARGET.length > 0);
check('TAP_PAD is a non-empty string', typeof TAP_PAD === 'string' && TAP_PAD.length > 0);
check('TAP_TARGET is static (Tailwind cannot see an interpolated class)', !TAP_TARGET.includes('${'));
check('TAP_PAD is static', !TAP_PAD.includes('${'));
check('TAP_TARGET encodes the 44px minimum in both axes',
  TAP_TARGET.includes('min-w-[44px]') && TAP_TARGET.includes('min-h-[44px]'));
check('TAP_PAD pads without shifting the surrounding layout',
  TAP_PAD.includes('p-2') && TAP_PAD.includes('-m-2'));
// TAP_INLINE is the one TAP_PAD could not be: a REAL 44px box that still does not
// grow the row it sits in (change: play-web-accessibility).
check('TAP_INLINE is static', typeof TAP_INLINE === 'string' && !TAP_INLINE.includes('${'));
check('TAP_INLINE encodes the 44px minimum in both axes',
  TAP_INLINE.includes('min-w-[44px]') && TAP_INLINE.includes('min-h-[44px]'));
check('TAP_INLINE centres its glyph so the box is actually hittable',
  TAP_INLINE.includes('inline-flex') && TAP_INLINE.includes('items-center') && TAP_INLINE.includes('justify-center'));
check('TAP_INLINE pulls its overflow back so the surrounding row keeps its height',
  TAP_INLINE.includes('-m-2'));
check('TAP_INLINE uses no physical-direction class (Hebrew is the default language)',
  !/(^|\s)-?(m[lr]|p[lr]|left|right)-/.test(TAP_INLINE));

// ── 5. Dictionary cross-check — every new key, both languages, right script ───
// PART A of `npm run i18n:check` is a hard gate; this catches the same class of
// bug at the unit-test layer, where it fails faster and points at the key.
const HEBREW = /[֐-׿]/;
const newKeys: [ns: 'task' | 'staff' | 'play' | 'liveOps', key: string][] = [
  ['task', 'attemptConfirmBtn'],
  ['liveOps', 'dismiss'],
  ['staff', 'signOutConfirm'],
  ['play', 'leaveAria'],
];
for (const [ns, key] of newKeys) {
  const he = (playT.he[ns] as Record<string, unknown>)[key];
  const en = (playT.en[ns] as Record<string, unknown>)[key];
  check(`t.${ns}.${key} exists in HE`, typeof he === 'string' && he.length > 0);
  check(`t.${ns}.${key} exists in EN`, typeof en === 'string' && en.length > 0);
  check(`t.${ns}.${key} HE is really Hebrew`, typeof he === 'string' && HEBREW.test(he));
  check(`t.${ns}.${key} EN carries no Hebrew`, typeof en === 'string' && !HEBREW.test(en));
}

// The two interpolating keys are functions, so they are checked by calling them.
const heAttempt = playT.he.task.attemptConfirm({ remaining: 2 });
const enAttempt = playT.en.task.attemptConfirm({ remaining: 2 });
check('t.task.attemptConfirm HE is Hebrew and shows the count',
  HEBREW.test(heAttempt) && heAttempt.includes('2'));
check('t.task.attemptConfirm EN is English and shows the count',
  !HEBREW.test(enAttempt) && enAttempt.includes('2'));
const heAdjust = playT.he.staff.adjustApplied({ delta: '+5' });
const enAdjust = playT.en.staff.adjustApplied({ delta: '+5' });
check('t.staff.adjustApplied HE is Hebrew and shows the delta',
  HEBREW.test(heAdjust) && heAdjust.includes('+5'));
check('t.staff.adjustApplied EN is English and shows the delta',
  !HEBREW.test(enAdjust) && enAdjust.includes('+5'));

console.log(`\n${failures === 0 ? 'ALL TOUCH-A11Y TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
