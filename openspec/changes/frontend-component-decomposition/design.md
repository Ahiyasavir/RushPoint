## Context

Four creator-web files have grown past the point where a reader can hold the whole file in their
head, and each fuses concerns that could stand alone. Grounded line counts and internal structure
(verified against the current tree):

- **`src/pages/RunConsolePage.tsx` — 1217 lines.** The default export `RunConsolePage` (lines
  30–318) is the live-run orchestration root. Below it, in the same file, sit ~14 sub-components:
  `JoinShare` (320), `StationQrPrint` (362), `Broadcast` (432), `HotZonePanel` (492),
  `PostRunLinks` (543), `TrackablesConsole` (584), `ZonesConsole` (637), `FeedConsole` (697),
  `ChatConsole` (752), `HeatmapPanel` (857), `AnalyticsPanel` (887), `FeedbackPanel` (982),
  `Distribution` (1133), `SurveyResultsPanel` (1156), plus helpers `TYPE_EMOJI`, `fmtMs`,
  `FIVE_DIMS`. 107 hook/`onSnapshot`/`setInterval` occurrences across the file.
- **`src/pages/BuilderPage.tsx` — 850 lines.** `BuilderPage` (107–339) owns the entire draft
  lifecycle: `useHistory<Game>` (undo/redo), `game`/`setGame`/`patch`, a debounced autosave
  (`save` callback + `saveTimer`/`gameRef`/`savedSnapshot` refs + autosave effect, `AUTOSAVE_DELAY`
  = 1500ms), a `beforeunload` dirty-guard effect, a keyboard undo/redo effect, and `tab`,
  `activeStageId`, `status`, `error`, `loadKey` state. In-file sub-units: `MapSkeleton`,
  `blankStage`, `buildSavePayload`, `serializeGame`, `EditableTitle`, `StepDetails`,
  `WebhookField`, `StageStory`, `RegFields`, `AddTile`, `StepStages`, `ContextPanel`,
  `StepPreview`.
- **`src/components/TaskWizard.tsx` — 1002 lines.** The default export `TaskWizard` (39) is a
  3-step shell (`step === 1|2|3`) delegating to `LocationStepBody` (122), `DetailsStepBody` (371),
  `InteractionStepBody` (776). Nested editors: `QuizModeSection` (199), `OrderingItemsEditor`
  (238), `SurveyChoicesSection` (306), `UnlockSection` (470), `MediaSection` (537), `StepsEditor`
  (982), plus `InlineLabel`, `DIFF_BANDS`, `TYPE_ANIM`. A shared `B` translations type and a
  `set`/`setSmart` patch convention thread through every body.
- **`src/pages/LegalPage.tsx` — 992 lines.** A `SECTIONS` constant (line 11) holds four large
  template-literal bodies — `privacy.he`, `privacy.en`, `terms.he`, `terms.en` — of markdown-ish
  legal prose (~270 content literals). `renderMarkdown` (867) turns a body string into JSX;
  `renderInline` is already imported from `./legalMarkdown`. The `LegalPage` component (932) is
  small — it's the inlined prose that bloats the file.

The data-layer inconsistency is concrete: `RunConsolePage` reads the run doc and alerts via
`onSnapshot` (lines 42–63) but the teams table via `setInterval(() => void loadTeams(), 5000)`
(lines 65–75), where `loadTeams` calls the `listRunTeams` callable and `setTeams`.

## Goals / Non-Goals

**Goals:**
- Reduce each god-component to a thin composition root/shell whose body fits in one screen of
  reading, with each cohesive unit in its own co-located file.
- Extract Builder's draft/autosave/history/CRUD state into a reusable, independently-readable
  `useGameDraft` hook, so the view layer stops owning persistence mechanics.
- Get the bilingual legal prose out of the `.tsx` render module and into data, rendered from data.
- Make `RunConsolePage` use a single, stated live-data paradigm.
- Preserve behavior exactly: identical rendering, identical interactions, identical network calls.

