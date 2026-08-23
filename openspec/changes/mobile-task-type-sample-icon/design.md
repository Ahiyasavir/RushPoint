# Design — mobile-task-type-sample-icon

## 1. Current code, audited

`TaskWizard.tsx:861-876`:
```tsx
<button onClick={...}
  className={`w-full flex items-center gap-1.5 rounded-lg border px-2 pe-11 py-1.5 text-start transition-colors ${...}`}>
  <BuilderIcon name={TYPE_ICON_NAME[ty]} className="w-4 h-4 shrink-0" />
  <span className="text-[11px] font-medium truncate">{TYPE_META[ty].label}</span>
</button>
<span className="absolute top-1/2 -translate-y-1/2 end-1 z-10 flex items-center gap-0.5">
  <button type="button" onClick={() => onSampleClick(ty)}
    aria-label={b.loadSampleFor(TYPE_META[ty].label)} title={b.loadSampleFor(TYPE_META[ty].label)}
    aria-expanded={samplePickerFor === ty}
    className="w-4 h-4 rounded-full bg-[--surface-2] text-[--ink-3] text-[10px] leading-none flex items-center justify-center hover:text-rp-fire focus:outline-none focus:ring-1 focus:ring-rp-fire">
    ✨
  </button>
  <RichTooltip title={TYPE_META[ty].label} body={TYPE_META[ty].desc} svg={TYPE_ANIM[ty]} />
</span>
```
The type `<button>` reserves `pe-11` (2.75rem = 44px) of empty end-padding so
its own text/icon never sits under the overlay. The overlay itself
(`absolute ... end-1`) holds the sample button plus a `RichTooltip` trigger,
`gap-0.5` apart. The sample button is `w-4 h-4` = 16px — well inside the 44px
reserved zone, with headroom to grow.

## 2. The fix

Grow the sample button to a real touch target while keeping the ✨ glyph and
overall visual weight modest, and widen the reserve to match:

```tsx
// type button
className={`w-full flex items-center gap-1.5 rounded-lg border px-2 pe-12 py-1.5 text-start ...`}

// sample button, inside the end-1 overlay
className="w-6 h-6 rounded-full bg-[--surface-2] text-[--ink-3] text-[11px] leading-none flex items-center justify-center hover:text-rp-fire focus:outline-none focus:ring-1 focus:ring-rp-fire"
```

## 3. Why 24px and `pe-12`, not 28px at `pe-11` (measured, not assumed)

The first attempt was `w-7 h-7` (28px) with the reserve left at `pe-11`.
Browser measurement at 375px showed why that is wrong: the overlay is
`sample + gap-0.5 (2px) + RichTooltip (16px)` positioned at `end-1` (4px
inset), so the space it needs is `4 + sample + 2 + 16`.

| sample | overlay | needs | `pe-11` (44px) | `pe-12` (48px) |
|---|---|---|---|---|
| 16px (before) | 34px | 38px | fits, 6px slack | — |
| 28px (first try) | 46px | 50px | **overflows by 6px** | overflows by 2px |
| 24px (shipped) | 42px | 46px | overflows by 2px | **fits, 2px slack** |

At 28px/`pe-11` the overlay covered the truncated type label on 2 of the 9
types (`תחנה` by 1px, `מספרי` by 5px). `w-6 h-6` + `pe-12` measured 0 of 9
covered, with 3-11px of clearance on every type. 24px still meets this
change's ≥24px acceptance threshold and is 50% larger than the original.
The cost is 4px less label room per type button; the labels already
`truncate`, so this shortens them slightly rather than breaking layout.

## 4. Test strategy

No pure logic changes — className size values only. Per CLAUDE.md's UI lane:
- Preview check at 375px: confirm the sample button's `getBoundingClientRect()`
  is ≥24px both axes, and that the overlay does not cover the type label on
  ANY of the nine types (measure `label.left - overlay.right` per type; all
  must be > 0). This is the check that caught the 28px overflow in §3.
- `npm run i18n:check:strict` — no new strings, should no-op.
