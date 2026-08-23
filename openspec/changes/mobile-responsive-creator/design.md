## Context

`apps/creator-web` is a desktop-first React 18 + Vite console (dark, Hebrew-first). The mobile
foundation is partly there but incomplete:

- `index.html` already ships a correct `<meta name="viewport">` + PWA/apple-mobile tags and a
  manifest — no work needed there.
- `App.tsx` renders a **single non-wrapping flex row** header (logo · nav links · username ·
  theme toggle · sign-out). Only `hidden sm:block` on the username. On a phone the nav overflows.
  The Builder route (`/build/*`) deliberately hides this header and hosts its own compact bar.
- `RunConsolePage.tsx` is **already partly responsive** (`grid md:grid-cols-2`,
  `grid lg:grid-cols-3`, `grid-cols-2 sm:grid-cols-4`) and its scoreboard table is **already**
  wrapped in `overflow-x-auto` (line ~1384). Remaining risks are fixed-width panels
  (`min-w-[12rem]`, `min-w-[8rem]`), chat bubbles (`max-w-[80%]`), and `h-80` maps at 375px.
- `RunsOverviewPage.tsx` has **zero** responsive classes.
- `DashboardPage.tsx` already uses `sm:`/`lg:` grids (closest to done). `GalleryPage.tsx` /
  `WalletPage.tsx` have a couple of breakpoint classes but need a pass.
- `BuilderPage.tsx` is an `h-screen overflow-hidden`, `max-w-[1680px]` 3-pane shell:
  `StageRail` + `TaskCanvas` in a `flex gap-3 h-full`, plus an editor `SlidePanel`. DnD uses
  `@dnd-kit` with **`PointerSensor` + `KeyboardSensor` only — no `TouchSensor`**
  (`activationConstraint: { delay: 180, tolerance: 6 }`). The editor `SlidePanel` **already**
  converts to a `max-lg:fixed inset-y-0 end-0 w-[min(100vw,32rem)]` full-height sheet.
- **No layout media hook exists** — the only `matchMedia` use is dark-mode detection.

Constraints: Tailwind **static class strings only** (no `bg-${x}`); prefer logical props
(`ms-`/`me-`/`text-start`) for RTL; all user-facing text through `t.*`; `npm run i18n:check` is a
hard gate for any UI change; creator-web has **no component test runner** (UI verified via the
preview tools). Default Tailwind breakpoints are in force (no custom `screens` config): `sm`=640,
`md`=768, `lg`=1024.

## Goals / Non-Goals

**Goals:**
- Make the console comfortable on 360–430px phones, prioritizing the **live-ops** path
  (nav, RunConsole, RunsOverview) a creator uses in the field.
- Introduce one reusable, tested `useMediaQuery`/`useIsMobile` hook as the canonical breakpoint
  source of truth.
- Reflow Dashboard/Gallery/Wallet cleanly.
- Make the Builder's drag-and-drop workable by touch and keep the canvas usable on narrow width.
- Zero desktop regressions; zero backend/shared/rules changes; i18n stays green.

**Non-Goals:**
- No `play-web`/staff-console changes (already mobile-first).
- No visual redesign, new theme, or new component library.
- No native app, no separate mobile codebase, no new DnD dependency.
- No callable/type/rule change — nothing under `functions/`, `packages/shared/`, `firestore.rules`.

## Decisions

### D1 — Add a `useMediaQuery` hook; make `useIsMobile` the single breakpoint source
Add `apps/creator-web/src/hooks/useMediaQuery.ts` exporting `useMediaQuery(query)` and a derived
`useIsMobile()` bound to `max-width: 639.98px` (below Tailwind `sm`). Implement over
`window.matchMedia` with a `change` listener; SSR-safe default (`false`) when `window` is
undefined. Extract the pure decision (`matchesQuery(width, query)` or a thin `mediaState` mapper)
into a testable function so the pure-logic lane can cover it without a live DOM.
- *Why:* one contract, unit-testable, mirrors the existing dark-mode `matchMedia` pattern.
- *Alternatives:* (a) resize-listener + `innerWidth` — more re-renders, no query semantics;
  (b) Tailwind-only, no JS hook — insufficient for the Builder, which needs to *branch behavior*
  (sensor choice, rail mode), not just toggle classes.
- *Note:* Tailwind responsive utilities remain the primary tool for pure show/hide/reflow; the JS
  hook is reserved for cases that change **behavior/DOM**, chiefly the nav drawer and the Builder.

### D2 — Nav: hamburger + drawer below `sm`, pure Tailwind toggle where possible
Below `sm`, hide the inline `<nav>` links (`hidden sm:flex`) and show a hamburger button
(`sm:hidden`) that toggles a `useState` drawer (an absolutely/fixed-positioned sheet under the
header, or a slide-in). Reuse existing `NavLink` items from the `NAV` array; closing on selection
via `onClick`. Keep logo, theme toggle, sign-out in the bar at all widths (shrink spacing on
mobile). All labels via `t.*`; add `t.nav.menu`/`aria-label` keys (EN + HE) — this is the one
place that adds new dictionary strings, so PART A parity must be updated in both `i18n.ts` maps.
- *Why:* smallest change that stops overflow; no new dep; drawer state is trivial local `useState`.
- *Alternatives:* a full off-canvas component from a library (overkill; adds a dep); wrapping the
  nav with `flex-wrap` (still cramped, ugly on 360px).

