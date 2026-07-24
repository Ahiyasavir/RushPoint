# Tasks — wallet-tx-date-guard

## RED

- [ ] 1. Write `scripts/test-format-tx-date.ts` against the not-yet-existing
      `apps/creator-web/src/lib/formatTxDate.ts`: `undefined`/`null`/`'garbage'`/`NaN` → `''`; a valid
      ISO string → a non-empty string equal to `new Date(iso).toLocaleDateString()` (compare to the
      same expression, not a hardcoded value, so it is locale-agnostic); the helper never throws. Run
      it, confirm it fails on the missing module, record the output.

## GREEN

- [ ] 2. Create `apps/creator-web/src/lib/formatTxDate.ts` exporting the pure, total
      `formatTxDate(createdAt: string | number | null | undefined): string` per design. Re-run the
      suite to green.
- [ ] 3. In `apps/creator-web/src/pages/WalletPage.tsx`, add
      `import { formatTxDate } from '../lib/formatTxDate';` and replace the inline
      `new Date(tx.createdAt).toLocaleDateString()` at `:200` with `formatTxDate(tx.createdAt)`. No
      other line changes.

## REFACTOR / VERIFY

- [ ] 4. Re-run `npx tsx scripts/test-format-tx-date.ts` and confirm ALL PASS.
- [ ] 5. Hand the gate set to the parent (`npm run typecheck`, `npm run lint`, `npm test`,
      `npm run creator:build`). No i18n string was added, so `i18n:check` has nothing new; no callable,
      no `Task` field, so no e2e is owed. This lane must not run the shared-`dist`-rewriting gates
      concurrently with another live lane.