**Non-Goals:**
- No behavior/layout/copy/style change, no new features, no callable/schema/rule/shared-type
  change (see proposal Non-goals).
- No play-web decomposition in this change.
- No change to the `useHistory` hook, `renderInline`, or the react-router wiring — reuse as-is.

## Decisions

### 1. `RunConsolePage` → `pages/RunConsole/` folder, page is the composition root
Create `apps/creator-web/src/pages/RunConsole/` and move each inlined sub-component to its own
file, one export per file, names unchanged:

```
pages/RunConsole/
  JoinShare.tsx
  StationQrPrint.tsx
  Broadcast.tsx
  HotZonePanel.tsx
  PostRunLinks.tsx
  TrackablesConsole.tsx
  ZonesConsole.tsx
  FeedConsole.tsx
  ChatConsole.tsx
  HeatmapPanel.tsx
  AnalyticsPanel.tsx
  FeedbackPanel.tsx
  SurveyResultsPanel.tsx
  shared.ts            // TYPE_EMOJI, fmtMs, FIVE_DIMS, Distribution, small shared types
  index.ts            // optional barrel re-export for the panels
```
`pages/RunConsolePage.tsx` keeps its path and default export (react-router imports it by that
path — do not move the route entry) and becomes the orchestration root only: the run/alerts
listeners, the teams data source (Decision 5), action handlers (`startAll`, `finalize`, `invite`,
`refreshStandings`, `ack`, `ensureBoardPublished`), and the JSX layout that composes the imported
panels. Panels receive the same props they receive today (`ctx`, `teams`, `hotZone`, `accessCode`,
`gameId`, `runId`), so no prop contract changes.

Alternative considered: leave the sub-components in-file but reorder. Rejected — doesn't reduce the
file or let a reviewer open one panel in isolation.

### 2. `BuilderPage` → `useGameDraft` hook + co-located step panels
Extract the draft state machine into `apps/creator-web/src/pages/Builder/useGameDraft.ts` (or
`src/hooks/useGameDraft.ts`):

```ts
function useGameDraft(gameId: string | undefined): {
  game: Game | null;
  patch: (p: Partial<Game>) => void;
  setGame: (g: Game) => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
  status: SaveStatus; error: string | null;
  save: () => Promise<boolean>;
  reload: () => void;                 // wraps the loadKey bump
}
```
The hook owns `useHistory<Game>`, the load effect (`getGame` → `history.reset`), `serializeGame`
/`buildSavePayload`, the debounced autosave effect + `save` callback + refs, the `beforeunload`
guard, and the keyboard undo/redo effect. `AUTOSAVE_DELAY`, `serializeGame`, `buildSavePayload`,
`blankStage` move to a `Builder/draft.ts` utility module the hook imports. Move the presentational
sub-units into co-located files:

```
pages/Builder/
  useGameDraft.ts
  draft.ts             // serializeGame, buildSavePayload, blankStage, AUTOSAVE_DELAY
  EditableTitle.tsx
  StepDetails.tsx      // + WebhookField, RegFields (its own fields) or split further
  StepStages.tsx       // + AddTile, StageStory
  ContextPanel.tsx
  StepPreview.tsx      // + MapSkeleton
```
`pages/BuilderPage.tsx` keeps its path/route and becomes a shell: call `useGameDraft`, hold only
truly view-local state (`tab`, `activeStageId`), and render the tabs + active step panel. `tab`
and `activeStageId` are view-navigation state, not draft state, so they stay in the component
(keeps the hook focused on the document lifecycle).

Alternative considered: a `useReducer`/context provider for the whole Builder. Rejected as
larger-than-needed for a behavior-preserving pass; a single custom hook captures the state without
introducing a new context or changing render identity semantics.