### D3 — RunConsole / RunsOverview: breakpoint audit, not a rewrite
Walk each fixed-width utility at a 390px viewport and relax it: convert `min-w-[12rem]`/`min-w-[8rem]`
inputs to `w-full sm:min-w-[…]`; ensure every `grid md:/lg:` degrades to one column (they already
start `grid-cols-1`/unspecified, so mostly verify); keep the scoreboard's existing `overflow-x-auto`;
confirm `h-80` maps/heatmap sit in a full-width column; keep chat `max-w-[80%]` (fine once the parent
is single-column). `RunsOverviewPage` gets real breakpoint classes for its list/cards.
- *Why:* the structure is already close; targeted relaxation beats restructuring and limits regression risk.

### D4 — Dashboard/Gallery/Wallet: tighten existing grids
Mostly verification + minor `grid-cols` / gap / padding tweaks at 360–414px. No structural change.

### D5 — Builder: add `TouchSensor`, keep pointer for mouse, adapt the rail
Add `@dnd-kit`'s `TouchSensor` alongside `PointerSensor` with a press delay + tolerance
(`{ delay: 200, tolerance: 8 }`) so a long-press starts a drag while a plain swipe scrolls. Keep
`KeyboardSensor`. For narrow width, make `StageRail` collapse to a compact/toggleable strip (driven
by `useIsMobile` and/or a `max-lg:` utility) so `TaskCanvas` keeps usable width; lean on the
already-working `SlidePanel` sheet for the editor. `@dnd-kit` supports `TouchSensor` natively — no
new dependency.
- *Why:* `TouchSensor` with an activation delay is the standard `@dnd-kit` answer to the
  drag-vs-scroll conflict; the editor sheet is already solved.
- *Alternatives:* replacing DnD reorder with up/down arrow buttons on mobile (more predictable on
  touch, but a UX divergence + extra code — keep as the fallback in Open Questions); a different DnD
  library (rejected: new dep, large rewrite).
- *Risk area:* this is the one place needing real device/preview testing; ship Tiers 1–2 first so
  value lands even if Tier 3 needs iteration.

### D6 — Verification without a component runner
Verify via the preview tools at phone viewports (resize to 375/390/414, both light and dark, and
RTL Hebrew): no horizontal body scroll, nav drawer opens/navigates/closes, RunConsole panels reflow,
Builder drag-reorder works by simulated touch. Gate with `typecheck`/`lint`/`creator:build` and,
mandatory, `i18n:check`. Pure-logic `scripts/test-mediaquery.ts` covers the hook's decision logic.

## Risks / Trade-offs

- **Builder touch-DnD is the real unknown** → Land it last, behind Tiers 1–2; if long-press drag
  proves fiddly on real devices, fall back to explicit reorder controls on mobile (D5 alternative).
- **Adding nav dictionary keys can break the i18n PART A hard gate** → Add the new keys to BOTH
  `en` and `he` maps in the same commit and run `i18n:check` before declaring done.
- **`useIsMobile` overuse causing needless re-renders / hydration fl‑style flashes** → Prefer
  Tailwind classes for pure show/hide; reserve the hook for genuine behavior branches (drawer,
  sensors, rail mode). SSR-safe default prevents a crash in non-DOM contexts.
- **RTL correctness on the new drawer** → Use logical props (`ms-`/`me-`/`text-start`, `end-0`) so
  the sheet anchors correctly in Hebrew; verify in the RTL preview.
- **Regression to desktop** → All mobile behavior is gated below `sm`/`lg`; verify each touched page
  at 1280px is pixel-unchanged.
- **No automated UI test** → Compensate with a documented preview-tool checklist (D6) run at 3
  widths × light/dark × LTR/RTL.

## Migration Plan

Pure additive front-end change; nothing to migrate or roll back at the data layer. Sequence:
1. Hook + pure-logic test (`useMediaQuery.ts`, `scripts/test-mediaquery.ts`).
2. Tier 1: nav drawer → RunConsole audit → RunsOverview. Verify each at 375/390px.
3. Tier 2: Dashboard/Gallery/Wallet reflow.
4. Tier 3: Builder `TouchSensor` + rail adaptation.
5. Run all gates + `i18n:check`; preview-tool checklist across widths/themes/RTL.
Rollback = revert the creator-web commits; no backend coupling.

## Open Questions

- **Builder authoring on mobile — how far?** Is long-press drag-reorder acceptable, or should
  mobile switch to explicit up/down reorder controls (and treat drag as desktop-only)? Decide after
  a first device test in Tier 3.
- **Breakpoint for "mobile" in the Builder** — `sm` (640) for nav vs `lg` (1024) for the Builder
  sheet: keep the existing `lg` boundary the Builder already uses, and `sm` for the global nav?
  (Leaning yes — matches the two existing conventions.)
- **Do we want a persisted "desktop site" escape hatch** for creators who prefer the full layout on
  a tablet? Out of scope unless requested.
