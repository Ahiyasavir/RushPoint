# Design — mobile-back-button-target

## 1. Current code, audited

`BuilderPage.tsx:998-1000`:
```tsx
<button onClick={() => { void leaveToGames(); }} aria-label={b.backToGames} className="flex items-center gap-1 text-xs text-[--ink-3] hover:text-[--ink-1] shrink-0 rounded-lg border border-[--rp-border] px-2 py-1 hover:bg-[--surface-2] transition-colors">
  <span className="text-sm leading-none">←</span> <span className="hidden sm:inline">{b.backToGames}</span>
</button>
```
Below `sm` the visible content collapses to just the `←` glyph, but the
button keeps the same `px-2 py-1` padding used when a text label is present
— so the box shrinks to whatever the glyph plus that small padding measures,
confirmed live at 30×24px. `aria-label` already carries the accessible name
regardless of visible text, so screen-reader/automation access is fine; this
is purely a visual hit-box problem.

## 2. The fix

Add a mobile-only minimum box size, letting `sm:` restore today's exact
padding-driven geometry:

```tsx
<button onClick={() => { void leaveToGames(); }} aria-label={b.backToGames}
  className="flex items-center justify-center gap-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 text-xs text-[--ink-3] hover:text-[--ink-1] shrink-0 rounded-lg border border-[--rp-border] px-2 py-1 hover:bg-[--surface-2] transition-colors">
  <span className="text-sm leading-none">←</span> <span className="hidden sm:inline">{b.backToGames}</span>
</button>
```
`min-h-11 min-w-11` (44px) applies below `sm`; `sm:min-h-0 sm:min-w-0` resets
it at `sm` and up so the desktop button (which already has room via its
visible label) keeps its current compact geometry unchanged. `justify-center`
is added so the glyph centers within the now-larger box rather than sitting
at the flex-start edge.

## 3. Test strategy

No pure logic changes — className values only. Per CLAUDE.md's UI lane:
- Preview check at 375px: back button's `getBoundingClientRect()` ≥44px both
  axes; tapping it still calls `leaveToGames()` and returns to the game
  list.
- Preview check at desktop width (≥640px): button geometry unchanged from
  today (label visible, original padding).
- `npm run i18n:check:strict` — no new strings, should no-op.
