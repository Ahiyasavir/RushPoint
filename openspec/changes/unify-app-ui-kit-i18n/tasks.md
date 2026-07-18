> This is a **structural refactor** with no new runtime logic, so the safety net is *behavioral
> equivalence*: both apps keep building, `i18n:check` stays clean, and every migrated surface
> renders identically in both themes (verified via preview). Migrate one primitive at a time and
> keep each stage independently green so a regression is isolated and revertable.

## 1. Scaffold `packages/ui`

- [ ] 1.1 Create the `packages/ui` workspace: `package.json` (`@rushpoint/ui`, `react` +
      `react-dom` as **peerDependencies** only, `@rushpoint/shared` as a dep for types),
      `tsconfig.json` (project-referenced like `packages/shared`), and `src/index.ts` (empty
      barrel). Add `@rushpoint/ui` to `apps/creator-web` and `apps/play-web` deps and to their
      Vite/TS path configs.
- [ ] 1.2 Run `npm install`, then `npm run creator:build` and `npm run play:build` — both must be
      green with the empty package wired in (no-op). Confirm no second copy of React is bundled
      (peer-dep is not double-installed).

## 2. Migrate shared primitives (one at a time; build both apps after each)

- [ ] 2.1 **`Skeleton`** (byte-identical today, lowest risk): implement the theme-agnostic
      `Skeleton` in `packages/ui`; have both apps' `components/ui.tsx` re-export it. Run
      `npm run creator:build` + `npm run play:build`; preview-inspect a Skeleton in each app
      (dark + light) and confirm identical computed `background`/`border-radius`.
- [ ] 2.2 **`Button`**: implement the shared `Button` supporting the **union** of variants
      (`primary | ghost | danger | subtle`) + a `block`/`size` prop, styled via semantic tokens
      (brand gradient `rp-fire`/`rp-amber`, `rp-alert`, focus ring) and per-app surface/border/text
      token classes supplied by each app's re-export. Bind creator's re-export to its
      inline/`min-h-[40px]` defaults and play's to full-width `py-3.5`. Build both apps;
      preview-inspect every variant in both themes for computed-value equality with pre-refactor.
- [ ] 2.3 **`Card`**: implement the shared `Card` with `glow` + `hover` props (creator defaults
      hover/glow on via its re-export; play defaults them off / flat). Build both; preview-inspect
      a card in each theme. *If the prop matrix proves ugly (see design Open Questions), leave
      `Card` per-app and note it here instead.*
- [ ] 2.4 **`Input` / `Textarea` / `Select`**: implement in `packages/ui` (`Input` as
      `forwardRef` — play needs the ref). Re-export from both apps bound to their tokens. Build
      both; preview-inspect an input + select in each theme.
- [ ] 2.5 **`Label` / `Badge` / `EmptyState` / `Spinner`**: implement in `packages/ui` (Badge
      keeps the 6-color semantic map via tokens). Re-export from both apps (play only re-exports
      the ones it uses). Build both; preview-inspect each in both themes.
- [ ] 2.6 Confirm the **app-specific** primitives stayed put and untouched: creator-web's
      `Advanced`, play-web's `Progress` and `Screen` still live in their app `ui.tsx`. Run
      `npm run lint` (creator) — 0 errors.

## 3. Extract the shared `ChatThread`

- [ ] 3.1 Implement `ChatThread` in `packages/ui`: owns the `runChatCol` snapshot subscription,
      `threads/openTeam/seen/draft/busy` state, `expand`/`reply`/`nameFor`/`totalUnread`, and the
      bubble markup — preserving `dir="auto"`, `text-start`, `ms-*`, `CHAT_TEXT_MAX_LEN`.
      Parameterize by `ctx`, `teams`, optional `senderName`, the label strings (passed in from
      `t.*`), a `sendMessage` callback (each app injects its own `sendTeamChatMessage` wrapper —
      the package imports no app service), and bubble/reply theme-token classes.
- [ ] 3.2 Rewrite `ChatConsole` in `apps/creator-web/src/pages/RunConsolePage.tsx` as a thin
      wrapper over `ChatThread` (supplies creator tokens, `rc.chat*` strings, `sendTeamChatMessage`,
      the shared `Input`/`Button` reply box). Delete the duplicated markup.
- [ ] 3.3 Rewrite `StaffChatSection` in `apps/play-web/src/screens/StaffConsole.tsx` as a wrapper
      over `ChatThread` (supplies play tokens, `t.chat.*` strings incl. `chatEmpty`, `senderName`,
      the collapsible outer shell). Delete the duplicated markup.
- [ ] 3.4 Build both apps; drive the flow in preview: creator Run Console chat and play Staff
      Console chat both render, thread expand/unread/reply work, bubbles keep `dir="auto"` and the
      correct per-theme colors. Run `npm run i18n:check:strict` — confirm **zero new** hardcoded-
      string findings (all chat copy still flows through `t.*`).

## 4. Shared i18n base

- [ ] 4.1 Add `packages/shared/src/i18nBase.ts` exporting `{ he, en }` for the truly-common keys
      only (brand/`appName`, `cancel`, `confirm`, `ok`, `close`, `errorTitle`, `errorBody`,
      `tryAgain`, `reload`) — static strings, no English-in-HE / Hebrew-in-EN. Export it from the
      shared package barrel. Add `scripts/test-i18n-base.ts` (auto-picked by the aggregator)
      asserting `he`/`en` have identical key sets and pass the same purity checks
      (`i18n:check` uses). Run `npm test` and confirm green.
- [ ] 4.2 In `apps/creator-web/src/i18n.ts` and `apps/play-web/src/i18n.ts`, spread the base into
      each language's `common` namespace (`common: { ...i18nBase.he, ...appSpecific }` and the `en`
      equivalent) and **delete** the now-duplicated inline literals for those keys. Keep every other
      namespace untouched.
- [ ] 4.3 Run `npm run i18n:check` — PART A (per-app HE/EN parity + purity) MUST be green — and
      `npm run i18n:check:strict` — zero new PART B findings. Build both apps.

## 5. Full gate pass

- [ ] 5.1 Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run e2e`, `npm run i18n:check`, and `npm run i18n:check:strict` —
      **all green**. Confirm via preview one final time that both apps look and read identically to
      pre-refactor in both themes and both languages (no visual or copy regression).
