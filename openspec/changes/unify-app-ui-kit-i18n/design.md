## Context

RushPoint ships two React + Vite apps that share nothing at the presentation layer today:

- **`apps/creator-web/src/components/ui.tsx`** (~201 lines) — dark theme. Primitives style through
  semantic CSS variables (`bg-[--surface-0]`, `text-[--ink-1]`, `border-[--rp-border]`) plus
  brand tokens (`from-rp-fire to-rp-amber`, `rp-alert`). `Button` variants:
  `primary | ghost | danger | subtle`, inline auto-width, `min-h-[40px]`. Has `Advanced`
  (creator-only collapsible), `Spinner`, `Skeleton`, `EmptyState`, `Badge` (6 colors), `Label`,
  `Textarea`, `Select`.
- **`apps/play-web/src/components/ui.tsx`** (~113 lines) — light "Warm Trail" theme that
  **reverses the Tailwind zinc scale** (so `text-zinc-100` is dark-on-light). Uses different
  tokens (`bg-app-bg`, `border-glass-border`, `bg-app-raised`, `bg-accent`). `Button` variants:
  `primary | ghost | danger`, always **full-width** `py-3.5`, larger radius (`rounded-2xl`).
  `Input` is `forwardRef`. Has app-specific `Progress` (colorblind-aware) and `Screen`. `Skeleton`
  is byte-identical to creator-web's.

The apps share `@rushpoint/shared` (`packages/shared`) — a **plain-TypeScript** package (canonical
types, `FIRESTORE_PATHS`, scoring, geo helpers) that is **also imported by `functions/`**. It has
no React dependency and must not gain one (functions must not pull React into their bundle).

`i18n.ts` in each app exports a `translations` object keyed by `he`/`en`. Both dictionaries already
duplicate, word-for-word, the error-boundary strings (`errorTitle`, `errorBody`, `tryAgain`,
`reload`), `cancel`, and the brand name — with no shared source, so they can drift. The
`npm run i18n:check` gate (`scripts/check-i18n.ts`) imports each app's `translations` and enforces,
**per app**: A1 HE/EN identical key sets, A2 same-key same-type, A3 HE leaves have no English, A4
EN leaves have no Hebrew (PART A = hard gate). PART B (strict) flags hardcoded component strings.

The chat thread (`RunConsolePage.tsx` `ChatConsole`, `StaffConsole.tsx` `StaffChatSection`) is
near-identical: same `onSnapshot` over `FIRESTORE_PATHS.runChatCol`, same `threads/openTeam/seen/
draft/busy` state, same `expand` / `reply` / `nameFor` / `totalUnread` logic, same bubble markup
with `dir="auto"` and logical classes (`ms-`, `text-start`). Differences: theme classes
(`bg-neon-blue` vs `bg-accent`, `bg-app-bg` vs `bg-app-raised`), the reply-box (creator uses the
shared `Input`/`Button`; play uses raw styled `<input>`/`<button>`), a collapsible outer section
(play only), and `sendTeamChatMessage` taking an extra `senderName` on the play side.

## Goals / Non-Goals

**Goals:**
- One source of truth for each primitive whose shape is genuinely shared across the two apps,
  **without** either app losing its theme.
- One source of truth for the chat thread markup + logic.
- One source of truth for the truly-common translation keys, with `i18n:check` PART A staying
  green (per-app HE/EN parity and purity preserved).
- Zero rendered-output change: both apps look and read exactly as before, both themes, both
  languages. Provable by build + preview parity.

**Non-Goals:**
- No single/unified theme; no redesign; no new visual language (see proposal Non-goals).
- No move of app-specific primitives (`Advanced`, `Progress`, `Screen`) or app-specific i18n
  namespaces.
- No React in `@rushpoint/shared`; no backend/callable/rules/schema change.

## Decisions

**1. UI primitives live in a NEW `packages/ui` workspace, not in `@rushpoint/shared`.**
`@rushpoint/shared` is imported by `functions/` and must stay React-free; adding components there
would pull React into the functions build. A dedicated `@rushpoint/ui` package declares `react` /
`react-dom` as **peerDependencies** (bundled by each app, never by the package), and depends on
`@rushpoint/shared` only for types. Both apps add it to their workspace deps.
*Alternative considered:* a plain `apps/**/shared-ui` folder symlinked/relatively-imported —
rejected: Vite/TS project boundaries get messy across apps, and a real workspace is the pattern
already used for `shared`.

