# Tasks — post-review-fixes

Each defect is independent. RED before GREEN within each letter.

## A. Per uid "established" signal

- [ ] A1. RED: extend `scripts/test-creator-tour.ts` with the two creators one browser case,
      `knownGameCountKey` uid scoping, and `isEstablishedCreator` in both directions.
      `npx tsx scripts/test-creator-tour.ts`
- [ ] A2. GREEN: add `knownGameCountKey(uid)` + `isEstablishedCreator(raw)` to
      `apps/creator-web/src/lib/creatorOnboarding.ts`; read the per uid key in
      `components/CreatorTour.tsx`; write and read it in `pages/DashboardPage.tsx` (including
      `DashboardSkeleton`), removing the legacy global key on write.

## B. `publishesOnShare` consults the publish state

- [ ] B1. RED: add the already published cases to
      `apps/creator-web/src/lib/__tests__/runConsole.test.ts`.
      `npx vitest run src/lib/__tests__/runConsole.test.ts` from `apps/creator-web`
- [ ] B2. GREEN: `published?: boolean` on `ShareArtifactInput`; thread it from `RunConsolePage`.

## C. The attention verdict decides the inline control

- [ ] C1. RED: assert the stuck team promotes `skipTask`, the held team still promotes only the
      safety release, and `ok`/`watch` promote nothing.
- [ ] C2. GREEN: implement in `teamRowActions`; name the parameter.

## D. Survey panel error copy

- [ ] D1. `runConsole.surveyError` in BOTH dictionaries; use it in `SurveyResultsPanel`.
- [ ] D2. `npx tsx scripts/check-i18n.ts --strict` clean.

## E. `gallery.detailOpen` wired

- [ ] E1. RED: `scripts/test-gallery-task-detail.ts` asserts the gallery page USES `gl.detailOpen`.
- [ ] E2. GREEN: render the cue on the gallery mission card.

## F. Best effort audit at every call site

- [ ] F1. RED: `findDirectAuditWrites` fixtures + the C6 tree rule in
      `scripts/test-callable-hardening.ts`. `npx tsx scripts/test-callable-hardening.ts`
- [ ] F2. GREEN: `findDirectAuditWrites` / `AUDIT_WRITER_MODULE` in
      `scripts/lib/callableHardening.mjs`; switch `skipTaskForTeam`, `adjustTeamScore` and
      `setRunTaskStatus` to `auditBestEffort`.

## VERIFY

- [ ] V1. `npx tsc --noEmit -p apps/creator-web/tsconfig.json`
- [ ] V2. `npx eslint` over the touched creator-web files
- [ ] V3. every touched pure suite green; `npx tsx scripts/check-i18n.ts --strict` clean
- [ ] V4. The full gauntlet (`npm run verify`, `npm run verify:emulator`) is the parent's to run:
      a live playtest stack forbids builds and emulator commands from this session.
