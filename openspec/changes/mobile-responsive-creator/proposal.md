## Why

The creator console (`apps/creator-web`) was built desktop-first. The viewport/PWA meta is
correct and a few pages already use `sm:`/`lg:` breakpoints, but on a phone the global nav
overflows (a single non-wrapping flex row with no menu), several panels are pinned to fixed
`min-w`/`max-w` widths, and the Builder's 3-pane drag-and-drop workspace is tuned for a mouse.
In the real world a creator builds a game at a desk but **runs the live event from their phone
in the field** — pushing announcements, watching the leaderboard, acknowledging SOS, reviewing
photos — so a comfortable phone experience for live ops is the higher-value, lower-risk win, with
full mobile authoring as a second tier.

## What Changes

**Foundation (shared, small):**
- Add a `useMediaQuery` / `useIsMobile` hook (`apps/creator-web/src/hooks/`) — the first
  layout-oriented media hook in creator-web (only dark-mode `matchMedia` exists today). Pure
  logic, unit-testable.

**Tier 1 — "run live ops from your phone" (priority):**
- **Global nav** (`App.tsx`): collapse the nav links into a mobile hamburger/drawer below `sm`;
  keep logo + theme toggle + sign-out reachable; stop the single flex row from overflowing.
- **RunConsole** (`RunConsolePage.tsx`): audit every fixed `min-w-[…]`/`max-w-[…]` and multi-column
  `grid` for narrow viewports; ensure the scoreboard table (already `overflow-x-auto`) and the
  QR/chat/announcement panels reflow or scroll cleanly; verify the live map + heatmap (`h-80`) and
  chat bubbles (`max-w-[80%]`) at 375px.
- **RunsOverviewPage** (currently **zero** responsive classes): make the live-runs list reflow.

**Tier 2 — general console reflow:**
- **Dashboard / Gallery / Wallet**: tighten existing breakpoint grids so nothing clips at 360–414px;
  Dashboard is already close, Gallery/Wallet need a pass.

**Tier 3 — mobile authoring (highest effort, structural):**
- **Builder** (`BuilderPage.tsx`, `StageRail`, `TaskCanvas`): make the 3-pane `flex gap-3` shell
  usable on touch/narrow — add a `TouchSensor` (or tune the pointer activation) so drag-reorder
  works by finger without hijacking scroll; make the fixed StageRail collapse/adapt on narrow width;
  the editor `SlidePanel` already becomes a `max-lg:fixed` full-height sheet, so lean on that.

**Non-goals:**
- No backend/callable/Firestore/rules changes — this is **creator-web UI only**.
- No changes to `play-web` (already a mobile-first PWA) or the staff console.
- No new visual redesign, theme, or component library — reuse the existing `components/ui.tsx` kit
  and Tailwind tokens; responsive utilities only.
- Not a native app and not a separate mobile-only codebase — one responsive React tree.
- No new dependency (use the already-present `@dnd-kit` touch support, not a new DnD lib).

## Capabilities

### New Capabilities
- `responsive-creator-console`: The creator-web console renders and remains fully operable on
  phone-class viewports (≈360–430px wide) — a collapsible nav, reflowing pages, scroll-safe wide
  content, and touch-workable Builder drag-and-drop — with an explicit mobile-breakpoint contract
  and a reusable media-query hook.

### Modified Capabilities
<!-- None. No existing spec's REQUIREMENTS change; this adds responsive-behavior requirements as a
     new capability rather than altering the behavior contract of an existing feature. -->

## Impact

- **Surfaces touched:** `apps/creator-web` **only** (no shared types, no callables, no rules).
- **Code:**
  - New: `apps/creator-web/src/hooks/useMediaQuery.ts` (+ a pure-logic test).
  - Edited: `App.tsx` (nav), `pages/RunConsolePage.tsx`, `pages/RunsOverviewPage.tsx`,
    `pages/DashboardPage.tsx`, `pages/GalleryPage.tsx`, `pages/WalletPage.tsx`,
    `pages/BuilderPage.tsx`, `components/StageRail.tsx`, `components/TaskCanvas.tsx`,
    possibly small tweaks in `components/ui.tsx`.
- **Dependencies:** none added (`@dnd-kit` already present and supports `TouchSensor`).
- **Tests / gates:** new `scripts/test-*.ts` for the media-query breakpoint logic; **no** e2e
  change (no callable added). **`npm run i18n:check` is mandatory** — the mobile nav/drawer adds
  UI and must route all text through `t.*` (a hamburger `aria-label`, drawer labels).
- **Risk:** low for Tiers 1–2 (Tailwind breakpoint work behind the existing shell); the Builder
  touch-DnD (Tier 3) is the one structural risk and is verified via the preview tools at a phone
  viewport, not an automated runner (creator-web has no component test lane).
