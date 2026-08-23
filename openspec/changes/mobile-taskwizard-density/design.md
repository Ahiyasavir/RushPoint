# Design — mobile-taskwizard-density

## 1. Current code, audited

`ui.tsx:78-93`:
```tsx
export function Input({ className = '', dense = false, ...rest }: ...) {
  return (
    <input
      className={`
        w-full ${dense ? 'px-2.5 py-1.5 rounded-lg text-[13px]' : 'px-3.5 py-2.5 rounded-xl text-sm'}
        ...
      `}
      {...rest}
    />
  );
}
```
`Textarea` (`:96-111`) mirrors the same `dense` ternary. `Select` (`:114-131`)
has NO `dense` prop at all — it only ever renders the non-dense
`px-3.5 py-2.5` geometry. A repo-wide check confirms TaskWizard never
imports/uses `<Select>` — its choice controls are all custom
`<button className="... py-1.5 ...">` toggle groups, which are a different
control class (already covered by the touch-target-baseline change where a
specific instance was found broken) and out of scope for this density pass.

`dense` is documented as "the Task Builder variant: tighter chrome so a
stack of collapsed sections reads as a compact list" (`Advanced` component
comment, `ui.tsx:198-200`) and, for `Input`/`Textarea`, "a compact control —
used by the Task Builder so a form of many small fields fits on screen
without scrolling" (`:73-77`). This is a deliberate, documented tradeoff —
the fix must not undo it, only soften it.

## 2. The fix

```tsx
${dense ? 'px-2.5 py-2 rounded-lg text-[13px]' : 'px-3.5 py-2.5 rounded-xl text-sm'}
```
`py-1.5` (6px) → `py-2` (8px) on both `Input` and `Textarea`'s `dense`
branch — the smallest change that measurably grows every dense field's tap
target (~5-6px taller per field) while keeping the font size, horizontal
padding, and the "many fields, no scroll" intent unchanged. This is a lower
target than the 44px guideline used for buttons deliberately: text fields
carry lower touch-target risk (a mis-tap re-focuses rather than mis-fires an
action), and TaskWizard's own comments make clear that preserving density
here is a considered tradeoff, not an oversight.

## 3. Test strategy

No pure logic changes — a single padding value on a shared component. Per
CLAUDE.md's UI lane:
- Preview check at 375px: open the TaskWizard's Details/Execution steps for
  a field-heavy task type (e.g. `quiz`), confirm dense fields visibly grow
  without the step needing to scroll where it didn't before (spot-check
  against the step that has the most fields, so a regression to "now it
  scrolls" would be caught).
- `npm run i18n:check:strict` — no new strings, should no-op.