**2. Theming stays per-app via semantic tokens + variant props — primitives are token-driven, not
palette-driven.** The shared primitives **never** hardcode a zinc shade or a literal color. They
render structural classes (layout, radius, focus ring, transitions) plus **semantic token
classes** that each app already defines for its own theme. Two complementary mechanisms:
   - *Semantic CSS variables where both apps already share the variable name* (e.g. the brand
     gradient `from-rp-fire to-rp-amber`, `rp-alert`, focus ring `rp-fire` — these mean the right
     thing in both apps).
   - *A `theme`/`tokens` prop (or a thin per-app wrapper) where the token names differ* (creator's
     `--surface-0` / `--ink-1` vs play's `app-bg` / reversed zinc). The primitive accepts the
     surface/border/text token classes as props (with a default), and each app's local `ui.tsx`
     re-exports the primitive pre-bound to its own tokens. This keeps app call-sites unchanged
     (`import { Button } from '../components/ui'`) while the implementation is single-sourced.
   
   Variant surface: the shared `Button` supports the **union** of variants
   (`primary | ghost | danger | subtle`) and a `size`/`block` prop so creator's inline
   `min-h-[40px]` button and play's full-width `py-3.5` button are the same component configured
   differently. `Input` is `forwardRef` (play needs the ref; creator is unaffected).

**3. Which primitives unify vs stay per-app.**
   - **Unify (shared shape):** `Button`, `Card`, `Input`, `Textarea`, `Select`, `Label`, `Badge`,
     `Skeleton` (byte-identical today), `EmptyState`. `Spinner` unifies too (creator-only today,
     but generic).
   - **Stay per-app:** `Progress` (play-only, colorblind + `useT` coupled), `Screen` (play-only
     layout), `Advanced` (creator-only collapsible). These have no counterpart in the other app;
     moving them would be speculative.
   - Honesty note: play-web's `Card` has no hover-lift and a different shadow; creator's has a
     `glow` prop and grad-border. The shared `Card` keeps both as **props** (`glow`, `hover`) with
     per-app defaults via the re-export, rather than pretending they're identical.

**4. Shared chat thread → `ChatThread` in `packages/ui`.** It owns the snapshot subscription,
`threads/openTeam/seen/draft/busy` state, `expand`/`reply`/`nameFor`/`totalUnread`, and the bubble
markup (preserving `dir="auto"`, `text-start`, `ms-*`, `CHAT_TEXT_MAX_LEN`). It is parameterized
by: `ctx`, `teams` (for `nameFor`), an optional `senderName` (threaded into `sendTeamChatMessage`),
the label strings (passed in from each app's `t.*`, so no copy moves into the package), a
`sendMessage` callback (each app injects its own `sendTeamChatMessage` wrapper — the package does
not import app service layers), and theme-token classes for the bubbles/reply box. creator's
`ChatConsole` and play's `StaffChatSection` become thin wrappers that supply their tokens, strings,
and the collapsible outer shell (play). *Alternative:* a headless hook + per-app markup — rejected
as under-DRY here since the markup is the bulk of the duplication.

**5. Shared i18n base is plain data in `@rushpoint/shared` (`i18nBase.ts`), merged into each app's
`common` namespace.** The base exports `{ he: {...}, en: {...} }` for the common keys only
(`appName`/brand, `cancel`, `confirm`, `ok`, `close`, `errorTitle`, `errorBody`, `tryAgain`,
`reload`). Each app's `i18n.ts` spreads the base into its `common` block per language
(`common: { ...i18nBase.he, ...he-app-specific }`). Because the merge happens **before**
`translations` is exported, `check-i18n.ts` (which reads the final `translations`) still sees a
complete, parity-correct, pure dictionary per app — PART A stays green with no script change.
Keys the base owns are removed from each app's inline literals so there is exactly one source.
*Constraint:* base values are static strings (or simple functions) with **no** English-in-HE /
Hebrew-in-EN, so A3/A4 pass; the base is itself covered by the same purity assertion (see Test
Strategy). *Alternative:* a third i18n package — rejected; the base is tiny and shared already
hosts cross-app constants.

## Test Strategy

This change is **structural (a refactor)**, so the safety net is *behavioral equivalence*, proven
by builds + i18n gate + preview parity rather than new unit tests of new logic. Per repo rules the
build/i18n gates are the "tests" for UI-only work (no component runner exists).

- **Build safety net (per stage):** after each stage run `npm run creator:build` **and**
  `npm run play:build` — both must stay green. A moved primitive that breaks either app's Tailwind
  token resolution or TS types fails here immediately.
- **i18n gate (i18n base stage, mandatory):** run `npm run i18n:check` — PART A (HE/EN parity +
  purity, per app) MUST stay green through the base extraction; run `npm run i18n:check:strict` and
  confirm **zero new** PART B findings (no string is newly hardcoded; the `ChatThread` receives all
  copy via props from `t.*`). Add a tiny pure assertion (`scripts/test-i18n-base.ts`, auto-picked
  by the aggregator) that the base `he`/`en` have identical key sets and that HE has no
  ASCII-English word / EN has no Hebrew letter — so the base can't rot independently of the apps.
- **Preview parity (both themes, the core acceptance):** with the app running, verify the migrated
  surfaces render **identically to before** in each app + theme:
  - creator-web (dark): Dashboard/Runs primitives (`Button` all variants, `Card` glow, `Input`,
    `Badge`, `Skeleton`, `EmptyState`) and the Run Console chat (`ChatConsole`).
  - play-web (light, reversed zinc): Join/Play primitives (full-width `Button`, `Card`, `Input`,
    `Progress` still local, `Skeleton`) and the Staff Console chat (`StaffChatSection`, collapsible).
  Use `preview_inspect` on specific CSS props (background, color, border, radius) to confirm the
  theme tokens resolve to the **same computed values** as pre-refactor — inspection over
  screenshots per repo guidance.
- **Full gate (final):** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build`
  · `npm run play:build` · `npm run e2e` · `npm run i18n:check` (+ `:strict`) — all green.

## Risks / Trade-offs

- **[Risk] A token mismatch makes a primitive look right in one app, broken in the other** (the
  exact reason this stayed duplicated). → Mitigation: primitives take token classes via the per-app
  re-export (Decision 2); preview-inspect both themes for computed-value equality before deleting
  the old code. Migrate **one primitive at a time** so a regression is isolated.
- **[Risk] i18n base merge accidentally drops or duplicates a key → PART A red.** → Mitigation:
  extract the base in its own stage, run `i18n:check` immediately, and keep the base covered by
  its own parity/purity assertion script.
- **[Risk] `packages/ui` peer-dep misconfig double-bundles React.** → Mitigation: `react`/
  `react-dom` as `peerDependencies` only; verify each app build's bundle doesn't gain a second
  React (build stays green + bundle sanity check).
- **[Trade-off] The shared `Button`/`Card` carry the *union* of both apps' props** (`subtle`
  variant, `glow`, `hover`, `block`). Slightly larger API than either app had alone — accepted:
  it's the price of one component instead of two, and unused props default off per app.
- **[Trade-off] Some primitives deliberately stay per-app.** Not everything is DRY; honesty over a
  forced abstraction (Decision 3).

## Migration Plan

**Staged, not big-bang** — each stage independently builds green and is revertable on its own:

1. **Scaffold `packages/ui`** (peer-dep React, depends on shared types) — empty, wired into both
   apps' workspace deps + Vite/TS configs. Build both apps (no-op change) → green.
2. **Primitives, one at a time.** Move `Skeleton` first (byte-identical, lowest risk), then
   `Button`, `Card`, `Input`/`Textarea`/`Select`, `Label`, `Badge`, `EmptyState`, `Spinner`.
   After each: app `ui.tsx` re-exports the shared version bound to its tokens; build both apps;
   preview-inspect the touched primitive in both themes.
3. **`ChatThread`.** Extract to `packages/ui`; rewrite `ChatConsole` + `StaffChatSection` as
   wrappers; build both; preview both consoles.
4. **i18n base.** Add `i18nBase.ts` to shared; merge into both `common` namespaces; delete the
   now-duplicated literals; run `i18n:check` (+`:strict`) and the base parity assertion.
5. **Full gate pass.**

No data migration, no schema change, no rollback beyond `git revert` of a stage.

## Open Questions

- Should the per-app token binding be a `theme` **prop** on each primitive, or per-app **wrapper
  re-exports** (Decision 2 leans wrapper re-exports to keep call-sites untouched)? Finalize during
  stage 2 once the first primitive lands.
- Are creator's `Card` (hover-lift + grad-border + glow) and play's `Card` (flat) close enough to
  be one component with props, or should `Card` be the one primitive that stays per-app? Decide
  empirically when migrating `Card` in stage 2; keep it per-app if the prop matrix gets ugly.
- Should `packages/ui` also home the shared `Skeleton`'s CSS (`.rp-skeleton` shimmer, currently in
  each app's `index.css`), or leave the CSS per-app? Leaning leave-per-app (theme-owned) for now.
