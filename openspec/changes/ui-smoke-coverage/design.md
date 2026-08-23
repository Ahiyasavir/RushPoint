## Context

The browser lane is `playwright.config.ts` + `e2e-ui/*.spec.ts`, run by `npm run test:ui`
(`playwright test`) and by the `ui` job in `.github/workflows/ci.yml`. Current shape, from reading
the files:

- **Config:** `testDir: './e2e-ui'`, `workers: 1`, two projects — `creator`
  (`testMatch: /creator\.spec\.ts/`, `Desktop Chrome`, baseURL `http://localhost:5180`) and `play`
  (`testMatch: /play.*\.spec\.ts/`, `Pixel 7`, baseURL `http://localhost:5181`). `webServer` boots
  `npm run creator` and `npm run play` with `reuseExistingServer: true`. **Both testMatch patterns
  are substring regexes**, so a new file named `play-legal.spec.ts` / `run-console-rail.creator.spec.ts`
  is picked up with **no config edit** — the same trick `builder-groups.creator.spec.ts` uses.
- **Fixture:** `e2e-ui/fixtures.ts` exports a `test` extended with a `pageErrors` array
  (`page.on('pageerror')`) plus `assertNoCrash(page)`, which asserts the ErrorBoundary copy
  (`Something went wrong` / `משהו השתבש`) has count 0. Console errors are deliberately not failed.
- **No-emulator specs:** `creator.spec.ts`, `play.spec.ts` — pure render smokes.
- **Backend-gated specs, two established gating patterns:**
  - `play-flow.spec.ts`: `test.skip(!process.env.PLAY_CODE, …)` — an env-var gate for a seeded run.
  - `builder-groups.creator.spec.ts` / `photo-review.creator.spec.ts`: an `emulatorUp()` probe
    (`fetch(FN, { signal: AbortSignal.timeout(2000) })`) in `beforeAll`, then
    `test.skip(!(await emulatorUp()), 'Firebase emulator not running')`, then self-provisioning via
    the Auth REST API (`accounts:signInWithPassword`, falling back to `accounts:signUp`) and the
    functions emulator (`POST {FN}/createGame|updateGame|launchRun`).

The surfaces under test:

- `apps/play-web/src/lib/playRoute.ts` → `resolveLegalPath(pathname)` returns `'terms' | 'privacy'`
  for `/terms` / `/privacy` (case-insensitive, trailing slash and query tolerant) and
  `resolvePlayRoute` gives it **precedence 0**, ahead of every query param and stored session.
  `App.tsx` renders `<Suspense fallback={routeFallback}><LegalScreen doc={…}/></Suspense>` with
  `LegalScreen` behind `lazyWithRetry('legal', () => import('./screens/LegalScreen'))`.
- `apps/play-web/src/screens/LegalScreen.tsx` renders `LEGAL_DOCS[type][activeLang]` from
  `@rushpoint/shared/legalContent` through `parseLegalMarkdown` — an `<h1>` with `document.title`,
  a `document.updated` line, a `role="group"` language switch with `עברית` / `English` buttons, and
  one block per source line (`## ` → `<h2>`). Default language is `he` unless the app language is
  `en`.
- `apps/creator-web/src/pages/RunConsolePage.tsx` (route `/run/:gameId/:runId`) renders
  `<PanelLanes layout={pinnedLayout}/>` unconditionally, then — when `activeSection` resolves — an
  `<aside>` holding `<nav aria-label={rc.sectionsHeader}>` ("מדורים") of `<button>`s (one per
  section, the active one carrying `aria-current="true"`) beside a
  `<section aria-label={groupTitles[activeSection]}>` whose `<h2>` repeats the section title.
  Section choice persists to `localStorage` under `sectionStateKey(runId)`.

## Goals / Non-Goals

**Goals**
- Real, blocking CI coverage for `/terms` and `/privacy` (no emulator needed), asserting the
  documents render AND that the player screen does not — the exact reported bug.
- Emulator-gated coverage for the run-console rail: the nav and the pinned zone both render, and
  switching sections actually changes the pane.
- Zero new infrastructure: same config, same fixture, same gating idioms, same file-naming trick.

**Non-Goals**
- No fake/mocked backend for the run console. No product-code change (no new `data-testid`).
- No Builder coverage for the safe-zone / duration-suggestion / pause-clock / tags additions
  (see proposal Non-goals).
- No assertion on legal PROSE beyond stable anchors (titles, the "last updated" line, section-1
  headings) — the documents are edited by humans and a brittle text assertion would be noise.

## Decisions

### D1 — Legal specs live in the `play` project via the filename `play-legal.spec.ts`
`testMatch: /play.*\.spec\.ts/` matches it, so it inherits the Pixel-7 device and the play-web
baseURL with no config change — and the `creator` project's `/creator\.spec\.ts/` does not, so it
runs exactly once, against play-web. Likewise `run-console-rail.creator.spec.ts` contains the
literal `creator.spec.ts` and so joins the `creator` project only.

