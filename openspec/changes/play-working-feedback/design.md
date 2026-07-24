## Context

play-web has **no component test runner** (CLAUDE.md), so UI is a build-lane concern. The one piece
of genuinely extractable, testable logic here is "which message shows at tick N" — pulled into a
pure helper so it can be RED-first tested by the `scripts/test-*.ts` aggregator, which auto-discovers
any new `scripts/test-*.ts`. Everything else (`<Working>`, the TaskRunner wiring) is presentational
and verified via typecheck / play:build / bundle:budget / i18n:check:strict.

The existing surfaces this grounds against (verified against current code):

- Routing/grading wait card: `apps/play-web/src/components/TaskRunner.tsx:424-441` — a `w-5 h-5
  animate-spin` ring + `<p role="status" aria-live="polite">{t.task.routing}</p>`, with a
  `shouldOfferRetry(routingWaitMs, routingAttempt)` retry button (`:430-439`).
- Routing copy: `apps/play-web/src/i18n.ts:118` (HE `'מחפש את המשימה הבאה שלכם…'`) / `:685`
  (EN `'Finding your next task…'`); both dictionaries share the `task.*` namespace.
- Silent success paths: `TaskRunner.tsx` calls `onChanged()` on server-confirmed success at `:472`
  (`submitCheckIn`), `:546` (`verify`), `:640` (`if (res.correct) onChanged()` in `answer()`), `:697`
  (geofence arrive) — none fires a sound/haptic. `feedback` is **not** currently imported in TaskRunner.
- Existing cue: `apps/play-web/src/lib/sound.ts` `export function feedback(cue: Cue)` at `:123`;
  `Cue = 'task' | 'stage' | 'alert' | 'rankUp'` (`:14`); `'task'` maps to the `'success'` haptic
  (`CUE_HAPTIC`, `:41-44`). `feedback()` self-gates on the persistent mute toggle and never throws.
- Reduced-motion precedent: `apps/play-web/src/lib/confetti.ts:13` early-returns on
  `window.matchMedia?.('(prefers-reduced-motion: reduce)').matches`. `index.css:75-83` already zeroes
  CSS animations under reduced-motion; brand gradient tokens `--rp-fire`/`--rp-amber` at `index.css:7-8`.

> **NOTE:** `TaskRunner.tsx` is being edited by another agent during this proposal. All line numbers
> above are anchors — the implementer must re-confirm by **content** (the routing `Card` with
> `t.task.routing` + `shouldOfferRetry`; the `onChanged()` success calls), not by absolute line.

## 1. The `<Working>` primitive

`apps/play-web/src/components/Working.tsx` — a pure presentational component, no store, no callable.

**Props**

```ts
interface WorkingProps {
  messages: string[];        // 2-4 pre-translated branded lines (caller passes t.* values)
  intervalMs?: number;       // rotation cadence, default 1800
  progress?: number;         // 0..1 real progress; when given, the bar is determinate
  className?: string;
  children?: React.ReactNode; // optional slot, e.g. the retry button
}
```

The caller passes already-translated strings (so the component imports no dictionary and stays pure
and RTL-agnostic). `messages` must be non-empty; a single-element array renders as a static label.

**Behavior**

- Renders the current message in a `<p role="status" aria-live="polite" dir="auto">` so screen
  readers announce each rotation and Hebrew renders RTL — matching the card it replaces.
- Rotates `messages` every `intervalMs` using the pure helper `workingMessageIndex(tick, count)`
  (see §2), a soft cross-fade via existing `animate-*`/`transition-opacity` classes.
- **Advancing bar:** a track with an inner fill using the brand gradient
  `bg-gradient-to-r from-rp-fire to-rp-amber`. When `progress` is undefined the fill runs an
  **indeterminate** left-to-right sweep keyframe (a new `@keyframes rp-working` in `index.css`,
  looping `translateX`/width so it reads as forward motion, not a chasing ring). When `progress` is a
  number the fill width is `progress*100%` (determinate). Uses **logical** inset (`inset-inline-start`
  / `start-0`) so it fills start→end in both LTR and RTL.
- **`prefers-reduced-motion`:** on mount read `window.matchMedia('(prefers-reduced-motion: reduce)')`
  (guarded, like `confetti.ts`). When reduced: **do not** start the rotation timer (show
  `messages[0]` statically) and render the bar **static/determinate** (no sweep). `index.css:75-83`
  already neutralizes the CSS keyframe, so the reduced path is defensive on both layers.
- Cleans up its interval on unmount (no `setState` after unmount).

**Bundle:** one small component, no import beyond React + the pure helper; `bundle:budget` stays green.

## 2. Pure message-index helper (RED-first)

