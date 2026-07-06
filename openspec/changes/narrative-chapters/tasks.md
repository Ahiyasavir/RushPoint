## 1. Shared helpers — RED then GREEN (pure)
- [x] 1.1 RED: `scripts/test-narrative.ts` — `localizedBeatBody` (he→bodyHe w/ fallback,
  en→body), `beatHasContent`, `resolveStageNarrative` (active→intro, completed→outro,
  locked→null). Confirm fail.
- [x] 1.2 GREEN: `packages/shared/src/narrative.ts` + `StoryBeat` type + `Stage.narrative`;
  export from `@rushpoint/shared`. `npm test` → 17 pass.

## 2. functions passthrough
- [x] 2.1 `getMyTeamState` returns `stageNarratives` for reached (active/completed) stages
  only (no spoilers); image URLs https-guarded.

## 3. creator-web authoring
- [x] 3.1 Builder stage editor `StageStory` collapsible (intro title + EN/HE body, outro
  EN/HE body); rides in `stages` → persists via existing `updateGame`.
- [x] 3.2 i18n keys (`storyTitle`, `storyHint`, `storyIntro*`, `storyOutro*`) EN + HE.

## 4. play-web
- [x] 4.1 `StoryInterstitial` overlay in `PlayScreen` — outro of latest completed stage
  first, then active-stage intro; dismissal is localStorage per run+stage+kind.
- [x] 4.2 `MyTeamState.stageNarratives` type + `chapterLabel`/`storyContinue` i18n EN + HE.

## 5. Tests / gates
- [x] 5.1 e2e scenario: `getMyTeamState` echoes the active stage's intro, bilingual body,
  strips a non-https image, exposes only reached stages.
- [x] 5.2 typecheck · i18n:check · no-dashes · lint · builds — all green.
- [ ] 5.3 `npm run e2e` in the consolidated emulator run (batch gate).
