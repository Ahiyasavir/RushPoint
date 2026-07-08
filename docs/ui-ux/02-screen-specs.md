# Phase 2 Specs — Tier 1 & 2 screen-level upgrades

Same verification model as `01-foundation-specs.md` (no component runner; preview + build +
i18n gates). Every new user-facing string is routed through `t.*` and added to BOTH `en` and
`he` in the app's `i18n.ts`, appended in an isolated block to reduce merge risk with the
parallel backend agent.

---

## Item 5 — Dashboard: skeleton grid + responsive action row + tap targets

### SDD
- **File:** `apps/creator-web/src/pages/DashboardPage.tsx` (uses new `Skeleton`).
- **Loading:** replace the `<Spinner label={d.loadingGames} />` branch with a responsive grid of
  6 `Skeleton` cards matching the real card footprint (`grid sm:grid-cols-2 lg:grid-cols-3 gap-4`,
  each a `Skeleton className="h-40"` inside the `Card` shell or a bespoke `h-40 rounded-2xl`).
- **Action row:** the game-card button cluster changes from a fixed `flex gap-2` to
  `flex flex-wrap gap-2` (and small buttons get `flex-1 min-w-[calc(50%-0.25rem)]` on the tightest
  breakpoint so they stack 2-up on narrow phones instead of overflowing).
- **Tap targets:** any icon-only control on the card (if present) gets `min-h-[40px]`/`min-w-[40px]`.
- **Design fit:** reuses Card, Button, Skeleton; no new tokens.

### TDD / QA
- [ ] Initial load shows 6 shimmer cards, not a lone spinner; layout doesn't shift when data arrives.
- [ ] At 375px, card action buttons wrap to 2 rows and never overflow the card / clip text.
- [ ] At ≥1024px, 3-column grid unchanged from today.
- [ ] Dark + light both readable.
- [ ] Empty state (new creator, 0 games) still shows the hero CTA (unchanged).
- [ ] typecheck + creator:build + i18n:check green.

## Item 6 — Gallery: debounced search + copy toast + result skeletons

### SDD
- **File:** `apps/creator-web/src/pages/GalleryPage.tsx` (+ `toast`, `Skeleton`, `EmptyState`).
- **Debounced search:** add a `useEffect` on `q` (350ms `setTimeout`, cleared on change) that calls
  `run()`; keep Enter + button as immediate triggers. Guard the very first mount so it doesn't
  double-fetch with the existing `[tab]` effect (share one `run()`; the tab effect stays).
- **Copy feedback:** `copy()` already navigates away on success, so the friction is the *pre-nav*
  delay — set the copy Button to `loading={busy}` (Item 2) and, on failure, `toast.error(...)`
  instead of a blocking dialog. (Success = navigation, so no toast needed there.)
- **Skeletons:** replace `<Spinner/>` in both tabs with a 6-card skeleton grid.
- **Empty:** swap the inline `<Empty/>` for the shared `EmptyState` (icon 🔭, title, body, and an
  action that clears the query).
- **Design fit:** existing tab/search layout unchanged; only the loading/empty/feedback layers change.

### TDD / QA
- [ ] Typing in search auto-runs after ~350ms idle; rapid typing fires once (debounced).
- [ ] Enter and the Search button still fire immediately.
- [ ] Switching tabs still loads that tab (no regression from the shared effect).
- [ ] Copy button shows inline spinner while duplicating; on error a red toast appears (no modal).
- [ ] No results → EmptyState with a "clear search" action that empties the field + reloads.
- [ ] Loading shows skeleton grid.
- [ ] RTL + i18n:check clean.

## Item 7 — Runs overview: copy-code + error retry + skeleton

### SDD
- **File:** `apps/creator-web/src/pages/RunsOverviewPage.tsx` (+ `Skeleton`, `toast`).
- **Copy code:** wrap the access code in a `<button>` (`aria-label` = `t.liveRuns.copyCode`) that
  `navigator.clipboard.writeText(run.accessCode)` then `toast.success(t.liveRuns.copied)`; show a
  tiny 📋 affordance. Keep the mono styling.
- **Error retry:** when `errored`, render the message with a `Button` "Retry" that re-invokes the
  loader (extract `load()` out of the effect into a `useCallback` so the button can call it).
- **Skeleton:** initial `runs === null` state shows 3 skeleton row-cards instead of the centered spinner.
- **Design fit:** Card rows unchanged; only the code becomes interactive + skeleton/ retry added.

### TDD / QA
- [ ] Tapping the code copies it and pops a success toast; button has `aria-label`.
- [ ] Simulated load error → message + working Retry that clears the error on success.
- [ ] Initial load shows 3 skeleton rows.
- [ ] Poll loop (10s) still refreshes without resetting the error incorrectly.
- [ ] Mobile: code + copy affordance don't overflow the row.
- [ ] i18n:check clean.

## Item 8 — Global header icon-button a11y

