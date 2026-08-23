# Wave L — Creator console (non-Builder) UI/UX polish

Behavior-preserving visual/organization pass over the creator-web pages **excluding** the
Builder (owned by another agent). No logic, callable, flow, or copy changes. Existing `t.*`
strings and existing `components/ui` primitives only. Dark theme preserved. RTL-safe logical
classes only.

Owner scope: `apps/creator-web/src/pages/{DashboardPage,GalleryPage,WalletPage,RunConsolePage,
SettingsPage}.tsx` + `apps/creator-web/src/components/AuthGate.tsx` (the logged-out landing
lives here, NOT in App.tsx).

## Design-token background (why some pages get a token migration)

The app has two generations of tokens:
- **Current design system** — `[--ink-1/2/3]`, `[--surface-0/1/2]`, `[--rp-border]`, brand
  `rp-fire / rp-amber / rp-plasma / rp-signal / rp-go / rp-alert`. Used by Dashboard, Wallet,
  Settings, AuthGate.
- **Legacy "Warm Trail" tokens** — `text-zinc-*` (reversed scale), `bg-app-raised`, `bg-app-bg`,
  `neon-green` (aliased to rp-fire), `neon-red`, `text-danger`. Still valid in the Tailwind
  config, but visually and semantically inconsistent. Used by GalleryPage and (heavily)
  RunConsolePage.

CSS custom props actually defined in `index.css`: `--ink-1/2/3`, `--surface-0/1/2`,
`--rp-border`. NOTE: `--rp-raised` and `--rp-card` are referenced by RunConsole's Feedback/Survey
panels (`bg-[--rp-raised]`, `bg-[--rp-card]`) but are **not defined** — they resolve to an empty
background. Pre-existing; flagged for the parent, left untouched (out of scope + a color change).

---

## Per page

### DashboardPage — LIGHT TOUCH (already strongly polished)
Already a well-composed hero + stats + card grid + banner, on the current token system with good
hierarchy, skeletons, and empty state. Left essentially as-is to avoid regressions I cannot
visually verify. No change needed for "organized + attractive".

### WalletPage — LIGHT TOUCH (already polished)
Already on the current token system with a clear balance card, package grid, Pro card, referral,
and history. Minor: none required. Left as-is.

### GalleryPage — MAIN REWORK
Before: plain `text-2xl` heading, crude inline tab buttons + view toggle, legacy `zinc/app-raised/
neon-green` tokens mixed in, no page container/animation, cards using `text-zinc-*`.
After (visual only, same strings + logic + callables):
- Page wrapped in `max-w-6xl mx-auto animate-fade-up` container matching sibling pages.
- Brand-font header with clearer type scale; subtitle on the current token system.
- Toolbar redesign: the games/tasks tabs become a cohesive segmented control; the list/map view
  toggle sits in the same row, right-aligned via `ms-auto`, visually consistent segmented style.
- Search row: same Input + Button, tightened spacing, clear separation from the toolbar.
- Cards migrated to current tokens (`[--ink-*]`, `[--surface-2]`, `rp-fire`, `[--rp-border]`),
  consistent meta rows with dot separators, hover affordance retained.
- The focus-ring on a map-selected card uses `ring-rp-fire` (was `ring-neon-green`, same hue).
All `gl.*` / `b.*` strings unchanged; tab/view state, search debounce, copy action untouched.

### RunConsolePage — STRUCTURAL GROUPING (careful; very dense, ~1670 lines)
Only the top-level page shell restructured; the many sub-panels/components and ALL callable wiring
left byte-for-byte. Changes:
- Header hierarchy: brand font on the title, tightened status/badge row.
- The flat run-control buttons (`Start all / Refresh / Invite staff / Finalize`) grouped into a
  labelled control bar (a bordered surface) so the primary live-ops actions read as one toolbar
  instead of loose buttons.
- Light spacing consistency on the top region. Deep panels (photo queue, feedback, analytics,
  chat, zones, trackables) NOT restructured — logic-adjacent and risky to touch blind.
No token migration inside the deep panels (too broad to verify without a browser).

### SettingsPage — LIGHT TOUCH
Already clean card-per-section on the current token system. Left as-is (adding a subtitle would
need a new i18n key, which is locked).

### AuthGate / Landing — LIGHT TOUCH (already polished)
Recently redesigned hero + phone mockup + features + how-it-works + auth card, all on the current
token system. Left as-is.

---

## Needed-but-not-added i18n keys (for the parent to add later)
None required — the pass used only existing strings.

## Needed-but-not-added primitives (for the parent to consider)
- A `SectionHeading` primitive (small uppercase label + optional trailing action) would DRY the
  many `text-sm font-medium mb-3` panel titles in RunConsole. Not added (ui.tsx locked). Low value.
- Defining `--rp-raised` / `--rp-card` CSS vars (or migrating those RunConsole panels to
  `--surface-2`) would fix the empty-background bug noted above.

## Verification
- `npx tsc --noEmit -p apps/creator-web/tsconfig.json`
- `npx eslint` on the touched files
- No emulator / shared:build / creator:build (concurrent-build corruption risk per task).
- Could not run the browser preview (MCP pane times out here); reasoned from code.
