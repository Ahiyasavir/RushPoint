# Design — builder-settings-grouping

## 1. Current code, audited

`StepDetails` (`apps/creator-web/src/pages/BuilderPage.tsx:639-747`) renders, top to bottom:

1. Mode toggle (`:646-657`) — flat
2. Short description `Input` (`:658-661`) — flat
3. `TagsField` (`:662`) — flat
4. `InstructionsField` / `PresentationField` / `WebhookField` / `SafeZoneField` (`:664-670`) — each a collapsed `Advanced`
5. Instant play checkbox + help (`:672-677`) — flat
6. Photo feed checkbox + help + responsibility line (`:680-687`) — flat
7. Power ups checkbox + help (`:689-695`) — flat
8. Manual reveal checkbox + help (`:701-706`) — flat
9. Scoring `Advanced` (`:708-740`), Registration `Advanced` (`:742-744`)

The four flat checkboxes at items 5 to 8 are the density problem. The `Advanced` primitive already
supports exactly what is needed: `Advanced({ title, children, open, onToggle, dense, meta })`
(`components/ui.tsx:202-224`), where `meta` renders a small trailing node in the header — perfect for
an "N on" badge.

Default semantics of the four fields (verified against the `checked` expressions in the current
JSX), which the badge must honor:

| Field | `checked` expression | Counts as ON when absent |
|---|---|---|
| `allowInstantPlay` | `!!game.allowInstantPlay` | no (default off) |
| `photoFeedEnabled` | `game.photoFeedEnabled !== false` | **yes** (default on) |
| `powerUpsEnabled` | `!!game.powerUpsEnabled` | no (default off) |
| `manualLeaderboardReveal` | `!!game.manualLeaderboardReveal` | no (default off) |

## 2. The one piece of pure logic: the "N on" count

The badge count is the only decision in this change with a non obvious rule (the photo feed default
inversion), and creator-web has **no component test runner** (CLAUDE.md). So the count is extracted
into a pure function and unit tested, exactly the way `teamRowActions` (`lib/runConsoleActions.ts`)
extracts the run console's inline/overflow decision.

```ts
// apps/creator-web/src/lib/gameFeatureToggles.ts
import type { Game } from '@rushpoint/shared';

export interface GameFeatureToggleState {
  allowInstantPlay: boolean;
  photoFeedEnabled: boolean;      // default ON: absent ⇒ true
  powerUpsEnabled: boolean;
  manualLeaderboardReveal: boolean;
}

/** Resolves each toggle to its EFFECTIVE boolean, applying the same defaults the
 *  checkboxes apply, so the badge can never disagree with the controls. Total:
 *  a null/garbage game yields all-false rather than throwing. */
export function gameFeatureToggleState(game: Partial<Game> | null | undefined): GameFeatureToggleState;

/** How many of the four features are on. 0..4. */
export function enabledGameFeatureCount(game: Partial<Game> | null | undefined): number;
```

`enabledGameFeatureCount` is what feeds the `meta` badge. The component still owns the checkbox
markup; the helper owns only the count so the number is provable in a test.

## 3. The reflow

Inside `StepDetails`:

- Add local `const [advFeatures, setAdvFeatures] = useState(false);` alongside the existing
  `advReg` / `advScore` state.
- Wrap items 5 to 8 (the four `label`/`input` pairs and their help paragraphs, verbatim) in one
  `<Advanced title={b.featuresSection} open={advFeatures} onToggle={...}
  meta={<Badge>{b.featuresOnBadge(enabledGameFeatureCount(game))}</Badge>}>`. Ordered with the other
  collapsed sections (after Safe zone, before Scoring), so the collapsed stack is contiguous.
- Move `<TagsField />` down into that collapsed stack (it is itself already a collapsed `Advanced`),
  leaving Mode and Short description as the only flat "Essentials" above the divider.

No checkbox attribute changes. Each `input`'s `checked` and `onChange={(e) => patch({ ... })}` is
copied as is, so what saves and how it saves is byte for byte unchanged.

## 4. i18n and RTL

- New keys under `builder` in **both** language maps (`apps/creator-web/src/i18n.ts`): a section
  title (HE "יכולות משחק" / EN "Game features") and a badge label function
  `featuresOnBadge(n) => ...` (HE "n פעילות" / EN "n on"). All existing help/label keys
  (`instantPlayLabel`, `photoFeedHint`, ...) are reused unchanged.
- The `Advanced` header is already logical direction correct (`text-start`, `ms-auto` chevron,
  `components/ui.tsx:212-217`), so the section inherits RTL for free. No physical direction classes
  are introduced.
- No hardcoded strings; the badge text comes from `t.*`. No em dash, no en dash, no spaced hyphen in
  any new copy.

## 5. Test strategy

**Lane: pure.** `scripts/test-game-feature-toggles.ts`, auto discovered by
`scripts/run-unit-tests.mjs`. Assertions:

1. Empty/`{}` game ⇒ count is 1 (photo feed default on, others off).
2. `photoFeedEnabled: false`, all others absent ⇒ count 0.
3. All four explicitly on ⇒ count 4.
4. Mixed: `allowInstantPlay: true`, `powerUpsEnabled: true`, `photoFeedEnabled: false`,
   `manualLeaderboardReveal` absent ⇒ count 2.
5. `gameFeatureToggleState` resolves each field to the effective boolean per the table above.
6. Totality: `null`, `undefined`, `42`, `'x'`, `[]` never throw and yield count 0.
7. Wiring guard (source scan, the pattern from `scripts/test-held-team-notice.ts`): `i18n.ts`
   defines the new section title and badge keys in BOTH language maps.

**Lane: UI.** No component test runner exists, so beyond the pure test the gates are
`npm run typecheck`, `npm run creator:build`, and `npm run i18n:check:strict` (must stay clean, zero
new PART B findings), plus a preview check: Builder ▸ Settings ▸ the four toggles now sit inside a
collapsed "Game features" section whose badge reads the right count, expand shows all four, each
still toggles and autosaves.

**Lane: e2e.** Nothing to add. No callable, no `Task` field, no `ALLOWED_TASK_KEYS` change.

## 6. Non decisions worth recording

- **No savePayload / `BUILDER_EDITABLE_FIELDS` change.** The fields already save; this is verified
  against `savePayload.ts:50-57`. Touching that list is out of scope and would change what persists.
- **The badge is a count, not a list.** Naming which features are on in the header would re add the
  prose this change removes; the count plus one click to expand is the whole point.
- **Section stays collapsed by default.** An enabled feature is still signalled by the badge, so
  collapsed is safe; opening on load would defeat the density win.
