# Tasks: hidden-location-leak-guard

> **Status reconciled 2026-07-21.** An audit found this change was already implemented and landed in
> commit `d30fb5a` (helper + shared export + tsx test + TaskWizard caution + EN/HE i18n keys); only
> the checkboxes below were stale. The 2026-07-21 pass re-verified the helper against the delta spec
> and extended the pure test from 8 to 21 assertions. Notes: `docs/wave-a/hidden-location-guard.md`.

## 1. RED
- [x] Add `scripts/test-location-leak.ts` asserting `locationLeakWarnings`:
      non-hidden ⇒ `[]` (even with a place name in the title); hidden + EN token in title ⇒
      `['title']`; hidden + HE token in description ⇒ `['description']`; hidden + both ⇒
      `['title','description']`; hidden + neutral text ⇒ `[]`; place token only in `locationClue` ⇒
      `[]`; word-boundary guard ("apartment" does not match `art`-like fragment). Confirm RED
      (helper does not exist yet).
- [x] (2026-07-21) Extend the same script with language symmetry (HE token in title, EN token in
      description, HE in both, mixed EN/HE), a total falsy short-circuit (`hideLocation` absent and
      explicitly `undefined` with place names in both fields), and shape guards (missing fields,
      whitespace-only, EN case insensitivity, multi-word token "in front of", `locationClueHe` also
      exempt, result order always title then description, neutral Hebrew instruction). 21/21 green.

## 2. GREEN
- [x] Add `packages/shared/src/locationLeak.ts` with `LocationLeakField` +
      `locationLeakWarnings(task)` (curated bilingual token match, `locationClue` exempt,
      word-boundary for EN, substring for HE).
- [x] Export from `packages/shared/src/index.ts` (`export * from './locationLeak';` at line 54).
- [x] `scripts/test-location-leak.ts` passes GREEN (run directly via `npx tsx`, which imports the
      TypeScript source, so this lane needs no `shared:build`).

## 3. Builder wiring (UI)
- [x] In `apps/creator-web/src/components/TaskWizard.tsx`, import `locationLeakWarnings` (line 13)
      and, inside the `task.hideLocation` block, render a non-blocking caution naming the offending
      field(s) (lines 935 to 947). No save-block, no content mutation — confirmed by audit: the block
      is a bare `<p>` with no `set()` call and no effect on the Save/Next controls.
- [x] Add `hideLocationLeakTitle` / `hideLocationLeakDesc` / `hideLocationLeakBoth` to BOTH `he`
      (i18n.ts lines 544 to 546) and `en` (lines 1302 to 1304) Builder dictionaries. No dash
      separators; HE values are pure Hebrew, EN values pure English; `EN: typeof HE` parity holds.

## 4. Gates
> Gates run centrally in the orchestrating lane (concurrent agents share `packages/shared/dist`, so
> this lane must not invoke anything that triggers `shared:build`). The pure-logic lane below was run
> in isolation and is green; the rest are pending that centralized re-run.
- [ ] `npm run typecheck` green.
- [x] `npm test` — location-leak lane verified green in isolation (21/21) via
      `npx tsx scripts/test-location-leak.ts`; full aggregator run pending with the other gates.
- [ ] `npm run lint` green.
- [ ] `npm run creator:build` green.
- [ ] `npm run play:build` green.
- [ ] `npm run i18n:check` clean (PART A; new keys HE-is-HE / EN-is-EN, zero new PART B findings).
