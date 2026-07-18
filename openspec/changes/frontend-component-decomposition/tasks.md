> Each component is decomposed in its own group, in behavior-preserving order:
> extract verbatim → verify builds + preview parity → confirm i18n clean. Because creator-web has
> no component test runner, the "green" signal for every step is: `npm run creator:build` +
> `npm run play:build` compile, the screen renders/behaves identically in the preview tools, and
> `npm run i18n:check` stays clean. Move code verbatim — no behavior, copy, or style edits.

## 1. RunConsolePage → `pages/RunConsole/` folder

- [ ] 1.1 Create `apps/creator-web/src/pages/RunConsole/` and move each inlined sub-component to
      its own file (one export per file, names unchanged): `JoinShare`, `StationQrPrint`,
      `Broadcast`, `HotZonePanel`, `PostRunLinks`, `TrackablesConsole`, `ZonesConsole`,
      `FeedConsole`, `ChatConsole`, `HeatmapPanel`, `AnalyticsPanel`, `FeedbackPanel`,
      `SurveyResultsPanel`. Move shared helpers `TYPE_EMOJI`, `fmtMs`, `FIVE_DIMS`, and the
      `Distribution` sub-component into `pages/RunConsole/shared.ts(x)`. Add imports back into
      `RunConsolePage.tsx`. Keep `pages/RunConsolePage.tsx` at its current path (react-router
      imports it there) as the composition root: the run/alerts listeners, teams source, action
      handlers, and the JSX layout only. Preserve every panel's prop contract exactly.
- [ ] 1.2 Verify: `npm run typecheck`, `npm run creator:build`, `npm run play:build` are green.
      In the preview tools, open a live run and confirm every panel renders and works identically
      (JoinShare/QR, HotZone activate/deactivate, Broadcast, Trackables, Zones, Feed, Chat,
      Heatmap, Analytics, Feedback, Survey results) and that live alerts still appear.
- [ ] 1.3 Run `npm run i18n:check` and `npm run i18n:check:strict`; confirm zero new findings.

## 2. RunConsolePage → single live-data paradigm (poll → listener)