### SDD
- **File:** `apps/creator-web/src/App.tsx`.
- Theme toggle button: add `aria-label={dark ? t.common.lightMode : t.common.darkMode}` (keep the
  existing `title`), bump `w-8 h-8` → `w-10 h-10`, add `focus-visible:ring-2
  focus-visible:ring-rp-fire/60`.
- Sign-out text button: add `focus-visible` ring for keyboard parity.

### TDD / QA
- [ ] Theme toggle exposes an accessible name (preview snapshot shows aria-label).
- [ ] Hit area ≥40px (inspect bounding box).
- [ ] Keyboard focus ring visible on both header controls.
- [ ] No layout shift in the 56px header row.

---

## Item 9 — Haptics utility wired into live feedback (play-web)

### SDD
- **New file:** `apps/play-web/src/lib/haptics.ts`:
  ```ts
  type Pattern = 'tap' | 'success' | 'warn' | 'error';
  const MAP: Record<Pattern, number | number[]> = {
    tap: 10, success: [12, 40, 18], warn: [20, 60, 20], error: [40, 30, 40, 30, 40],
  };
  export function haptic(p: Pattern): void {
    try {
      if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      navigator.vibrate(MAP[p]);
    } catch { /* unsupported — silent no-op */ }
  }
  ```
- **Wire-in (guarded, one buzz per event, no loops):**
  - `LiveOps.tsx`: when a NEW score notice (`kind:'score'`) enters `liveAnnouncements`, fire
    `haptic('success')` for positive delta, `haptic('warn')` for negative. Track "seen" ids in a
    `useRef<Set>` so re-renders don't re-buzz; only buzz on ids not previously seen AND not on the
    very first snapshot (avoid buzzing the backlog on mount).
  - `InRunAlerts.tsx`: when `active` transitions false→true (hot zone opens) fire `haptic('warn')`;
    track with a ref.
  - `ConnectionBanner.tsx`: on the `offline` event (transition to `online === false`) fire
    `haptic('error')`.
- **Design fit:** zero visual change; purely additive native feedback. Respects reduced-motion.

### TDD / QA
- [ ] Desktop Chrome (no vibrate) → no error thrown, silent no-op (console clean).
- [ ] `prefers-reduced-motion: reduce` → `haptic()` returns early (verify via preview eval that it no-ops).
- [ ] Logic check: score notice already on screen at mount does NOT buzz; a newly-arriving one does
      (unit-reason via the seen-ref; verify by code review + preview eval simulating a new doc).
- [ ] Hot-zone open buzzes once, not every countdown tick.
- [ ] Offline event buzzes once.
- [ ] play:build + typecheck green.

## Item 10 — GamePromo: cover-image skeleton + share button (+ honest error copy)

### SDD
- **File:** `apps/play-web/src/screens/GamePromoScreen.tsx`.
- **Reality check:** the client cannot distinguish "not found" from "not public" — `publicGame`
  `getDoc` returns non-existent for both. So do NOT fabricate two states. Instead keep one clear
  error and ADD a "re-enter code" affordance (already present) + a short helper line. (No false
  precision.)
- **Cover-image progressive load:** wrap the `<img>` in a container with an absolutely-positioned
  `Skeleton` (play-web) shown until `onLoad`; track `imgLoaded` state; `img` fades in
  (`opacity-0 → opacity-100 transition`). Broken image (`onError`) → fall back to the existing
  gradient placeholder.
- **Share:** add a ghost `Button` "Share this game" near the CTA that uses the Web Share API with a
  clipboard fallback (same pattern as `PublicLeaderboardScreen.share()`), sharing
  `window.location.href`. On clipboard fallback, briefly swap label to "Link copied ✓" (local
  2s state) — Web Share API + clipboard are both free/native.
- **Skeleton primitive:** needs Item 1's play-web `Skeleton`.

### TDD / QA
- [ ] Cover image area shows a shimmer until the image loads, then fades in (throttle network in
      preview to observe).
- [ ] Broken image URL → gradient placeholder, no broken-image icon.
- [ ] Share button: on a browser with `navigator.share` opens the sheet; without it, copies URL and
      shows "Link copied ✓" for ~2s.
- [ ] No-cover games still show the gradient hero (unchanged).
- [ ] RTL layout intact; i18n:check clean (share + copied labels via `t.*`).

## Item 11 — PublicLeaderboard: manual refresh + freshness stamp

### SDD
- **File:** `apps/play-web/src/screens/PublicLeaderboardScreen.tsx`.
- Share button already exists — leave it. Add:
  - A `lastUpdated` timestamp state set inside `load()` on success; render a small
    "Updated Ns ago" line under the live/frozen badge that recomputes every second (a light
    `useState(now)` tick already patternable). Use relative seconds/minutes via a tiny formatter.
  - A manual **Refresh** ghost button (icon ↻ + label) next to the status that calls `load()` and
    spins (`loading` state from Item 2 not available here — use a local `refreshing` bool + a
    rotating icon) — disabled while refreshing.
  - Only show the freshness/refresh row while `isLive` (finished/frozen boards are static).
