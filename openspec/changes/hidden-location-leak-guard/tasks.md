# Tasks: hidden-location-leak-guard

## 1. RED
- [ ] Add `scripts/test-location-leak.ts` asserting `locationLeakWarnings`:
      non-hidden ⇒ `[]` (even with a place name in the title); hidden + EN token in title ⇒
      `['title']`; hidden + HE token in description ⇒ `['description']`; hidden + both ⇒
      `['title','description']`; hidden + neutral text ⇒ `[]`; place token only in `locationClue` ⇒
      `[]`; word-boundary guard ("apartment" does not match `art`-like fragment). Confirm RED
      (helper does not exist yet).

## 2. GREEN
- [ ] Add `packages/shared/src/locationLeak.ts` with `LocationLeakField` +
      `locationLeakWarnings(task)` (curated bilingual token match, `locationClue` exempt,
      word-boundary for EN, substring for HE).
- [ ] Export from `packages/shared/src/index.ts` (`export * from './locationLeak';`).
- [ ] `npm run shared:build`; `scripts/test-location-leak.ts` passes GREEN.

## 3. Builder wiring (UI)
- [ ] In `apps/creator-web/src/components/TaskWizard.tsx`, import `locationLeakWarnings` and, inside
      the `task.hideLocation` block, render a non-blocking caution naming the offending field(s).
      No save-block, no content mutation.
- [ ] Add `hideLocationLeakTitle` / `hideLocationLeakDesc` / `hideLocationLeakBoth` to BOTH `he` and
      `en` Builder dictionaries in `apps/creator-web/src/i18n.ts` (no dash separators; parity holds).

## 4. Gates
- [ ] `npm run typecheck` green.
- [ ] `npm test` green (location-leak test passes).
- [ ] `npm run lint` green.
- [ ] `npm run creator:build` green.
- [ ] `npm run play:build` green.
- [ ] `npm run i18n:check` clean (PART A; new keys HE-is-HE / EN-is-EN, zero new PART B findings).
