## Context

The creator presses "Launch run" and waits through a save + `launchRun` round-trip with **zero
on-screen feedback**. This mirrors the participant-side complaint the `Working` component already
solved. This change brings the same "you're advancing, not staying in place" treatment to the
creator's most anxious wait, in the creator's dark theme.

### Exact code touched (from research)

**Launch call sites — both currently have NO pending UI:**

- `apps/creator-web/src/pages/BuilderPage.tsx`
  - `saveAndLaunch(testDrive = false)` at **line 365**: `await save()` then (line 381)
    `const { runId } = await launchRun({ gameId: game.id, testDrive })` then `nav(...)`. The
    `try/catch` (lines 380-392) handles billing/error dialogs.
  - The two launch buttons at **lines 531-532** (`launchTestRun` ghost + `launchRun` primary) are
    plain `<Button>` with **no `loading=` prop** today.
- `apps/creator-web/src/pages/DashboardPage.tsx`
  - `launch(g, opts)` at **line 265**: line 278 `const { runId } = await launchRun(...)` then
    `nav(...)`; `try/catch` at 280-289.

**Reusable primitives (`apps/creator-web/src/components/ui.tsx`):**

- `Button` (line 28) already accepts `loading` — sets `disabled`, `aria-busy`, renders a spinner.
  We pass `loading={launching}` to the launch buttons so the button itself also reflects the wait.
- `Spinner` (line 227) and `Skeleton` (line 239) exist but are not the "advancing steps" idea.
- `index.css` already has the reduced-motion block (**lines 168-176**) and a keyframe +
  reduced-motion guard pattern for `rp-skeleton` (**lines 213-235**) to mirror.

**Participant twin to mirror (do NOT import — different app/theme):**

- `apps/play-web/src/lib/working.ts` — `workingMessageIndex(tick, count)`: total, never throws,
  wraps `((tick % count) + count) % count`, returns 0 for count ≤ 1.
- `apps/play-web/src/components/Working.tsx` — rotates on `setInterval`, `prefersReducedMotion()`
  guard (SSR-safe `window.matchMedia?.(...)`), reduced-motion shows `messages[0]` only + a static
  fill, indeterminate otherwise shows a CSS sweep (`rp-working-sweep`).

**i18n (`apps/creator-web/src/i18n.ts`):** two top-level dictionaries `he` (from line 6) and `en`
(from line 1543), each a set of namespaces (`nav`, `common`, `dashboard`, `builder`, `tour`, …).
`builder.launchRun` = HE `'הפעל ריצה'` (line 1037) / EN `'Launch run'` (line 2560). Creator-web is
Hebrew-default with full EN parity; every user-facing string routes through `t.*`, no em-dash,
`npm run i18n:check:strict` must stay clean.

## Goals / Non-Goals

**Goals**
- Replace the empty launch wait with an engaging, visibly **advancing** multi-step indicator.
- One shared treatment wired into both launch sites so they cannot drift.
- Reduced-motion parity with play-web's `Working`.
- A pure, unit-testable rotation seam (there is no creator component test runner).

**Non-Goals**
- No real progress telemetry. **The steps are reassurance, not measured progress** — `launchRun` is
  a single opaque round-trip, so the indicator is honest-indeterminate: a sweeping bar, never a
  fake precise percentage, and the copy never claims a step "finished".
- No backend/callable change; no new dependency; no other creator wait.

## Decisions

### 1. Pure rotation helper — the testable seam

New `apps/creator-web/src/lib/launchLiftoff.ts`:

```ts
// Which liftoff step is shown at rotation tick N for a set of `count` steps.
// Total — never throws for any tick/count; a single/empty set never rotates.
export function liftoffStepIndex(tick: number, count: number): number {
  if (!Number.isFinite(count) || count <= 1) return 0;
  const n = Math.floor(count);
  const t = Number.isFinite(tick) ? Math.floor(tick) : 0;
  return ((t % n) + n) % n;
}
```

Deliberately identical in contract to play-web's `workingMessageIndex` so behaviour can't drift and
the same fast-lane test style applies. Kept in `lib/` (no React) so `scripts/test-launch-liftoff.ts`
can import and assert it with no component runner.

**Why a separate helper, not reuse play-web's:** `packages/shared` is framework-free but this pair
(helper + component) is UI-app-local; play-web and creator-web are separate apps with separate
themes and deliberately keep behaviourally-matched twins (same pattern as `lazyWithRetry`). Copying
the tiny helper + a co-located test is cheaper and safer than a cross-app import.

### 2. `LaunchLiftoff` component (dark theme)