### 3. `TaskWizard` → `components/TaskWizard/` folder, per-step files
```
components/TaskWizard/
  index.tsx            // the TaskWizard shell (step routing, header, footer, validation)
  LocationStep.tsx     // LocationStepBody
  DetailsStep.tsx      // DetailsStepBody + UnlockSection + MediaSection
  InteractionStep.tsx  // InteractionStepBody + StepsEditor
  QuizModeSection.tsx
  OrderingItemsEditor.tsx
  SurveyChoicesSection.tsx
  shared.ts            // InlineLabel, DIFF_BANDS, TYPE_ANIM, the `B` type + set/setSmart types
```
Keep `components/TaskWizard.tsx` as a re-export (`export { default } from './TaskWizard/index'`)
so existing importers don't change, OR update the (few) import sites to the folder — the design
prefers the re-export shim to keep the diff import-neutral. The `set`/`setSmart`/`b` prop
convention is preserved verbatim; step files receive exactly today's props.

### 4. Legal copy moves to data; `LegalPage` renders from data
Move the `SECTIONS` object into `apps/creator-web/src/pages/legal/legalContent.ts`:

```ts
// legalContent.ts — no JSX, just typed data
export interface LegalDoc { title: string; updated: string; body: string; }
export const LEGAL: Record<'privacy' | 'terms', Record<'he' | 'en', LegalDoc>> = { ... };
```
`LegalPage.tsx` imports `LEGAL` and keeps `renderMarkdown` + the he/en toggle + layout. The prose
strings are unchanged character-for-character (critical for the legal text and for i18n — see Test
Strategy). Optionally the four bodies can live as `*.md` assets imported as raw strings, but a
typed `.ts` data module is the lower-risk first cut (no Vite `?raw` import wiring, no build-config
change). `renderMarkdown` may also move next to the data as `legal/renderMarkdown.tsx` if that
leaves `LegalPage` thinner; `renderInline` in `pages/legalMarkdown.ts` is reused unchanged.

**i18n note:** the legal bodies are deliberate bilingual literals with the page's own `he`/`en`
toggle — they are NOT routed through `t.*` today, and this change must not alter that. Moving them
verbatim into a data module keeps whatever `i18n:check` classification they already have; the
requirement is zero *new* findings, not re-routing legal prose through the app dictionaries.

### 5. `RunConsolePage` converges on a listener for teams
Replace the 5s poll with an `onSnapshot` on the run's `teams` subcollection. The run owner can read
`users/{ownerUid}/games/{gameId}/runs/{runId}/teams` directly under `firestore.rules`, so a
listener is available. Shape each doc client-side into the existing `RunTeamRow` type (the same
fields `listRunTeams` returns), sorted as today, into the same `teams` state. This makes all three
of the screen's live sources (`run`, `alerts`, `teams`) push-based and removes the `setInterval`.

Guard/fallback: if `listRunTeams` performs server-side shaping a client read cannot reproduce
(e.g. joins or derived fields not present on the raw team docs), keep the `loadTeams` poll but
(a) reduce it to a single documented paradigm decision and (b) add an inline comment stating why a
listener is not used. The behavior-preserving requirement dominates: verify the teams table shows
identical rows either way before removing the poll. Decision recorded in tasks; the spec invariant
is "one screen states one paradigm," satisfiable by either the listener (preferred) or the
documented poll.

Alternative considered: leave the poll silently. Rejected — the mixed-paradigm smell is exactly
what the review flagged; even keeping the poll must come with a stated justification.

## Test Strategy

There is no component test runner in creator-web (per `openspec/config.yaml`), so the safety net
is builds + preview-tool render/behavior parity + the i18n gate. Every decomposition step is
proven the same way:

- **Compile/build parity (hard gate):** `npm run typecheck`, `npm run lint`, `npm run creator:build`,
  and `npm run play:build` must stay green after each extraction. A missed export, a broken import
  path, or a dropped prop fails the build — this is the primary mechanical proof that a
  behavior-preserving move is complete.
