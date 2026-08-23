# Design — dashboard-card-actions-overflow

## 1. Current code, audited

`DashboardPage.tsx` game card:

- Live banner "Open run" button (`:463-471`) — stays as is, above the actions.
- Primary row (`:473-488`): Edit (`nav('/build/'+g.id)`) and Launch (`launchAction.run(g)`).
- Secondary `flex-wrap` row (`:490-519`), each `min-w-[calc(50%-0.25rem)]`:
  - Test run (`:491`) ⇒ `launchAction.run(g, { testDrive: true })`
  - Publish/Unpublish (`:499`) ⇒ `publishAction.run(g)`, label from `g.visibility === 'public'`
  - Share (`:506`) ⇒ `setSharing(g)`
  - Delete (`:512`) ⇒ `setDeleting(g)` (opens the existing confirm dialog at `:715`)

The Run Console pattern to reuse:

- `teamRowActions(team, attention): { inline: RunActionId[]; overflow: RunActionId[] }`
  (`lib/runConsoleActions.ts:217-237`) — the pure split.
- `OverflowMenu({ label, ariaLabel, children })` (`RunConsolePage.tsx:1199-1230`) — a `Button`
  with `aria-haspopup="menu"` / `aria-expanded`, a click-away scrim, and a `role="menu"` popover
  that closes on item click. It is **local** to that file today (not exported).

## 2. The pure split

Mirroring `teamRowActions`, the card's split is a pure, total function so the "which actions
overflow" decision is unit testable (creator-web has no component test runner, CLAUDE.md):

```ts
// apps/creator-web/src/lib/dashboardCardActions.ts
export type DashboardCardActionId =
  | 'edit' | 'launch' | 'testRun' | 'publish' | 'unpublish' | 'share' | 'delete';

export interface DashboardCardActions {
  inline: DashboardCardActionId[];    // always ['edit', 'launch']
  overflow: DashboardCardActionId[];  // the four secondary, delete last
}

/** Publish vs unpublish resolves from visibility; delete is always last (destructive). */
export function dashboardCardActions(
  game: { visibility?: string } | null | undefined,
): DashboardCardActions;
```

Rules encoded (and tested):

- `inline` is always `['edit', 'launch']`.
- `overflow` is always `['testRun', <publish|unpublish>, 'share', 'delete']` in that order.
- `game.visibility === 'public'` ⇒ the toggle id is `'unpublish'`, else `'publish'`.
- Delete is always the final overflow entry, matching `TEAM_ROW_OVERFLOW`'s "least to most
  destructive" ordering (`runConsoleActions.ts:220`).
- Total: `null`/garbage ⇒ defaults to the `'publish'` variant, never throws.

The component maps each id to its existing handler and its existing `d.card*` label; the helper owns
only the ordering/visibility decision, not the wiring.

## 3. Promote `OverflowMenu` to a shared component

Move the local `OverflowMenu` (`RunConsolePage.tsx:1199-1230`) verbatim into
`apps/creator-web/src/components/OverflowMenu.tsx` and export it. `RunConsolePage.tsx` imports it and
deletes its local copy; its team row usage (`:835-840`) is unchanged. `DashboardPage` imports the
same component for the card.

This is a pure extraction: identical markup, identical props (`label`, `ariaLabel`, `children`),
identical `role="menu"` and click-away semantics. It keeps one menu primitive across the console and
the dashboard, which is the whole reason the finding points at the run console pattern.

Menu items reuse the same shape the console uses for its menu entries (a full width `role="menuitem"`
button per action); Delete gets the destructive text treatment it has today (`text-rp-alert`).

## 4. The card reflow

- Replace the `flex-wrap` secondary row (`:490-519`) with a compact trailing control: the Edit +
  Launch primary row stays, and a single `OverflowMenu` trigger ("⋯", `ariaLabel={d.cardMoreActions}`)
  sits at the end of the primary row (or immediately below it, right aligned via `ms-auto`).
- Inside the menu, render one `role="menuitem"` per `dashboardCardActions(g).overflow` id, each
  bound to its existing handler:
  - `testRun` ⇒ `launchAction.run(g, { testDrive: true })`, label `d.cardTestRun`, `title` `d.cardTestRunHint`
  - `publish`/`unpublish` ⇒ `publishAction.run(g)`, label `d.cardPublish` / `d.cardUnpublish`
  - `share` ⇒ `setSharing(g)`, label `d.cardShare`
  - `delete` ⇒ `setDeleting(g)`, label `d.cardDelete`, destructive styling
- Disabled states carry over unchanged (`busy`, `publishAction.isBusy(g.id)`, `removeAction.isBusy(g.id)`).

## 5. i18n and RTL

- One new key in **both** language maps (`i18n.ts`): `cardMoreActions` as the menu trigger
  `aria-label` (HE "עוד פעולות" / EN "More actions"). All action labels reuse the existing `d.card*`
  keys.
- The shared `OverflowMenu` already uses logical direction (`end-0` popover, `RunConsolePage.tsx:1221`),
  so RTL is inherited. No physical direction classes introduced.
- No hardcoded strings; the trigger has an accessible name via `t.*`. No em dash, no en dash, no
  spaced hyphen in new copy.

## 6. Test strategy

**Lane: pure.** `scripts/test-dashboard-card-actions.ts`, auto discovered by
`scripts/run-unit-tests.mjs`. Assertions:

1. `inline` is exactly `['edit','launch']` for any input.
2. A private game ⇒ overflow `['testRun','publish','share','delete']`.
3. A `visibility:'public'` game ⇒ overflow `['testRun','unpublish','share','delete']`.
4. `delete` is always the last overflow entry.
5. Every one of the six underlying actions appears exactly once across inline + overflow (a coverage
   assertion, so no action can be silently dropped).
6. Totality: `null`, `undefined`, `{}`, `42`, `'x'` never throw and yield a well formed split.
7. Wiring guard (source scan): `i18n.ts` defines `cardMoreActions` in BOTH language maps;
   `components/OverflowMenu.tsx` exists and is imported by both `DashboardPage.tsx` and
   `RunConsolePage.tsx`.

**Lane: UI.** No component test runner, so the remaining gates are `npm run typecheck`,
`npm run lint`, `npm run creator:build`, and `npm run i18n:check:strict` (clean, zero new PART B),
plus a preview check: Dashboard ▸ a game card shows Edit + Launch + a "⋯" menu; opening the menu
lists Test run, Publish/Unpublish, Share, Delete; Delete still opens its confirm dialog; the Run
Console team row menu still works after the extraction.

**Lane: e2e.** Nothing to add. No callable, no `Task` field.

## 7. Non decisions worth recording

- **Launch stays a full button, not a menu item.** Launch is the card's primary verb; burying it
  would defeat the point. Only the four secondary actions move.
- **No split-button.** A "⋯" menu is the pattern already in the product (run console); introducing a
  split-button here would be a second, inconsistent affordance.
- **`lib/runConsoleLayout.ts` untouched.** The extraction only moves a presentational menu shell; the
  console's layout data and `teamRowActions` are not modified.
