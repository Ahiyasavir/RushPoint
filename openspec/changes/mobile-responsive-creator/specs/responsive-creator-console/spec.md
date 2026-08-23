## ADDED Requirements

### Requirement: Mobile breakpoint contract and media hook

The creator-web console SHALL define a single, reusable breakpoint contract for phone-class
viewports and expose it through a `useMediaQuery` (and derived `useIsMobile`) React hook in
`apps/creator-web/src/hooks/`. "Mobile" SHALL mean a viewport width below the Tailwind `sm`
breakpoint (640px) unless a component documents a different threshold. The hook SHALL be
SSR-safe (return a stable default when `window` is undefined) and SHALL update on viewport
resize and orientation change.

#### Scenario: Hook reports mobile below the breakpoint
- **WHEN** a component calls `useIsMobile()` and the viewport is 375px wide
- **THEN** the hook returns `true`

#### Scenario: Hook reports desktop at or above the breakpoint
- **WHEN** a component calls `useIsMobile()` and the viewport is 1024px wide
- **THEN** the hook returns `false`

#### Scenario: Hook reacts to a resize
- **WHEN** the viewport crosses the breakpoint from 1024px down to 375px
- **THEN** the hook's returned value changes from `false` to `true` without a full reload

#### Scenario: Query-matching logic is unit-testable in isolation
- **WHEN** the pure breakpoint/query-matching helper is called with a given width and query
- **THEN** it returns the correct boolean without needing a live `window`, and this is covered
  by a `scripts/test-*.ts` assertion in the pure-logic lane

### Requirement: Global navigation is usable on a phone

The global header SHALL remain fully operable on phone-class viewports. Below the `sm` breakpoint
the primary nav links (My Games, Live Runs, Gallery, Wallet when payments are enabled, Settings)
SHALL collapse into a togglable menu (hamburger button opening a drawer/sheet), and the header row
SHALL NOT overflow horizontally. The logo, theme toggle, and sign-out control SHALL remain reachable
at all viewport widths. The Builder route keeps its own compact header and is out of scope for this
requirement.

#### Scenario: Nav collapses on a narrow viewport
- **WHEN** the console is viewed at 375px wide on a non-Builder route
- **THEN** the inline nav links are hidden and a hamburger/menu control is shown, and the header
  content fits within the viewport with no horizontal scroll

#### Scenario: Drawer navigation works
- **WHEN** the user taps the hamburger control and selects a destination
- **THEN** the corresponding route loads and the drawer closes

#### Scenario: Core controls stay reachable on mobile
- **WHEN** the header is in its collapsed mobile state
- **THEN** the theme toggle and sign-out remain accessible

#### Scenario: Full nav on desktop is unchanged
- **WHEN** the console is viewed at 1280px wide
- **THEN** the inline nav links render as before and no hamburger is shown

#### Scenario: Menu controls carry translated accessible labels
- **WHEN** the hamburger and drawer render
- **THEN** their labels/aria-labels come from `t.*` (no hardcoded strings) and pass
  `npm run i18n:check`

### Requirement: Live-ops surfaces reflow on a phone

The live-ops surfaces SHALL be fully operable on phone-class viewports. This covers the Run Console
(`RunConsolePage`) and the Live Runs overview (`RunsOverviewPage`). Multi-column grids SHALL collapse
to a single column, wide content such as the scoreboard table, maps, and heatmap SHALL either reflow
or scroll within its own container without forcing the page body to scroll horizontally, and fixed
`min-w`/`max-w` panels SHALL NOT clip or overflow the viewport at 360 to 430px. Chat and announcement
bubbles SHALL wrap within the screen width.

#### Scenario: Run Console has no horizontal page overflow on mobile
- **WHEN** the Run Console is viewed at 390px wide with active teams, the live map, and the chat panel
- **THEN** the page body does not scroll horizontally; multi-column sections stack to one column

#### Scenario: Scoreboard stays readable via contained scroll
- **WHEN** the scoreboard table is wider than the viewport
- **THEN** it scrolls horizontally inside its own `overflow-x-auto` container while the surrounding
  layout stays put

#### Scenario: Live Runs list reflows
- **WHEN** the Live Runs overview (currently unstyled for mobile) is viewed at 375px
- **THEN** each run entry reflows to fit the width with no clipped or overflowing content

#### Scenario: Live map and heatmap fit the width
- **WHEN** the live team map or movement heatmap renders on a phone
- **THEN** it fits the column width and its fixed height does not break the surrounding layout

### Requirement: Console pages reflow on a phone

The Dashboard, Gallery, and Wallet pages SHALL render without clipped or overflowing content on
phone-class viewports (360–430px). Existing breakpoint grids SHALL collapse to a comfortable
column count on narrow screens.

#### Scenario: Dashboard fits a phone
- **WHEN** the Dashboard is viewed at 390px
- **THEN** its stat tiles and game cards reflow to fit with no horizontal overflow

#### Scenario: Gallery and Wallet fit a phone
- **WHEN** the Gallery or Wallet page is viewed at 375px
- **THEN** cards/rows reflow to a single readable column with no clipped controls
  (Wallet only applies while payments are enabled)

### Requirement: Builder is workable on touch and narrow viewports

The Builder's 3-pane drag-and-drop workspace SHALL be operable on touch devices and narrow
viewports. Stage/task reordering SHALL work by finger via a touch-capable drag sensor (or a
pointer-activation configuration proven to work on touch) without the drag gesture hijacking
normal scrolling. The stage rail SHALL adapt to narrow width rather than pushing the canvas
off-screen, and the editor panel SHALL continue to present as a full-height sheet below the `lg`
breakpoint (the existing `SlidePanel` behavior).

#### Scenario: Drag-reorder works by touch
- **WHEN** a user on a touch device long-presses a stage or task and drags it to a new position
- **THEN** the item reorders and the page does not scroll during the drag gesture

#### Scenario: Touch drag does not block scrolling
- **WHEN** a user swipes to scroll (without the drag activation delay elapsing on a handle)
- **THEN** the workspace scrolls normally instead of starting a drag

#### Scenario: Stage rail adapts on a narrow screen
- **WHEN** the Builder is viewed at a narrow width
- **THEN** the stage rail collapses/adapts so the task canvas remains usable rather than being
  pushed off-screen

#### Scenario: Editor panel is a full-height sheet on mobile
- **WHEN** the task or stage editor opens below the `lg` breakpoint
- **THEN** it presents as a full-height sheet over the workspace (existing `SlidePanel` behavior),
  not a clipped inline pane

### Requirement: No regression to desktop, i18n, or backend surfaces

The responsive work SHALL be confined to `apps/creator-web` presentation. It SHALL NOT add or
change any callable, shared type, Firestore path, or security rule, and SHALL NOT alter desktop
layout at or above the `lg` breakpoint. All new UI text SHALL route through `t.*` and keep
`npm run i18n:check` green.

#### Scenario: Desktop layout unchanged
- **WHEN** any touched page is viewed at 1280px wide
- **THEN** its layout matches the pre-change desktop layout

#### Scenario: No backend or shared-contract change
- **WHEN** the change is reviewed
- **THEN** no files under `functions/`, `packages/shared/`, or `firestore.rules` are modified

#### Scenario: i18n stays clean
- **WHEN** `npm run i18n:check` runs after the change
- **THEN** it passes with no new PART A errors and no new PART B findings from the added UI