- **Preview-tool render/behavior parity, per screen** (drive the real app before/after each
  component's extraction; they must be indistinguishable):
  - *Run Console:* open a live run; confirm every panel still renders and works — JoinShare/QR,
    HotZone activate/deactivate, Broadcast, Trackables, Zones, Feed, Chat, Heatmap, Analytics,
    Feedback, Survey results; confirm alerts still appear live and the teams table still updates
    (poll→listener: confirm a team joining/finishing reflects without a manual refresh).
  - *Builder:* confirm autosave (edit → "unsaved" → "saved"), undo/redo (Ctrl+Z / Ctrl+Shift+Z),
    the `beforeunload` dirty-guard, tab switching, stage/task CRUD, and the Preview map all behave
    exactly as before the `useGameDraft` extraction.
  - *TaskWizard:* step through location → details → interaction for each task type (quiz, numeric,
    sequence, survey, smart_station, photo, etc.), confirming per-type editors are unchanged.
  - *Legal:* load Privacy and Terms, toggle he/en, confirm the rendered text is byte-identical to
    before (spot-check headings, blockquotes, lists, bold) and RTL/LTR direction is correct.
- **i18n correctness (hard gate):** `npm run i18n:check` MUST stay clean. The LegalPage move is the
  sensitive one — moving ~270 bilingual literals must not drop any string out of its current
  handling or introduce a Hebrew value into an English position (or vice versa). Also run
  `npm run i18n:check:strict` and confirm the refactor adds **zero** new PART B hardcoded-string
  findings (moved code carries its existing classification; new findings would mean a string got
  rehoused incorrectly).
- **Full gate set (final task):** `npm run typecheck · lint · test · creator:build · play:build ·
  e2e · i18n:check` all green. `npm test` and `npm run e2e` are not expected to change behavior
  (no functions/shared touched) but must remain green to prove no accidental cross-package edit.

## Risks / Trade-offs

- **[Risk] A dropped prop or subtly changed default during extraction silently changes behavior.**
  → Mitigation: move code verbatim (no "while I'm here" edits), keep prop contracts identical, and
  rely on typecheck + per-screen preview parity to catch drift. Each component is its own task so a
  regression is bisectable.
- **[Risk] The poll→listener swap changes teams-table contents or timing.** → Mitigation: verify
  row-for-row parity in preview before deleting the poll; if the listener can't reproduce
  `listRunTeams` shaping, keep the documented poll (Decision 5) rather than ship a behavior change.
- **[Risk] Moving legal prose corrupts a character (legal text is load-bearing) or trips i18n.** →
  Mitigation: move the `SECTIONS` object wholesale with no reflow; diff the rendered output; gate
  on `i18n:check` + `i18n:check:strict`.
- **[Trade-off] Re-export shims (`TaskWizard.tsx` → folder) add one indirection.** Accepted — keeps
  the import churn (and thus the diff/blast radius) minimal for a no-behavior-change PR.
- **[Trade-off] Legal prose as a typed `.ts` module rather than `.md` assets.** Accepted for this
  pass — avoids Vite raw-import/build wiring; a later change can migrate to `.md` if desired.

## Migration Plan

Pure code-organization change within creator-web; no data migration, no schema, no rollback beyond
`git revert`. Land per component (Run Console, Builder, TaskWizard, Legal) so each is independently
reviewable and revertible, gating builds + preview + i18n after each. Route entry paths
(`RunConsolePage.tsx`, `BuilderPage.tsx`) and public import paths are preserved (via keeping the
file path or a re-export shim), so no router or importer changes ship with this change.

## Open Questions

- Should the legal bodies ultimately live as `.md` files (imported `?raw`) for editability, or is
  the typed `.ts` data module the permanent home? (Deferred — `.ts` first; revisit if
  non-engineers need to edit the prose.)
- Should `useGameDraft` also absorb `tab`/`activeStageId`, or do those stay view-local in
  `BuilderPage`? (Design keeps them view-local; revisit if a second consumer of the draft appears.)
- Do we update `TaskWizard` import sites to the folder path, or keep the re-export shim
  permanently? (Design keeps the shim for a minimal diff; a follow-up can inline the paths.)
