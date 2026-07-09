## Why

A senior review of `apps/creator-web` flagged four god-components whose size and internal density
make them hard to read, review, and change safely — all in the creator console surface:

- `src/pages/RunConsolePage.tsx` — **1217 lines**, one file that also inlines ~14 stateful
  sub-components (`JoinShare`, `StationQrPrint`, `Broadcast`, `HotZonePanel`, `PostRunLinks`,
  `TrackablesConsole`, `ZonesConsole`, `FeedConsole`, `ChatConsole`, `HeatmapPanel`,
  `AnalyticsPanel`, `FeedbackPanel`, `Distribution`, `SurveyResultsPanel`) plus the live-run
  orchestration root. To find any one panel you scroll past all the others.
- `src/pages/BuilderPage.tsx` — **850 lines**. The exported `BuilderPage` alone owns the game
  draft through an undo/redo history, a debounced autosave with `beforeunload` guard, refs for
  the latest draft, keyboard undo/redo, tab state, active-stage selection, save status/error, and
  stage/task CRUD — ~29 `useState/useEffect/useRef/useMemo/useCallback` hook calls in one function
  body. It is the real god-component: state and view are fused.
- `src/components/TaskWizard.tsx` — **1002 lines**, a 3-step wizard whose per-task-type step
  bodies (`LocationStepBody`, `DetailsStepBody`, `InteractionStepBody`, plus `QuizModeSection`,
  `OrderingItemsEditor`, `SurveyChoicesSection`, `UnlockSection`, `MediaSection`, `StepsEditor`)
  all live in one file.
- `src/pages/LegalPage.tsx` — **992 lines**. It inlines the entire bilingual Privacy Policy and
  Terms of Service as Hebrew+English template-literal bodies inside a `SECTIONS` constant in the
  `.tsx` file (~270 Hebrew/English content literals). Legal prose sits in the same module as the
  React render logic.

A second, narrower defect: `RunConsolePage` uses **two live-data paradigms on one screen**. The
run doc and the alerts collection are read reactively via `onSnapshot` (lines 42–63), but the
teams table is fetched by **polling** — `setInterval(() => void loadTeams(), 5000)` (lines 65–75)
against the `listRunTeams` callable. One screen should not mix a push listener and a 5s poll
without a stated reason.

## What Changes

This is a **behavior-preserving refactor** of the creator-web surface only. No callable, no
Firestore schema, no shared type, no security rule, and no user-visible behavior changes.

- **Decompose `RunConsolePage.tsx`** into a `RunConsole/` folder: the page becomes a thin
  composition root (`RunConsolePage.tsx` re-exports / renders the layout), and each inlined
  sub-component moves to its own co-located file under `pages/RunConsole/`. Shared helpers
  (`TYPE_EMOJI`, `fmtMs`, `FIVE_DIMS`, `Distribution`) move to a small shared module in that
  folder.
- **Decompose `BuilderPage.tsx`**: extract the game-draft/autosave/history-undo/tab/CRUD state
  into a `useGameDraft` hook, and move the inlined step panels (`StepDetails`, `StepStages`,
  `StepPreview`, `ContextPanel`, `StageStory`, `RegFields`, `WebhookField`, `EditableTitle`,
  `AddTile`) into co-located files, leaving `BuilderPage` as a thin shell that wires the hook to
  the panels.
- **Decompose `TaskWizard.tsx`** into per-step / per-task-type files (a `TaskWizard/` folder), so
  the wizard shell composes step bodies imported from sibling files.
- **Move the legal copy out of JSX**: relocate the `SECTIONS` bilingual bodies into a data module
  (`pages/legal/legalContent.ts`, or per-document markdown assets) and have `LegalPage` render
  from that data via the existing `renderMarkdown`/`renderInline` helpers. The page keeps its
  he/en toggle; only the source location of the prose changes.
- **Converge `RunConsolePage` on one live-data paradigm**: replace the `setInterval` teams poll
  with an `onSnapshot` listener on the run's `teams` subcollection (owner-readable per rules),
  shaping rows client-side to the same `RunTeamRow` shape — OR, if a listener cannot reproduce
  `listRunTeams`'s exact server-side shaping, keep the poll but document the reason inline. The
  design settles this; the invariant is "one screen, one stated paradigm."

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `creator-ui-structure` (new internal-structure capability): captures the maintainability
  invariants this change establishes — creator pages compose focused units under a size ceiling,
  long-form legal copy lives in data rather than JSX, and a single screen uses one live-data
  paradigm. No product behavior is added or changed.

## Impact

- `apps/creator-web/src/pages/RunConsolePage.tsx` → thin root + new `pages/RunConsole/*` files.
- `apps/creator-web/src/pages/BuilderPage.tsx` → thin shell + new `hooks/useGameDraft.ts` (or
  `pages/Builder/useGameDraft.ts`) + co-located step panels.
- `apps/creator-web/src/components/TaskWizard.tsx` → `components/TaskWizard/*` (shell + step files).
- `apps/creator-web/src/pages/LegalPage.tsx` → thin renderer + `pages/legal/legalContent.ts` (or
  markdown) data module; `pages/legalMarkdown.ts` (`renderInline`) is reused unchanged.
- No change to `functions/`, `packages/shared`, `apps/play-web`, `firestore.rules`, or any
  `services/calls.ts` signature.
- Only affected surface: **creator-web**. Verification net: `npm run creator:build` +
  `npm run play:build` stay green, preview-tool render/behavior parity per screen, and
  `npm run i18n:check` stays clean (the LegalPage move must not drop strings out of their
  existing bilingual handling).

## Non-goals

- No behavior, layout, copy, or styling changes — pixels and interactions stay identical.
- No change to any callable, Firestore document shape, security rule, or shared type.
- No new features in Run Console, Builder, TaskWizard, or Legal.
- Not a rewrite of the routing/state libraries (`useHistory`, react-router) — only relocation and
  extraction of existing code.
- Not touching `apps/play-web` god-components (out of scope for this creator-web pass).
- No performance-optimization work beyond what naturally follows from the poll→listener change.
