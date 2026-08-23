# Tasks — dashboard-drop-redundant-quicklinks

UI lane (creator-web has ESLint, no component test runner). One page; no i18n edit; no lib edit.

## Implement

- [x] 1. **Remove the quick-actions grid** — delete the `<div className="grid sm:grid-cols-3 …">…
      </div>` block (the `QUICK_CARD_IDS`-driven cards) in the "Explore / next steps" section of
      `apps/creator-web/src/pages/DashboardPage.tsx`. Keep the `{games.length > 0 && (…)}` wrapper
      and the feature banner intact. (design.md §The fix)

- [x] 2. **Trim now-unused imports in DashboardPage only** — if removing the grid leaves
      `QUICK_CARD_IDS` / `quickCardTarget` unused in `DashboardPage.tsx`, drop them from that file's
      import to keep ESLint clean. Do NOT edit `templateLabels.ts` or the `dashboard.quickCards`
      i18n strings — they stay so `templateLabels.test.ts` and i18n parity keep passing. (design.md
      §The fix)

## Verify (build lane — this agent)

- [x] 3. `npm run verify` (typecheck · lint · test · creator:build · play:build · bundle:budget ·
      i18n:check:strict) — green. Especially lint (no unused import) and test (`templateLabels.test.ts`
      still green because the lib + strings are untouched).
- [x] 4. `npx openspec validate dashboard-drop-redundant-quicklinks --strict` — passes.

## Manual (parent / owner — UNVERIFIED here)

- [ ] 5. Dashboard shows the feature banner as the single next-step nudge with no redundant card
      grid below it; Build, Gallery, and Wallet all remain reachable from the top nav.
