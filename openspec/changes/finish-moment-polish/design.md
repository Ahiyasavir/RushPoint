## Context

All three fixes live in one component, `apps/play-web/src/screens/FinalScreen.tsx`, which was just
edited by the finish-CTA and localized-cards lanes. This design grounds every change in the current
committed code. play-web has **no component test runner** (CLAUDE.md), so these are UI-lane changes
verified by typecheck / build / bundle-budget / i18n plus a manual reveal check. None of the three
introduces genuinely extractable pure logic worth a wired test: the badge poll is an effect over an
async callable, the share fix is a one-line predicate over an existing typed outcome, and the audio
climax is a single gated call. Each is guarded so it fires the intended number of times.

## 1. Bounded badge refetch (`BadgesCard`)

The current effect runs once per `finalized` change and does a single `getMyProfile`. Because badges
are written by the async `onRunFinalized` trigger *after* finalize, a solo instant-play finish (where
`run.leaderboard` is already set at first mount, so `finalized` starts `true` and never flips) races
the trigger and renders empty forever.

**Decision.** Keep the exact same profile-application logic (the per-player `seen` set, the
`fresh` highlight, the empty-tolerant `.catch`). Wrap it in a bounded poll:

```
const MAX_BADGE_POLLS = 3;          // total attempts, never more
const BADGE_POLL_INTERVAL_MS = 2000; // a couple of seconds apart
```

- The effect still keys on `[finalized]` and still does an immediate first fetch, so the pre-finalize
  behaviour (fetch on mount, refetch when finalized flips) is preserved unchanged.
- After each fetch, schedule another **only if** `finalized && earned.length === 0 && attempts <
  MAX_BADGE_POLLS`. So: not finalized ⇒ no retry (unchanged); badges present ⇒ no retry; cap reached
  ⇒ stop. The poll is bounded to at most `MAX_BADGE_POLLS` calls and always stops.
- The cleanup clears any pending timer and sets an `alive` flag so a re-key or unmount cancels an
  in-flight retry — no `setState` after unmount, no runaway timer.

This is a strict superset of the old behaviour: the first fetch is identical; the only addition is up
to two extra fetches when finalized-but-empty. It never spams (hard cap, stops on success).

## 2. Confirm a genuine native share (`share()`)

`shareStoryCard` (`lib/storyCard.ts`) already returns `'shared' | 'downloaded' | 'copied' | 'failed'`
and maps a **cancelled** native share to `'failed'` (see its `catch { /* cancelled */ return
'failed'; }`). The current line only confirms on download/copy:

```
if (result === 'downloaded' || result === 'copied') { setShared(true); ... }
```

**Decision.** Add `'shared'` to the success set:

```
if (result === 'downloaded' || result === 'copied' || result === 'shared') { setShared(true); setTimeout(() => setShared(false), 2500); }
```

`'failed'` (a cancellation, or a genuine failure) still shows nothing, so there is no false
confirmation. The confirmation reuses the existing `t.final.shareSaved` label already wired into the
button (`busy ? … : shared ? t.final.shareSaved : t.final.shareBtn`) — **no new i18n string**. The
podium/photo share buttons are unchanged (they never set `shared` today; out of scope).

## 3. Fire the reveal's audio/haptic climax

The finish reveal already has a once-only, ref-guarded effect that fires confetti at +350 ms:

```
const confettiFired = useRef(false);
useEffect(() => { if (confettiFired.current) return; confettiFired.current = true;
  const id = window.setTimeout(() => fireConfetti(), 350); return () => window.clearTimeout(id); }, []);
```

**Decision.** Fire `feedback('rankUp')` in that same timeout, so the sound + success haptic land with
the confetti and the score-pop. The existing ref guard already makes it fire **once** (not on every
re-render — live leaderboard updates and survey steps re-render this screen constantly). The mute
gate is inside `feedback()` (`shouldFeedback(loadSound())`), so a muted player hears/feels nothing and
no new sound is introduced. `feedback` never throws (its Web Audio + haptics are fully guarded), so it
cannot regress the reveal. `sound.ts` is imported, not edited.

## Non-regression checklist (verified against current code)

- Confetti still fires once (same ref guard, same +350 ms timing).
- Score-pop, recap stats, survey, leaderboard, podium, withheld-board notice, waiting spinner,
  powered-by CTA footer, leave button, legal footer — all untouched.
- Share ladder (story `share()`, `sharePodiumFn`, `sharePhotoFn`) untouched except the one added
  success branch in `share()`.
- Bundle budget: no new import except `feedback` from the existing `../lib/sound` module (already in
  the play-web bundle via in-run cues); no heavy/eager import added.
- i18n: no new key; `final.shareSaved` reused.

## Manual (UNVERIFIED by automated gates)

- Audio/haptic climax audibly fires on reveal with sound on, and is silent with sound muted (needs a
  real device / unlocked AudioContext).
- Native share on a mobile browser shows the "saved" confirmation on a real share and nothing on
  cancel.
- Solo instant-play finish: badges appear within the poll window.