### D2 — Anchor the legal assertions on structure, not prose
Per document assert: the `<h1>` title (`תנאי שימוש` / `מדיניות פרטיות`), the "last updated" line,
the document's own **section 1 heading** as `role=heading` (`1. כללי וקבלת התנאים` /
`1. מבוא ותחולה`), and `h2` count `>= 5`. The heading-count floor is what makes the smoke
un-passable on an empty page or a truncated chunk: a blank page, a stuck Suspense fallback, and a
partially-loaded document all fail it, while ordinary copy edits do not.

### D3 — Assert the PLAYER UI is absent
The reported bug rendered the game at `/terms`. The negative assertion is the access-code field
(`getByPlaceholder('הקוד שלכם')`, the JoinScreen anchor `play.spec.ts` already uses) at count 0.
This is the assertion that distinguishes "the legal route won" from "the page merely rendered".

### D4 — Drive the language toggle once
Clicking `English` must swap the document to the English source (`Terms of Service` +
`1. Acceptance of Terms`). One click, on the terms page only: it proves both language bodies are
inside the lazy chunk and that the state swap re-renders — cheap, and it is the only interactive
behavior the screen has.

### D5 — The run console is emulator-gated; copy `photo-review.creator.spec.ts` exactly
The console reads a real run doc through authenticated Firestore listeners. There is no honest way
to render it without the emulator, so the spec self-provisions (sign-in-or-sign-up →
`createGame` → `updateGame` → `launchRun`) and `test.skip`s when `emulatorUp()` is false. This is
stated as a limitation rather than worked around: in CI this spec **skips**, and the legal specs
are the ones that actually gate the PR.

### D6 — Rail assertions: nav + pinned + a real section switch
1. `nav[aria-label="מדורים"]` is visible and holds `>= 2` buttons — the rail exists and is
   populated (a run right after launch yields at least `teamsAndScores` and `shareAndScreens`).
2. The **pinned zone** rendered: the join/share card's access code is on screen even though it
   belongs to no section. This is the property `pinnedPanels()` encodes — a pinned panel that got
   swept into a section would fail here.
3. Exactly one rail button carries `aria-current="true"`, and its label equals the pane's
   `<h2>` — the "the rail and the pane cannot disagree" invariant.
4. Click the OTHER rail button → the pane's `<h2>` changes to that button's label and
   `aria-current` moves. This is the assertion a broken `resolveSection` / dead click handler
   fails, and it cannot pass on an empty page.
Section titles come from the Hebrew dictionary (`rc.groupTeams` = `קבוצות ודירוג`,
`rc.groupShare` = `שיתוף ומסכים`, …); the spec reads the ACTIVE button's own text and compares it
to the heading rather than hardcoding which section is default, so a change to `DEFAULT_SECTION`
does not break it.

### D7 — Speed
Four page loads total (two legal, plus the gated console's sign-in + console load, which skips in
CI). No `waitForTimeout`, no polling loops, no extra webServer. The legal pair should add roughly a
couple of seconds to the `ui` job.

## Test Strategy

This change **is** test code, so the strategy is how the new specs are themselves proven:

- **Pure logic:** none added — no new module, so no vitest / `scripts/test-*.ts` file is needed.
  `resolveLegalPath` and `runConsoleLayout` already have pure coverage in the `npm test` lane; this
  change deliberately does not duplicate it, it covers the RENDER those pure functions feed.
- **UI (the deliverable):** `npm run test:ui`. The legal specs must be run and pass with **no
  emulator**; the rail spec must be observed to SKIP cleanly in that same run (a skip, never a
  failure). Where ports 5180/5181 are already owned by a live playtest stack, `npx playwright test
  --list` (which boots no server) verifies the specs are discovered by the right projects and
  compile, and CI is the first real execution — this MUST then be stated plainly in the report, not
  glossed as "verified".
- **Negative control:** each legal assertion set is chosen so it fails on a blank page (heading
  count floor) and on the pre-existing bug (player-UI-absent check) — i.e. the smoke would have
  been RED against the reported defect.
- **Gates:** `npm run typecheck`, `npm run lint`, `npm test`. **No i18n gate**: no product UI file
  is touched and no user-facing string is added (the specs only READ existing Hebrew copy).
- Not run, by constraint: `e2e`, `verify:emulator`, `test:rules`, `simulate` — none of them observe
  `e2e-ui/`.

## Risks / Trade-offs

- **The rail spec is unexecuted at authoring time** (no emulator may be started here). Its
  selectors are derived by reading `RunConsolePage.tsx` (`nav[aria-label]`, `aria-current`, the
  pane `h2`) rather than by observation, so its first real run may need a selector fix. Mitigated
  by keeping it to four structural assertions on attributes that the source shows verbatim — and
  by the fact that it skips (never fails) without an emulator, so a selector slip cannot break CI.
- **Hebrew-literal selectors** are the house style here (every existing spec does it) and they
  couple the smoke to the dictionary. Accepted: that coupling is a feature — the i18n gate exists
  precisely to keep that copy Hebrew, and a smoke that would notice it flipping to English is
  worth more than an abstract `data-testid`.
- No new `data-testid` is introduced, so no product file is touched and the i18n gate stays out of
  scope. Trade-off accepted over selector robustness.
