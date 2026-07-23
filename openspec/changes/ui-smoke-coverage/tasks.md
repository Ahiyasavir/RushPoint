## 1. Legal-document render smoke (RED → GREEN)

- [x] 1.1 Write `e2e-ui/play-legal.spec.ts` (name chosen so the existing `play` project's
      `testMatch: /play.*\.spec\.ts/` picks it up with NO config change), importing `test`,
      `expect`, `assertNoCrash` from `./fixtures`. Cover `/terms`: `<h1>` `תנאי שימוש`, the
      `עודכן לאחרונה` line, `role=heading` `1. כללי וקבלת התנאים`, `h2` count `>= 5`, the player
      access-code field absent, `assertNoCrash`, zero `pageErrors`.
- [x] 1.2 Confirm the assertions are a real RED against the bug they encode: with the legal route
      disabled (or on a build without `LegalScreen`), `/terms` renders the Join screen, so the
      access-code-absent assertion and the heading-count floor both fail. Reason it through against
      `resolvePlayRoute`'s precedence-0 legal branch; do NOT commit a temporary route break.
- [x] 1.3 Add the `/privacy` case (`מדיניות פרטיות`, `1. מבוא ותחולה`) and the language-toggle case
      (click `English` on `/terms` → `Terms of Service` + `1. Acceptance of Terms`).

## 2. Run-console rail smoke (emulator-gated)

- [x] 2.1 Write `e2e-ui/run-console-rail.creator.spec.ts` reusing the EXACT gating idiom of
      `photo-review.creator.spec.ts`: `AUTH`/`FN` constants, `post()`, `emulatorUp()`, a
      sign-in-or-sign-up `creatorToken()`, and `test.skip(!(await emulatorUp()), …)` in
      `beforeAll`. Provision `createGame` → `updateGame` (two stages, a couple of tasks) →
      `launchRun`, then sign in through the UI and open `/run/{gameId}/{runId}`.
- [x] 2.2 Assert the rail: `nav[aria-label="מדורים"]` visible with `>= 2` buttons; the pinned
      join/share access code visible (the pinned zone is outside every section); exactly one
      button with `aria-current="true"`, whose text starts with the pane `<h2>`'s text.
- [x] 2.3 Assert the switch: click a non-current rail button → the pane `<h2>` becomes that
      button's label and `aria-current` moves to it. Read labels from the DOM rather than
      hardcoding `DEFAULT_SECTION`.

## 3. Gates

- [x] 3.1 `npm run typecheck`. NOTE: there is no root `tsconfig.json` — `turbo run typecheck` only
      covers the workspaces, so `e2e-ui/` is NOT type-checked by it (true of every existing spec
      too); Playwright's own transpile at `--list`/run time is what proves the new specs compile.
      Confirm any failure is outside this change's diff.
- [x] 3.2 `npm run lint` — 0 errors.
- [x] 3.3 `npm test` — green (unchanged; no pure-logic module was added).
- [x] 3.4 **Check ports 5180/5181 FIRST** (`netstat -ano | grep -E ":(5180|5181)"`). If free, run
      `npm run test:ui` and confirm: the legal specs PASS with no emulator, and the rail spec is
      reported SKIPPED (not failed). If the ports are owned by a live playtest stack, do NOT run it
      and do NOT kill anything — verify discovery/compilation with `npx playwright test --list`
      instead and report plainly that CI is the first real execution.
- [x] 3.5 No i18n gate: no product UI file is touched and no user-facing string is added or
      changed (confirm the diff is limited to `e2e-ui/` and `openspec/changes/ui-smoke-coverage/`).