New `apps/creator-web/src/components/LaunchLiftoff.tsx` — a full-screen overlay shown while a launch
is in flight:

- Props: `open: boolean`, `messages: string[]` (2-4 pre-translated lines the caller passes from
  `t.launch.*`), `title: string`, optional `intervalMs` (default 1800, matching play-web).
- Rotates the current line on a `setInterval` cleared on unmount; `aria-live="polite"` +
  `role="status"` so the changing line is announced. `dir="auto"` on the text.
- The bar is an **indeterminate sweep** (`rp-liftoff-sweep`, a new keyframe) using the RushPoint
  fire→amber gradient so it reads as forward motion.
- **Reduced motion** (`prefersReducedMotion()`, copied SSR-safe guard): no interval, show
  `messages[0]` only, and the bar shows a modest **static fill** (reads as "in progress", not a
  chasing animation). Mirrors `Working`.
- Renders `null` when `!open`. No store, no callable, no new dependency.

### 3. CSS — one new keyframe with a reduced-motion guard

Add to `apps/creator-web/src/index.css`, mirroring the existing `rp-skeleton` block (lines 213-235):
an `@keyframes rp-liftoff-sweep` that translates a gradient bar left→right, and a
`@media (prefers-reduced-motion: reduce)` rule that disables it. (The global reduced-motion block at
lines 168-176 already neutralises animation durations; the component also branches in JS so the bar
degrades to a static fill, not merely a frozen sweep.)

### 4. Wiring — a `launching` flag at both call sites

- **BuilderPage** (`saveAndLaunch`): set `launching = true` before `save()`/`launchRun`, render
  `<LaunchLiftoff open={launching} .../>` at the page root, pass `loading={launching}` to both
  launch buttons (lines 531-532), and clear `launching` in a `finally` (so it clears on the error
  path before the billing/error dialog; on success the component unmounts when `nav(...)` leaves the
  Builder). Guarded so a save/readiness refusal also clears it.
- **DashboardPage** (`launch`): same `launching` state + overlay + `finally` clear; the launch
  control(s) get `loading={launching}`.
- The overlay lives in each page (not a global provider) to keep the change small and local; both
  pass the SAME `t.launch.*` messages so the experience is identical.

### 5. i18n — a new `launch` namespace (HE + EN)

Add a top-level `launch` namespace to both dictionaries in `i18n.ts`. Proposed copy (no em-dash,
friendly, honest-indeterminate — none claims a precise percentage or a completed step):

| key | Hebrew (he) | English (en) |
|---|---|---|
| `launch.title` | `'מכינים את הריצה שלכם'` | `'Getting your run ready'` |
| `launch.step1` | `'מכינים את הריצה'` | `'Preparing your run'` |
| `launch.step2` | `'יוצרים את קוד ההצטרפות'` | `'Creating the join code'` |
| `launch.step3` | `'פותחים את השערים'` | `'Opening the gates'` |

The component receives `[step1, step2, step3]` as `messages` and `title` as the heading. Both HE and
EN kept in parity; `npm run i18n:check:strict` must pass (HE really Hebrew, EN really English, no new
PART B hardcoded string — every string routes through `t.launch.*`).

## Risks / Trade-offs

- **Perceived-progress honesty.** A moving bar could imply measured progress. Mitigated by: an
  indeterminate sweep (no number shown), reassurance-only copy, and this design stating plainly the
  steps are not telemetry.
- **Overlay stuck open on an error.** Mitigated by clearing `launching` in `finally` at both sites,
  before any error/billing dialog.
- **Bundle budget.** CSS-only animation, no dependency; `bundle:budget` unaffected (and it measures
  play-web, not creator-web).

## Test Strategy (TDD)

- **RED:** `scripts/test-launch-liftoff.ts` (auto-discovered by the `npm test` aggregator) asserts
  `liftoffStepIndex`: index 0 for count 0/1, correct wrap for tick 0..N and tick ≥ N, negative and
  non-finite tick/count handled (never throws), matching the `workingMessageIndex` contract. Fails
  first because `lib/launchLiftoff.ts` does not exist yet.
- **GREEN:** add `lib/launchLiftoff.ts` to pass; add `LaunchLiftoff.tsx`, the CSS keyframe, the
  `launch` i18n namespace, and wire both call sites.
- **REFACTOR:** dedupe the reduced-motion guard style with the existing pattern; confirm both launch
  sites pass identical messages.
- **UI verification** is by preview tools only (no creator component runner) — the pure helper is the
  automated seam, exactly as `workingMessageIndex` is for the participant twin.
- **Gates:** `npm run i18n:check:strict` (mandatory after this UI change), plus the standard
  `npm run verify` set.
