## Why

`npm run test:ui` (Playwright, CI job `ui` in `.github/workflows/ci.yml`) is the ONLY gate that
proves the two React apps actually render in a real browser. It currently smokes three surfaces:
creator-web's logged-out AuthGate (mount + sign-in controls + Hebrew), its forgot-password
confirmation, and play-web's Join + `?staff` screens. Everything else is either emulator-gated
(the Builder groups/dnd spec, the run-console photo queue) or uncovered.

A large amount of UI landed since then and **none of it is in that smoke**, so a white-screen
regression in any of it ships CI-green:

- **play-web `/terms` and `/privacy`** — a NEW lazily-loaded `LegalScreen` chunk reached by
  `resolveLegalPath()` in play-web's router-less `App.tsx`. A lazy chunk that fails to resolve
  renders a blank Suspense fallback forever, and the pre-existing bug was worse: both paths fell
  through the query-param routing and rendered the PLAYER screen instead of the document. These
  are legal documents on the participant origin, linked from store listings — a silent regression
  here is a compliance problem, not a cosmetic one. **This surface needs no emulator**, so it is
  real, blocking CI coverage.
- **The run console section rail** — the biggest structural change of the night: the console's
  accordions were replaced by a Builder-style rail (`apps/creator-web/src/lib/runConsoleLayout.ts`
  → `buildRunConsoleSections` / `pinnedPanels` / `assignPanelColumns`, rendered by
  `RunConsolePage.tsx`). The pure lane proves the LAYOUT PLAN; nothing proves the page renders it.
  The console needs an authenticated creator and a live run, so it is **not reachable without the
  emulator** and its spec must be emulator-gated and skipped otherwise — the same shape as the
  existing `photo-review.creator.spec.ts`.

## What Changes

- **New** `e2e-ui/play-legal.spec.ts` (picked up by the existing `play` project's
  `/play.*\.spec\.ts/` testMatch, no config change): render smokes for `/terms` and `/privacy`
  that assert the real document content is on screen (title, "last updated" line, the document's
  own section-1 heading, and a non-trivial number of headings), that the **player UI is absent**
  (no access-code field), and that the language toggle swaps the document to English. Needs no
  emulator and no backend, so it runs for real on every PR.
- **New** `e2e-ui/run-console-rail.creator.spec.ts` (picked up by the existing `creator` project's
  `/creator\.spec\.ts/` testMatch): self-provisions a creator + a launched run through the emulator
  REST/callable APIs and asserts the rail renders (section nav + the pinned zone) and that
  activating a different rail entry actually swaps the pane. **`test.skip` when the emulator is not
  running**, exactly like `builder-groups.creator.spec.ts` and `photo-review.creator.spec.ts`, so
  the no-emulator CI configuration stays green.
- No new framework, no new Playwright config, no new npm script, no product-code change.

## Non-goals

- **Not** making the run console reachable without a backend (no mocked Firestore, no fake fixture
  page, no route stub). Faking it would assert against a fiction; gating it is honest.
- **Not** covering the night's Builder additions (safe-zone field, task-duration suggestion,
  pause-clock toggle, tags field). They live behind the same authenticated Builder as
  `builder-groups.creator.spec.ts`, so they would also only ever run emulator-gated — no CI
  signal — and they are field-level additions, far below the rail in regression risk. Left
  explicitly uncovered rather than covered badly.
- **Not** a functional test of the legal documents' text, the run console's panels, or any
  callable. Render-level assertions only, in the existing smoke's style.
- No change to `scripts/e2e-verify.mjs`, `functions/**`, or rules.

## Surfaces touched

Test-only: `e2e-ui/`. **No product code**, so no i18n gate applies (no user-facing string is
added or changed). No callable added or changed.

## Impact

- **New:** `e2e-ui/play-legal.spec.ts`, `e2e-ui/run-console-rail.creator.spec.ts`.
- **Unchanged:** `playwright.config.ts`, `package.json`, every app and function.
- **CI:** the legal specs add ~2 fast page loads to the existing `ui` job (no server boot beyond
  the two Vite dev servers it already starts). The rail spec skips in CI (no emulator) and runs
  locally / in any emulator-backed invocation.
