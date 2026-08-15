## Why

Game templates (the quick-start options a creator picks when creating a new game — bar mitzvah,
youth group, wedding, etc.) are a static, in-repo TypeScript array
(`apps/creator-web/src/templates.ts`). Changing a template today requires editing code and
redeploying. The admin needs to add, edit, and delete templates without a code change, and wants
to do it the same way any creator authors a game — using the existing Builder — rather than a
bespoke editor.

## What Changes

- `Game` gains five optional fields (`isTemplate`, `templateEmoji`, `templateOrder`,
  `templateGroupKey`, `templateLang`) so a template is just a regular `Game` document flagged for
  the picker, owned by whichever admin authored it.
- Three new callables: `listGameTemplates` (any authenticated user; cross-owner
  `collectionGroup('games')` read, returns a sanitized projection grouped by
  `templateGroupKey` for language variants — never full `stages`/`tasks`), `setGameTemplateFlag`
  (admin-only; promotes/demotes a game to/from template status and links language siblings),
  `createGameFromTemplate` (any authenticated creator; clones a template's stages/tasks into a new
  game under their own uid).
- New pure helper `cloneTemplateStages` that regenerates stage/task ids **and remaps every
  internal reference** (`unlockAfterTaskIds`, `exclusiveGroups[].taskIds`) to the new ids, so
  unlock/exclusive-group graphs survive instantiation. This replaces the current
  `GameTemplate.build()` factories, which only produced fresh ids without any reference graph to
  preserve.
- New Firestore composite index (`games` collection group: `isTemplate` ASC, `templateOrder` ASC)
  backing the `listGameTemplates` query.
- Multilingual templates reuse the existing `translateGame` callable: an admin translates a
  template game into a sibling doc and links it via `templateGroupKey`/`templateLang`;
  `listGameTemplates` groups siblings, and the Dashboard picker resolves
  `currentLang → 'he' → first available` client-side.
- New admin page `/admin/templates` (gated identically to `/admin/users`) where the admin manages
  their own template-flagged games: create, open in the normal Builder to edit stages/tasks, set
  emoji/order, delete (existing soft-delete flow).
- Dashboard's template picker (`DashboardPage.tsx`) switches from the static `TEMPLATES` array to
  `listGameTemplates()` + `createGameFromTemplate()`. **"Blank" remains a hardcoded client-side
  option, always first** — not a real template.
- **BREAKING**: `apps/creator-web/src/templates.ts` is deleted once a one-off backfill script has
  migrated the 11 existing templates into Firestore. `apps/creator-web/src/lib/templateLabels.ts`
  is NOT deleted — it still resolves the hardcoded "Blank" card's copy and holds unrelated helpers
  (`describeGameSettings`, `quickCardTarget`).

### Non-goals
- No change to how a creator's own (non-template) games are created, edited, or scored.
- No new translation infrastructure — multilingual templates ride entirely on the existing
  `translateGame` callable.
- No change to `deleteGame`/`updateGame` semantics — templates use them unmodified.
- The "Blank" starting option does not become admin-editable (confirmed with the user).

## Capabilities

### New Capabilities
- `game-templates`: admin-managed game templates stored as flagged `Game` documents — the
  `listGameTemplates`/`setGameTemplateFlag`/`createGameFromTemplate` callables, the
  `cloneTemplateStages` id-remapping behavior, the multilingual grouping/fallback behavior, and the
  `/admin/templates` management page.

### Modified Capabilities
- None — the Dashboard's template picker is a consumer of the new capability, not a change to an
  existing spec'd capability (no prior spec file covers the static `templates.ts` picker).

## Impact

- **Shared types**: `packages/shared/src/types/index.ts` (`Game` fields).
- **Callables**: new `functions/src/admin/templates.ts`, re-exported from
  `functions/src/admin/index.ts` and `functions/src/index.ts`; new
  `functions/src/lib/cloneTemplateStages.ts`.
- **Firestore**: `firestore.indexes.json` (new composite index); no `firestore.rules` change (all
  template reads/writes go through callables using the Admin SDK).
- **creator-web**: new `AdminTemplatesPage.tsx` + route in `App.tsx`; `DashboardPage.tsx` picker
  rewritten; new wrappers in `services/calls.ts`; deletion of `templates.ts` /
  `templateLabels.ts`.
- **Scripts**: new `scripts/backfill-seed-templates.mjs` (one-off migration); new/rewritten pure
  test scripts; new `scripts/e2e-verify.mjs` scenarios.
- **i18n**: new admin-page chrome strings only (no per-template i18n dictionary entries — template
  content is bilingual via `translateGame` doc pairs, not dictionary keys).
