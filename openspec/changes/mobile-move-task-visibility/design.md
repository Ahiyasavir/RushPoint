# Design — mobile-move-task-visibility

## 1. Current code, audited

`TaskCard.tsx:135-163`:
```tsx
{onMoveToStage && moveTargets && moveTargets.length > 0 && (
  <select
    value=""
    aria-label={b.moveTaskTo}
    ...
    className="shrink-0 w-8 appearance-none text-center cursor-pointer rounded border border-[--rp-border]
      bg-[--surface-2] text-[--ink-3] text-[11px] leading-none px-0 py-0.5 opacity-0
      transition-opacity group-hover/card:opacity-100 focus:opacity-100 focus-visible:opacity-100"
  >
    <option value="">⋯</option>
    {moveTargets.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
  </select>
)}
```
The comment above it (`:132-134`) states the intent — a fallback for
"screen readers / keyboard / tablets" — but `opacity-0` at rest defeats that
for every pointer type that isn't a mouse hovering the card. `w-8` (the
reserved width) is unconditional, so hiding it via opacity saves zero layout
space; it only hides the affordance visually.

## 2. The fix

Change the rest-state opacity from `opacity-0` to a low-but-visible value,
keeping the existing hover/focus escalation to full opacity:

```tsx
className="shrink-0 w-8 appearance-none text-center cursor-pointer rounded border border-[--rp-border]
  bg-[--surface-2] text-[--ink-3] text-[11px] leading-none px-0 py-0.5 opacity-60
  transition-opacity group-hover/card:opacity-100 focus:opacity-100 focus-visible:opacity-100"
```
`opacity-60` keeps the "⋯" glyph legible without competing visually with the
card's primary content (title, type chip) — it reads as a secondary control,
not a hidden one. This is a one-line value change; no new Tailwind variant,
no `matchMedia`/pointer detection needed (the project's `tailwind.config.js`
defines no custom `pointer-*` variant, and inventing one for a single control
is not warranted).

## 3. Test strategy

No pure logic changes — className value edit only. Per CLAUDE.md's UI lane:
- Preview check at 375px: confirm the "⋯" select is visibly present on a
  task card with no hover/focus, confirm tapping it opens the native
  picker and moving a task to another stage still works exactly as before.
- Preview check at desktop width: confirm the card still reads calm at rest
  (opacity-60, not full-strength) and still brightens on hover/focus — no
  visual regression to the "hue is never the only cue" design intent
  documented elsewhere in the file.
- `npm run i18n:check:strict` — no new strings, should no-op.
