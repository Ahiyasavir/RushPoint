# Design — wallet-tx-date-guard

## Current state

`apps/creator-web/src/pages/WalletPage.tsx:200` renders the transaction date inline:

```tsx
<div className="text-[11px] text-[--ink-3]">{new Date(tx.createdAt).toLocaleDateString()}</div>
```

`new Date(<missing | non-ISO>)` produces an `Invalid Date`, whose `toLocaleDateString()` returns the
literal string `"Invalid Date"`. That string then renders next to a real charge amount. Every other
part of this row is already resilient (`txLabel` / `txAmount` are total helpers); only the date is raw.

## The fix

Introduce a pure, total helper and call it at the one render site.

`apps/creator-web/src/lib/formatTxDate.ts` (new):

```ts
// Total: any unparseable timestamp yields the fallback, never "Invalid Date".
export function formatTxDate(createdAt: string | number | null | undefined): string {
  if (createdAt == null) return '';
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
}
```

- Fallback is the **empty string** (not a dash or placeholder text), so no new i18n copy is needed and
  a row with a bad timestamp simply shows the label + amount with no date line content — strictly
  better than "Invalid Date".
- The valid path is byte-for-byte the same output as today (`new Date(iso).toLocaleDateString()`),
  so the happy path is provably unchanged.

`WalletPage.tsx:200` becomes:

```tsx
<div className="text-[11px] text-[--ink-3]">{formatTxDate(tx.createdAt)}</div>
```

with an added `import { formatTxDate } from '../lib/formatTxDate';`.

## Test strategy (RED first)

New `scripts/test-format-tx-date.ts` (tsx assertion script, auto-discovered by
`scripts/run-unit-tests.mjs` under `npm test`). Written and confirmed **failing** against the
not-yet-existing module first, then the helper is created to green it:

- `undefined` → `''`
- `null` → `''`
- `'garbage'` → `''`
- `NaN` → `''`
- a valid ISO string (e.g. `'2026-07-24T10:00:00.000Z'`) → a non-empty string equal to
  `new Date('2026-07-24T10:00:00.000Z').toLocaleDateString()` (locale-agnostic assertion — compare to
  the same expression, not a hardcoded date, so the test does not depend on the runner's locale)
- the helper never throws for any of the above inputs

## i18n

No new strings. The fallback is an empty string, so there is nothing to translate and
`npm run i18n:check` has nothing to add. HE and EN are unaffected. (Included for completeness per house
style: no em-dash, no en-dash, no spaced-hyphen copy is introduced because no copy is introduced.)

## Risk

Very low. Additive pure helper plus a one-token call swap; the valid path is identical; the only
behavioral change is that an unparseable timestamp now renders blank instead of "Invalid Date".
