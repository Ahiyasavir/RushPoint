# Proposal — wallet-tx-date-guard

## Why

The Wallet page renders each transaction's date with an unguarded
`new Date(tx.createdAt).toLocaleDateString()` (`apps/creator-web/src/pages/WalletPage.tsx:200`).
Under normal server writes `WalletTransaction.createdAt` is a valid ISO string, but if any stored
value is ever missing or non-ISO (a legacy/partial doc, or a webhook-written tx with a different
shape), that expression yields the literal string "Invalid Date" rendered next to a real charge — on
the exact page where a creator reconciles money, an unsettling and confusing artifact. This is a
defensive, edge-case concern (the bad value is UNVERIFIED in practice), but the fix is tiny and the
failure mode is money-adjacent, so it is worth a guard.

## What Changes

- Extract a tiny pure helper `formatTxDate(createdAt): string` that returns the localized date string
  when the timestamp parses to a valid `Date`, and a safe fallback (an empty string) when it does not
  (missing, null, non-ISO garbage, or a `Date` whose time is `NaN`). No "Invalid Date" ever reaches
  the screen.
- Use `formatTxDate(tx.createdAt)` in place of the inline `new Date(...).toLocaleDateString()` at the
  transaction-history render site.
- Cover the helper with a co-located RED-first unit test.

## What does NOT change

- The transaction row layout, the amount rendering (`txAmount`), the label (`txLabel`), the query,
  and the 20-row limit are all unchanged.
- No callable, no backend, no shared type, no Firestore rule, no i18n string (the fallback is an
  empty string, not new copy).
- The valid-date path renders exactly the same output it does today.

## Non-goals

- No change to how `createdAt` is written on the backend (still a server-written ISO string).
- No broader audit of every timestamp render site; this change fixes the one flagged site and adds a
  reusable helper others can adopt later.

## Impact

- Affected specs: `wallet-transaction-history` (new)
- Affected code: `apps/creator-web/src/pages/WalletPage.tsx:200` (one call swap),
  `apps/creator-web/src/lib/formatTxDate.ts` (new pure helper),
  `scripts/test-format-tx-date.ts` (new unit suite, auto-picked up by the `npm test` aggregator)
- Surfaces touched: **creator-web only**. No backend, no shared types, no rules, no play-web, no i18n.
