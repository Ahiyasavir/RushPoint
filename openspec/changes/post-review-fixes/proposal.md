# Post review fixes (A to F)

## Why

A review pass over the current working diff found six independent defects and deliberately left
them in place so they could be fixed properly, test first. Each is small; each is a real behaviour
bug or a piece of dead weight that a test is currently propping up.

**A. The guided tour's "established creator" check is not per account.**
`CreatorTour.tsx` reads the GLOBAL `rp-known-game-count` key, while the "has seen the tour" record
beside it is correctly keyed per uid (`tourStorageKey`). A second creator signing in on a browser
that already holds someone else's game count is judged established and NEVER sees the guided tour,
which is the exact population the tour exists for. The comment claims the signal is the creator's,
so code and comment disagree.

**B. The share cards warn about publishing a board that is already published.**
`buildShareArtifacts` computes `publishesOnShare: requiresPublish && !finished` and never consults
whether the standings are already published. On a live run whose host published an hour ago, the
board, ceremony and TV cards permanently claim that copying the link will publish the standings to
players. It is false, and a warning that cries wolf costs the three cases where it is true.

**C. `teamRowActions(team, _attention)` ignores the attention verdict it is handed.**
The Run Console builds a real verdict and passes it; the function drops it. The whole point of the
progressive disclosure change was that urgent things must not be buried, so a flagged team should
surface its remedial control on the row rather than behind the overflow menu.

**D. The survey panel reports an analytics error.**
`SurveyResultsPanel`'s load error branch renders `t.runConsole.analyticsError`, a string that names
the wrong panel.

**E. `gallery.detailOpen` is a dead key.** It is defined in both dictionaries and referenced by
nothing except a test that asserts the KEY exists. The mission card that opens the detail is a
fully pressable `role="button"` div with no visible cue that pressing it does anything.

**F. `skipTaskForTeam` writes its audit record after the transaction has committed, not
best effort.** A failed audit write surfaces to the operator as "skip failed" for a skip that
actually succeeded, and their retry is then refused with `That mission is already completed or
skipped`. `auditBestEffort` exists for exactly this shape. `adjustTeamScore` and `setRunTaskStatus`
have the identical flaw, and `adjustTeamScore` is the precedent this code cites.

## What Changes

- **A** — `knownGameCountKey(uid)` (per uid, mirroring `tourStorageKey`) plus the pure predicate
  `isEstablishedCreator(raw)`. `CreatorTour` and `DashboardPage` read and write the per uid key;
  the legacy global key is cleaned up on write. `scripts/test-creator-tour.ts` covers two creators
  on one browser.
- **B** — `ShareArtifactInput.published?: boolean`; `publishesOnShare` becomes
  `requiresPublish && !finished && !published`. `RunConsolePage` threads the flag it already
  renders the publish toggle from. Absent means "not published", so the warning fails LOUD.
- **C** — `teamRowActions` surfaces `skipTask` inline for a `stuck` team; the safety release still
  wins the single inline slot, nothing destructive is ever inline, and every control still appears
  in exactly one list.
- **D** — new `runConsole.surveyError` key in both dictionaries, used by the survey panel.
- **E** — `gallery.detailOpen` is wired into the gallery mission card as the visible "View details"
  affordance, and the test asserts USE, not mere existence.
- **F** — every call site outside `obs/audit.ts` uses `auditBestEffort`. The record is still
  written; it just cannot fail an action that already committed. A new structural rule in
  `scripts/lib/callableHardening.mjs` pins it so the next call site cannot regress.

## Impact

- `apps/creator-web/src/lib/creatorOnboarding.ts`, `components/CreatorTour.tsx`,
  `pages/DashboardPage.tsx`, `lib/runShareArtifacts.ts`, `lib/runConsoleActions.ts`,
  `pages/RunConsolePage.tsx`, `pages/GalleryPage.tsx`, `i18n.ts`
- `functions/src/runs/index.ts`, `functions/src/index.ts`
- `scripts/test-creator-tour.ts`, `scripts/test-gallery-task-detail.ts`,
  `scripts/test-callable-hardening.ts`, `scripts/lib/callableHardening.mjs`,
  `apps/creator-web/src/lib/__tests__/runConsole.test.ts`
- No Firestore schema change, no callable signature change, no scoring change.
