## 1. Shared type
- [x] 1.1 `LiveRunSummary` in `packages/shared/src/types/index.ts`.

## 2. functions callable
- [x] 2.1 `listLiveRuns` in `runs/index.ts` — owner-scoped `collectionGroup('runs')` filtered
  to `ownerUid` + `status == 'live'`; per row: gameTitle (game doc), accessCode,
  participantCount (run doc), launchedAt, unackedAlerts (count aggregate). Re-export in
  `functions/src/index.ts`.
- [x] 2.2 Composite index (`ownerUid` + `status`, COLLECTION_GROUP) in `firestore.indexes.json`.

## 3. creator-web
- [x] 3.1 `listLiveRuns` wrapper in `services/calls.ts`.
- [x] 3.2 `RunsOverviewPage.tsx` — cards with participant count + unacked-alert badge, deep
  link into `/run/:gameId/:runId`; polls every 10s.
- [x] 3.3 `/live` route + `nav.liveRuns` entry in `App.tsx`.
- [x] 3.4 i18n `nav.liveRuns` + `liveRuns.*` namespace EN + HE.

## 4. Tests / gates
- [x] 4.1 e2e scenario: two launched runs both listed; a finalized run drops out; a stranger
  sees none of the owner's runs (uid isolation). (Also satisfies the callable-coverage guard.)
- [x] 4.2 typecheck · i18n:check · no-dashes · lint · builds — all green.
- [ ] 4.3 `npm run e2e` in the consolidated emulator run (batch gate).