`apps/play-web/src/lib/working.ts`:

```ts
// Which message index is shown at rotation tick N, for a set of `count` messages.
// tick starts at 0; wraps; count<=0 or <=1 always yields 0 (static). Total, never throws.
export function workingMessageIndex(tick: number, count: number): number;
```

Rules: `count <= 1` ⇒ always `0` (a single/empty message never rotates). Otherwise
`((tick % count) + count) % count` so negative or huge ticks are safe. This is the only logic worth a
wired unit test; `<Working>` just calls it with an incrementing tick.

Test: `scripts/test-working.ts` (auto-discovered by the aggregator) asserts: static for count 0/1;
wraps 0,1,2,0,1,2 for count 3; negative tick and large tick both stay in range. Written **RED first**
(assertions before the helper exists), then GREEN.

## 3. Apply `<Working>` to the routing/grading wait

Replace the inner content of the routing `Card` (`TaskRunner.tsx:424-441`) so that instead of the
single `t.task.routing` line + ring it renders:

```
<Working messages={[t.task.workingChecking, t.task.workingLocating, t.task.workingPrepping]}>
  {shouldOfferRetry(routingWaitMs, routingAttempt) && ( …existing retry Button unchanged… )}
</Working>
```

- The existing `shouldOfferRetry` retry button (and its `routingInFlight.current = false;
  setRoutingAttempt` handler) is passed through unchanged as the `children` slot, so the 12 s escape
  hatch is preserved.
- `aria-live="polite"` moves from the old `<p>` into `<Working>`'s status line, so accessibility is
  preserved (now announcing the rotating branded copy).
- `t.task.routing` / `t.task.retryRouting` remain (retryRouting still used); `routing` may stay as a
  fallback but the visible copy is now the three `working*` lines.

## 4. The success beat (confirmed-correct resolve)

Import `feedback` from `../lib/sound` in TaskRunner and fire `feedback('task')` **once** on a
server-confirmed task success — the same points that call `onChanged()` for a genuine completion
(`:472`, `:546`, `:640` guarded by `res.correct`, `:697`). It must fire **only** on server-confirmed
success, never on a wrong answer (`applyAnswerCost` path) and never for a viewer/readonly device.

- `feedback('task')` is mute-gated inside `sound.ts` and never throws, so a muted or audio-locked
  player feels/hears nothing and the reveal cannot regress.
- Because the card immediately transitions to the `<Working>` routing panel after `onChanged()`, the
  cue + the advancing bar together give the "you're advancing" motion the user asked for at 0 ms of
  the next phase.
- **Optimistic card-out** (animating the outgoing task card away) is *not* in this change — it is the
  named follow-up `optimistic-card-out`. This change delivers the audible/haptic beat + the advancing
  routing panel, which is the small, low-risk core.

## 5. i18n keys (both dictionaries, HE + EN, routed through `t.*`, no em-dash)

Added under the existing `task.*` namespace in `apps/play-web/src/i18n.ts`:

| key | HE | EN |
|---|---|---|
| `task.workingChecking` | `בודקים את התשובה…` | `Checking your answer…` |
| `task.workingLocating` | `מאתרים את היעד הבא…` | `Locating your next mission…` |
| `task.workingPrepping` | `מכינים את המשימה…` | `Prepping your mission…` |

No new success-copy key is required: the success beat is an audio/haptic cue via `feedback('task')`,
not text (keeping this change minimal and avoiding a new PART B risk). Both dictionaries must define
all three keys or `test-play-web-i18n-dictionary` / `i18n:check:strict` fails. HE strings are natural
Hebrew, EN strings are English, neither uses an em-dash.

## Test strategy

- **Pure lane (RED→GREEN):** `scripts/test-working.ts` for `workingMessageIndex` (the aggregator
  auto-discovers it; `npm test`). Written failing first.
- **Dictionary lane:** `i18n:check:strict` + `test-play-web-i18n-dictionary` cover HE/EN presence,
  correctness and no-hardcoded-string (all copy via `t.task.working*`).
- **Build lane:** `npm run verify` (typecheck · play:build · bundle:budget · base:check) — bundle
  budget confirms no new heavy/eager import.
- **Manual (UNVERIFIED by gates):** rotating copy + advancing bar visible on a real slow route;
  reduced-motion shows a static first message + static bar; a correct answer plays the cue (sound on)
  and is silent when muted.

## Non-regression checklist

- The routing retry (`shouldOfferRetry` + handler) and `aria-live` announcement are preserved.
- `Button loading` and `useAsyncAction` are untouched.
- `sound.ts` is imported, not edited; no new `Cue`.
- No new dependency; `bundle:budget` green.