- **Design fit:** small addition to the header block; existing rankings untouched.

### TDD / QA
- [ ] Live board shows "Updated Ns ago" that increments each second and resets to 0 on poll/refresh.
- [ ] Refresh button re-fetches and resets the stamp; disabled + spinner during fetch.
- [ ] Finished/frozen board hides the refresh row (no meaningless "live" affordances).
- [ ] Error + not-published states unchanged.
- [ ] i18n:check clean (updatedAgo, refresh labels via `t.*`).

## Item 12 — FinalScreen: finish confetti + waiting indicator + medal consistency

### SDD
- **Files:** `apps/play-web/src/screens/FinalScreen.tsx`; new `apps/play-web/src/lib/confetti.ts`.
- **Confetti util** (`lib/confetti.ts`): a dependency-free canvas burst — `fireConfetti(opts?)`
  creates a fixed, `pointer-events:none`, top-layer `<canvas>`, animates ~120 particles with
  gravity for ~2.2s, then removes itself. **Guard:** early-return if
  `prefers-reduced-motion: reduce`. Colors from the brand palette (`#FF5722,#FFB300,#10B981,#06B6D4`).
  (This is a fresh, isolated util — it does NOT touch CeremonyScreen's existing confetti.)
- **Trigger:** in FinalScreen, fire ONCE on mount (a `useRef` guard) when the player has a finish
  (i.e., the finish/score block renders), after a short delay so it lands with the score-pop.
- **Waiting indicator:** the "waiting for host to finalize" block gains a small spinner + a subtle
  pulsing hint that it auto-updates; no fake progress bar (we don't know ETA) — an indeterminate
  spinner + reassuring copy is honest.
- **Medal consistency:** for ranks 4+, render a neutral rank pill (consistent size/shape with the
  medal slot) rather than a bare number, so the list reads evenly. Keep 🥇🥈🥉 for top 3.
- **Design fit:** confetti is brand-colored + reduced-motion-safe; medal pill reuses existing text tokens.

### TDD / QA
- [ ] On reaching the finish screen, a confetti burst plays once and cleans up (no leftover canvas
      in the DOM after ~3s — verify via preview eval `document.querySelectorAll('canvas').length`).
- [ ] Re-render / state change does NOT re-fire confetti (ref guard).
- [ ] `prefers-reduced-motion: reduce` → no confetti canvas created.
- [ ] Waiting state shows spinner + copy; resolves to the board when leaderboard arrives.
- [ ] Ranks 4+ show a consistent pill; top-3 medals unchanged.
- [ ] No z-index overlap blocking buttons (canvas is pointer-events:none).
- [ ] play:build + i18n:check green.

## Item 13 — JoinScreen: auto-focus code + animate new member field

### SDD
- **File:** `apps/play-web/src/screens/JoinScreen.tsx`.
- **Auto-focus:** on the code-entry step, `ref` the code Input and focus it on mount (guard for the
  code step only; don't steal focus on the registration step). Respect that it must not scroll the
  page jarringly — use `focus({ preventScroll: true })`.
- **New-member animation:** when a member input is appended, the newly-added row gets the existing
  `animate-fade-up` (or `task-appear`) class and is focus-targeted so it's obvious which field is new.
  Track the "just added" index to apply the animation only to that row.
- **Design fit:** reuses existing keyframes; no new tokens or copy.

### TDD / QA
- [ ] Code step: input is focused on mount (keyboard-ready) without a scroll jump.
- [ ] Registration step: focus is NOT force-stolen away from a field the user is typing in.
- [ ] Adding a member animates the new row in and focuses it.
- [ ] Removing/other members unaffected (no animation replay on unrelated rows).
- [ ] Mobile keyboard behavior sane; RTL intact.
- [ ] play:build green (no new i18n).

## Item 14 — ChallengeTeaser: disable input on expiry + "time's up" state

### SDD
- **File:** `apps/play-web/src/screens/ChallengeTeaser.tsx`.
- `timesUp` is already derived (`left === 0 && !result`). When `timesUp`:
  - Disable the answer `<input>` (`disabled` + `opacity`/cursor) and the submit `Button`.
  - Guard `submit()` to early-return when `timesUp` (defense-in-depth even if Enter is pressed).
  - Show the "time's up" affordance already wired in the timer area; add a one-line prompt under the
    input to "join to keep playing" (reuse the existing CTA copy — no new key if possible; else add
    `t.challenge.timesUpHint`).
- **Design fit:** minimal; uses existing timesUp state + tokens.

### TDD / QA
- [ ] When the countdown hits 0 (and no result yet), the input + submit become disabled.
- [ ] Pressing Enter after expiry does nothing (guarded).
- [ ] Before expiry, submit/typing behave exactly as today.
- [ ] Submitting before expiry still shows correct/wrong and stops the timer (unchanged).
- [ ] i18n:check clean if a hint key was added.
