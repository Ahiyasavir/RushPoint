## Context

Presentation-only removal of a redundant block on the creator Dashboard. creator-web has ESLint but
no component test runner; this is a UI lane. The redundancy is verifiable directly from source (top
nav + banner + grid all target the same three routes).

## Current state (re-confirmed)

`apps/creator-web/src/pages/DashboardPage.tsx`, the "Explore / next steps" section (only rendered
when `games.length > 0`), has two parts:

1. **Feature banner** — badge / title / body, then CTAs:
   ```
   <Button ... onClick={() => nav('/gallery')}>{d.bannerCta1}</Button>
   {PAYMENTS_ENABLED && (
     <Button variant="ghost" ... onClick={() => nav('/wallet')}>{d.bannerCta2}</Button>
   )}
   ```
2. **Quick-actions grid** — three cards driven by `QUICK_CARD_IDS`:
   ```
   <div className="grid sm:grid-cols-3 gap-4">
     {d.quickCards
       .map((a, i) => ({ a, id: QUICK_CARD_IDS[i], target: quickCardTarget(QUICK_CARD_IDS[i], games) }))
       .filter(({ id }) => PAYMENTS_ENABLED || id !== 'wallet')
       .map(({ a, target }, i) => (
         <button ... onClick={() => { if (target === CREATE_GAME_TARGET) setPicking(true); else nav(target); }}>
           ...card...
         </button>
       ))}
   </div>
   ```

`apps/creator-web/src/lib/templateLabels.ts`:
```
export const QUICK_CARD_IDS = ['builder', 'gallery', 'wallet'] as const;
```
and `quickCardTarget` maps `gallery`→`/gallery`, `wallet`→`/wallet`, `builder`→newest game or the
create-game modal. So the grid re-links the same three top-nav destinations (gallery + wallet also
already on the banner).

## The fix

**Remove the quick-actions grid block** (the `<div className="grid sm:grid-cols-3 …">…</div>`),
leaving the feature banner as the section's sole content. Keep the `{games.length > 0 && (…)}`
wrapper and the banner exactly as-is.

- `QUICK_CARD_IDS`, `quickCardTarget`, `CREATE_GAME_TARGET` in `templateLabels.ts` **stay** — they
  are still imported/used by `templateLabels.test.ts` and the create-game modal wiring; removing the
  grid does not require touching the lib.
- The `dashboard.quickCards` i18n strings **stay** in both dictionaries so parity holds and
  `templateLabels.test.ts` (which asserts `quickCards.length === QUICK_CARD_IDS.length`) still
  passes. They simply stop being rendered.
- If the grid was the only remaining consumer of an import (e.g. `QUICK_CARD_IDS` in
  `DashboardPage.tsx`), drop that now-unused import from `DashboardPage.tsx` only, to keep ESLint
  clean — do not remove it from the lib.

## RTL / i18n notes

- HE is default; the retained banner already uses logical layout — no change.
- **No i18n edit.** No key added or removed (strings intentionally left in place), so
  `i18n:check:strict` parity is untouched and there is no new PART B.

## Test strategy

Presentation-only **UI lane**. No pure decision is added or changed (`templateLabels` logic and its
existing unit test are untouched). Verified by `npm run typecheck` · `npm run lint`
(no unused-import error after trimming the DashboardPage import) · `npm run creator:build` ·
`npm run i18n:check:strict`. Manual: Dashboard shows the banner as the single next-step nudge; Build,
Gallery, Wallet all still reachable from the top nav.

## Non-regression checklist

- Top nav Build / Gallery / Wallet unchanged and reachable.
- Feature banner unchanged (Gallery CTA + paid-mode Wallet CTA).
- `templateLabels.ts` + `templateLabels.test.ts` untouched and green (strings + `QUICK_CARD_IDS`
  intact).
- Game grid, empty state, template picker modal, delete dialog — untouched.
