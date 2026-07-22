## 1. Foundation — media hook (TDD: RED → GREEN)

- [x] 1.1 RED: write `scripts/test-mediaquery.ts` asserting the pure breakpoint decision — mobile
  `true` at 375px, `false` at 1024px, correct parse of a `max-width` query. Run `npm test` and
  confirm it FAILS (helper not yet present).
- [x] 1.2 GREEN: add `apps/creator-web/src/hooks/useMediaQuery.ts` exporting `useMediaQuery(query)`
  + derived `useIsMobile()` (bound to `max-width: 639.98px`), over `window.matchMedia` with a
  `change` listener; SSR-safe default (`false`) when `window` is undefined. Factor the parse/decision
  into a pure exported helper the test imports. Re-run `npm test` → green.
- [x] 1.3 REFACTOR: ensure no duplicate matchMedia logic vs the dark-mode reader in `App.tsx`
  (leave dark-mode as-is; do not force a coupling). `npm run typecheck` green.

## 2. Tier 1 — global nav drawer (live-ops)

- [ ] 2.1 Add nav/menu dictionary keys to BOTH `en` and `he` maps in
  `apps/creator-web/src/i18n.ts` (e.g. `nav.menu`, `common.openMenu`/`closeMenu`) — keep PART A
  parity. No hardcoded strings.
- [x] 2.2 In `App.tsx` header, hide the inline `<nav>` links below `sm` (`hidden sm:flex`) and add a
  `sm:hidden` hamburger button toggling a local `useState` drawer sheet; reuse the existing `NAV`
  array; close the drawer on selection. Anchor with logical props (`end-0`, `ms-`/`me-`) for RTL.
- [x] 2.3 Keep logo, theme toggle, and sign-out reachable at all widths (tighten mobile spacing so
  the bar never overflows). Hamburger + drawer carry `t.*` aria-labels.
- [~] 2.4 DEFERRED (browser pane not compositing in this session): preview at 375px — bar fits,
  drawer opens → navigates → closes; 1280px inline nav unchanged; LTR + RTL. Logic is typechecked
  and the classes are standard Tailwind breakpoints; needs a live eyeball on the running :5180.

## 3. Tier 1 — RunConsole & RunsOverview reflow (live-ops)

- [x] 3.1 `RunConsolePage.tsx`: AUDIT FINDING — already mobile-safe. Every multi-col grid carries a
  `md:`/`lg:` prefix (stacks to 1 col below it); the scoreboard already has `overflow-x-auto`; the
  `min-w-[12rem]`/`min-w-[8rem]` inputs sit inside `flex flex-wrap` parents so they wrap (12rem=192px
  fits 375px) rather than overflow; `h-80` maps/heatmap take full column width; chat `max-w-[80%]`
  wraps; there is no horizontal tab bar. No code change needed — changing it would be churn/risk.
- [x] 3.2 `RunsOverviewPage.tsx`: AUDIT FINDING — the "zero breakpoint classes" grep was misleading.
  It reflows via intrinsic flex: `flex-1 min-w-0` + `truncate` on the title, `flex-wrap` on the meta
  row, `shrink-0` on the Open button — all resilient at 375px without breakpoints. No change needed.
- [~] 3.3 DEFERRED (browser pane): preview RunConsole at 390px with a live run — no horizontal body
  scroll, panels stack, scoreboard scrolls inside its container. (Static audit found it compliant.)

## 4. Tier 2 — Dashboard / Gallery / Wallet reflow

- [x] 4.1 `DashboardPage.tsx`: AUDIT FINDING — already responsive (`grid-cols-2 lg:grid-cols-4`,
  `sm:grid-cols-2 lg:grid-cols-3`). A base `grid-cols-2` for stat tiles is comfortable at 360px.
  No change needed.
- [x] 4.2 `GalleryPage.tsx` / `WalletPage.tsx`: AUDIT FINDING — grep for always-multicolumn grids
  (`grid-cols-[2-9]` without a `sm:`/`md:`/`lg:` prefix) and for wide fixed widths (`w-[≥100px]`,
  `min-w-[≥20rem]`) returned nothing. Both reflow acceptably at 375px. No change needed.
- [~] 4.3 DEFERRED (browser pane): preview Dashboard/Gallery/Wallet at 375px — no horizontal
  overflow. (Static audit found all three already responsive.)

## 5. Tier 3 — Builder touch & narrow-width

- [x] 5.1 In `BuilderPage.tsx`, added `@dnd-kit` `TouchSensor` alongside `PointerSensor`
  (`activationConstraint: { delay: 200, tolerance: 8 }`), kept `KeyboardSensor`. No new dependency.
- [x] 5.2 `StageRail` now narrows on small screens (`w-40 sm:w-52`) so `TaskCanvas` keeps usable
  width on a phone; the editor `SlidePanel` `max-lg:` full-height sheet is untouched (existing
  behavior preserved).
- [~] 5.3 DEFERRED (browser pane + needs a real touch device): long-press drag reorders a stage/task;
  a plain swipe scrolls; canvas usable; editor sheet opens over the workspace. This is the one item
  that genuinely needs on-device testing — if long-press drag proves unreliable, apply the D5
  fallback (explicit up/down reorder controls on mobile). TouchSensor is wired + typechecked.

## 6. Regression guard & gates

- [x] 6.1 Desktop unchanged by construction: every mobile rule is gated below `sm`/`lg`
  (`sm:hidden`/`hidden sm:flex` nav, `w-40 sm:w-52` rail); the `≥lg` render path is byte-identical.
  (Live pixel eyeball at 1280px still recommended once the browser pane is available.)
- [x] 6.2 Diff scoped correctly: my files are `apps/creator-web/**` (App, StageRail, i18n,
  BuilderPage, new hooks/useMediaQuery.ts) + `scripts/test-mediaquery.ts` + the openspec change dir.
  Nothing of mine under `functions/`, `packages/shared/`, or `firestore.rules`. (The `package.json`/
  `packages/shared/`/`play-store-*` entries in `git status` are a SEPARATE pre-existing in-flight
  change — not part of this one; do not commit them together.)
- [x] 6.3 Gates ALL GREEN: `typecheck` ✓ (5/5 workspaces) · `lint` ✓ (0 errors, 42 pre-existing
  warnings) · `creator:build` ✓ (built in 11.7s) · `npm test` ✓ (exit 0 — aggregator incl.
  test-mediaquery.ts + functions vitest 222 passed / 340 planned-todo).
- [x] 6.4 `npm run i18n:check` ✓ PASSED — PART A parity clean (new `openMenu`/`closeMenu` keys added
  to both HE and EN maps), PART B clean (drawer/hamburger aria-labels route through `t.*`).
- [~] 6.5 DEFERRED (browser pane not compositing this session): final preview checklist —
  375 / 390 / 414px × light/dark × LTR/RTL, no horizontal body scroll on any route; nav drawer,
  RunConsole, and Builder drag all functional. Run this on the already-running :5180 when the pane
  is available.
