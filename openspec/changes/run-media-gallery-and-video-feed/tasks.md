## 1. Feed accepts video (backend) — RED

- [x] 1.1 In `scripts/e2e-verify.mjs`, add failing assertions for the video-submission-task
  lifecycle scenario: (a) an autoApproved video submission produces a `feedItems` doc with
  `mediaKind: 'video'`; (b) a staff-approved (via `reviewStationSubmission`) pending video
  submission produces a `feedItems` doc with `mediaKind: 'video'`; (c) an audio submission
  produces NO feed item; (d) a hidden-location video submission produces NO feed item. Run
  `npm run e2e` and confirm these new assertions fail for the right reason (no `mediaKind` field /
  feed item never written for video).

## 2. Feed accepts video (backend) — GREEN

- [x] 2.1 Add `mediaKind?: MediaKind` to `FeedItem` in `packages/shared/src/types/index.ts`
  (optional, backward compatible — absent means legacy photo).
- [x] 2.2 In `functions/src/index.ts`, extend `writeFeedItem`'s `entry` param with an optional
  `mediaKind?: MediaKind` and write it onto the created `FeedItem` when provided.
- [x] 2.3 In `submitStationPhoto`'s autoApprove branch, change the feed gate from
  `kind === 'photo'` to `kind === 'photo' || kind === 'video'`, passing `mediaKind: kind` into
  `writeFeedItem`'s entry. Audio (`kind === 'audio'`) stays excluded — do not touch that path.
- [x] 2.4 In `reviewStationSubmission`'s approve branch, change `submissionKind === 'photo'` to
  `submissionKind === 'photo' || submissionKind === 'video'`, passing `mediaKind: submissionKind`
  into `writeFeedItem`'s entry.
- [x] 2.5 Run `npm run e2e` again and confirm the assertions from Task 1.1 now pass. Run `npm test`
  to confirm no regression in existing vitest/pure-logic suites (`photoQueue`, `ceremony`, etc.
  that touch `FeedItem`).

## 3. Feed renderers display video — REFACTOR/UI

- [x] 3.1 In `apps/play-web/src/components/FeedPanel.tsx`, replace the unconditional
  `<img src={item.photoUrl}>` with a branch on `item.mediaKind === 'video'` rendering a
  `<video controls playsInline preload="metadata" src={item.photoUrl}>` (matching the existing
  pattern in `RunConsolePage.tsx`'s `PhotoReviewConsole.Media()`), falling back to `<img>` otherwise.
- [x] 3.2 In `apps/creator-web/src/pages/RunConsolePage.tsx`, add `mediaKind` to the `FeedItemRow`
  type and the feed listener's mapped fields, then update `FeedConsole` to render the same
  `<video>`/`<img>` branch.
- [x] 3.3 Verify via the preview tools: submit a video task submission against the emulator (or
  seed one), open both play-web's live feed and creator-web's Run Console feed panel, and confirm
  the video renders and plays instead of a broken image.

## 4. Run media gallery — pure flatten logic (RED)

- [x] 4.1 Add `scripts/test-run-media-gallery.ts` exercising a new pure function
  `buildRunMediaGallery(teams)` (to live in `apps/creator-web/src/lib/runMediaGallery.ts`):
  covers (a) an approved/autoApproved submission is included, (b) a pending submission is
  included, (c) a rejected submission is still included, (d) a submission with no/invalid
  `photoUrl` is omitted, (e) `mediaKind` passes through so callers can branch `<img>`/`<video>`,
  (f) result is stable/sorted (e.g. newest `submittedAt` first) and total for malformed input
  (never throws). Run `npm test` and confirm this file fails (function doesn't exist yet).

## 5. Run media gallery — pure flatten logic (GREEN)

- [x] 5.1 Implement `apps/creator-web/src/lib/runMediaGallery.ts` exporting
  `buildRunMediaGallery(teams)`, reusing `isRenderableMedia` (already used by
  `PhotoReviewConsole.Media`) to filter, mirroring the flatten shape `PhotoReviewConsole` already
  builds for its own queue so the two never diverge on what counts as "this team's media."
- [x] 5.2 Run `npm test` and confirm `test-run-media-gallery.ts` passes.

## 6. Run media gallery — Run Console panel (UI)

- [x] 6.1 Add a `'mediaGallery'` entry to the `PanelId` union in
  `apps/creator-web/src/lib/runConsoleLayout.ts` and its copy (icon/hasHelp/hasEmpty) in
  `apps/creator-web/src/lib/runConsolePanelMeta.ts`, per the existing per-panel contract.
- [x] 6.2 Add a `RunMediaGallery` component in `RunConsolePage.tsx` (or a new file if it grows)
  that calls `buildRunMediaGallery(teams)` and renders each row as a card: `<video>` when
  `mediaKind === 'video'`, `<img>` otherwise, with the team name, task title, and a status badge
  (pending/approved/rejected) so the manager can tell what's already been reviewed without this
  panel replacing `PhotoReviewConsole`.
- [x] 6.3 Add a "download all" action: iterate the gallery rows and, for each, create a temporary
  `<a download href={row.photoUrl}>` and click it, with a small delay between clicks (see design.md
  decision 3) to avoid the browser treating a burst of downloads as a popup flood. Add a
  per-card download/open link as well.
- [x] 6.4 Wire the new panel into the Run Console's section/plan building (wherever
  `buildRunConsoleSections`/`pinnedPanels` assemble the panel list) so it actually appears.
- [x] 6.5 Add EN/HE strings for the panel's title, help text, empty state, and the download-all
  button to `apps/creator-web/src/i18n.ts`.

## 7. Final verification

- [x] 7.1 Run the full gate set: `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run creator:build`, `npm run play:build`, `npm run bundle:budget`, `npm run base:check`,
  `npm run origin:check`, `npm run i18n:check:strict` (i.e. `npm run verify`), and `npm run e2e`.
  Confirm all green.
- [x] 7.2 Manual preview pass: run the emulator stack, play through a game with a photo task and a
  video task (one auto-approved, one manually approved via the review queue), and confirm in the
  Run Console: (a) the new media gallery shows both items regardless of review status, (b)
  "download all" downloads both files, (c) the live feed (both play-web and creator-web) shows the
  video item as a playable video.
