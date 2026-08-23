# Tasks — mobile-slidepanel-keyboard-avoidance

No pure logic in this change (a single Tailwind unit token) — per
CLAUDE.md's UI lane there is no RED unit test to write; the gates are
typecheck + creator:build + i18n:check:strict + browser.

## GREEN

- [x] 1. `App.tsx:90` — change the Builder shell's `h-screen` to `rp-h-dvh`;
      add `.rp-h-dvh` to `index.css` (`100vh` unconditional, `100dvh`
      inside `@supports (height: 100dvh)`).
- [x] 1a. **Superseded first attempt**, kept here for the record: pairing
      `h-screen h-dvh` as two Tailwind classes. A code-review pass before
      commit checked the actual compiled production CSS and found
      `.h-dvh` emitted BEFORE `.h-screen` in this build — the reverse of
      what the fallback idiom needs — which would have made `h-screen`
      always win and silently discarded the fix on every browser. Replaced
      with the `@supports` version in task 1 before this was ever
      committed or deployed. See design.md §2.

## REFACTOR / VERIFY

- [x] 2. Preview check (375px viewport, keyboard closed): Builder shell
      measured 812px tall against an 812px viewport. The 3-pane workspace,
      header, stage rail and task cards all rendered and measured normally
      throughout this session's checks; no horizontal overflow.
- [x] 3. Preview check (desktop/700px): no visual regression observed
      during the reflow checks at that width.
- [x] 4. Confirmed in the compiled build output
      (`apps/creator-web/dist/assets/index-*.css`):
      `.rp-h-dvh{height:100vh}@supports (height: 100dvh){.rp-h-dvh{height:100dvh}}`
      — order-independent by construction. `CSS.supports('height','100dvh')`
      returned `true` in this session's browser.
      Recorded explicitly that keyboard-OPEN behavior on a real iOS device
      was not (and could not be, in this tooling) directly verified —
      confidence rests on `@supports` being an unambiguous feature query,
      not on assumed rule ordering (which is exactly what task 1a's
      superseded attempt got wrong).
- [x] 5. `npx tsx scripts/check-i18n.ts --strict` clean (no new strings
      expected) — confirmed.
- [x] 6. Hand the full gate set to the parent (`npm run typecheck`,
      `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`) — all 9 gates green.