- [ ] 2.1 Replace the `setInterval(() => void loadTeams(), 5000)` teams poll (current lines
      ~65–75) with an `onSnapshot` listener on
      `users/{ownerUid}/games/{gameId}/runs/{runId}/teams` (owner-readable per `firestore.rules`),
      shaping each doc client-side into the existing `RunTeamRow` shape and sort order, into the
      same `teams` state. Remove `loadTeams`/`listRunTeams` from the render path IF the listener
      reproduces the table row-for-row. If it cannot (server-side shaping in `listRunTeams` a
      client read can't reproduce), KEEP the poll but add an inline comment stating why a listener
      is not used — one screen, one stated paradigm either way.
- [ ] 2.2 Verify parity in the preview tools: a team joining / finishing reflects in the teams
      table without a manual refresh, and the numbers match the leaderboard panel exactly (same as
      before). Confirm `npm run typecheck`, `npm run creator:build`, `npm run play:build` green.

## 3. BuilderPage → `useGameDraft` hook + co-located panels

- [ ] 3.1 Extract the draft state machine from `BuilderPage` into
      `pages/Builder/useGameDraft.ts`: `useHistory<Game>` (undo/redo), the `getGame` load effect,
      `patch`/`setGame`, the debounced autosave (`save` callback, `saveTimer`/`gameRef`/
      `savedSnapshot` refs, autosave effect), the `beforeunload` dirty-guard effect, and the
      keyboard undo/redo effect. Move `serializeGame`, `buildSavePayload`, `blankStage`, and
      `AUTOSAVE_DELAY` into `pages/Builder/draft.ts`. The hook returns
      `{ game, patch, setGame, undo, redo, canUndo, canRedo, status, error, save, reload }`.
- [ ] 3.2 Move the presentational sub-units into co-located files under `pages/Builder/`:
      `EditableTitle`, `StepDetails` (+ `WebhookField`, `RegFields`), `StepStages`
      (+ `AddTile`, `StageStory`), `ContextPanel`, `StepPreview` (+ `MapSkeleton`). Rewrite
      `pages/BuilderPage.tsx` (keep its path/route) as a thin shell: call `useGameDraft`, hold only
      view-local `tab` and `activeStageId`, and render the tabs + active step panel. Prop contracts
      to the panels unchanged.
- [ ] 3.3 Verify: `npm run typecheck`, `npm run creator:build`, `npm run play:build` green. In the
      preview tools confirm autosave (edit → "unsaved" → "saved"), undo/redo (Ctrl+Z /
      Ctrl+Shift+Z), the `beforeunload` dirty-guard, tab switching, stage/task CRUD, and the
      Preview map all behave exactly as before.
- [ ] 3.4 Run `npm run i18n:check` and `npm run i18n:check:strict`; confirm zero new findings.

## 4. TaskWizard → `components/TaskWizard/` folder

- [ ] 4.1 Create `components/TaskWizard/` and split by step/type: `index.tsx` (the wizard shell:
      step routing, header/footer, validation), `LocationStep.tsx` (`LocationStepBody`),
      `DetailsStep.tsx` (`DetailsStepBody` + `UnlockSection` + `MediaSection`),
      `InteractionStep.tsx` (`InteractionStepBody` + `StepsEditor`), plus `QuizModeSection.tsx`,
      `OrderingItemsEditor.tsx`, `SurveyChoicesSection.tsx`, and `shared.ts` (`InlineLabel`,
      `DIFF_BANDS`, `TYPE_ANIM`, the `B` translations type and the `set`/`setSmart` prop types).
      Replace `components/TaskWizard.tsx` with a re-export shim
      (`export { default } from './TaskWizard/index'`) so importers don't change. Preserve the
      `set`/`setSmart`/`b` prop convention verbatim.
- [ ] 4.2 Verify: `npm run typecheck`, `npm run creator:build`, `npm run play:build` green. In the
      preview tools, step through location → details → interaction for each task type (field,
      quiz, numeric, sequence, survey, smart_station, photo, geofence, self_report), confirming
      every per-type editor is unchanged.
- [ ] 4.3 Run `npm run i18n:check` and `npm run i18n:check:strict`; confirm zero new findings.

## 5. LegalPage → legal copy in data, rendered from data

- [ ] 5.1 Move the `SECTIONS` bilingual bodies verbatim (character-for-character) into
      `pages/legal/legalContent.ts` as a typed `LEGAL` data export (`privacy`/`terms` ×
      `he`/`en`, each `{ title, updated, body }`). Import `LEGAL` into `LegalPage.tsx`; keep
      `renderMarkdown`, the he/en toggle, RTL/LTR direction, and the layout. Reuse
      `pages/legalMarkdown.ts` (`renderInline`) unchanged. Do NOT re-route the legal prose through
      `t.*` — preserve its existing bilingual-literal handling.
- [ ] 5.2 Verify: `npm run typecheck`, `npm run creator:build`, `npm run play:build` green. In the
      preview tools load Privacy and Terms, toggle he/en, and confirm the rendered text is
      byte-identical to before (spot-check headings, blockquotes, lists, bold) with correct
      direction.
- [ ] 5.3 Run `npm run i18n:check` (hard gate) and `npm run i18n:check:strict`; confirm the ~270
      relocated legal literals produce zero new findings and no Hebrew/English position swaps.

## 6. Full gate pass

- [ ] 6.1 Run the full gate set and confirm all green: `npm run typecheck`, `npm run lint`,
      `npm test`, `npm run creator:build`, `npm run play:build`, `npm run e2e`, and
      `npm run i18n:check` (plus `npm run i18n:check:strict` — zero new hardcoded-string findings).
      `npm test`/`npm run e2e` must stay green (no `functions/`/`shared` touched) to prove no
      accidental cross-package edit slipped in.
