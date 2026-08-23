# Design — mobile-touch-target-baseline

## 1. Current code, audited

`ui.tsx:57-63`:
```tsx
<button
  className={`inline-flex items-center justify-center min-h-[40px] px-4 py-2 rounded-xl text-sm ...`}
  ...
```
`min-h-[40px]` is the ONLY height constraint; `Button` is used for every
primary/ghost/danger/subtle action across both apps.

The three close buttons share this exact class string:
```tsx
className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2] text-lg leading-none"
```
(`TaskWizard.tsx:210` — editor close, in a `pb-2 shrink-0` row alongside the
step tabs; `TaskWizard.tsx:551` — map-modal close, in a
`justify-between px-4 py-2.5` header; `BuilderPage.tsx:2788` — stage-settings
close, in a `pb-2 shrink-0` row alongside the panel title).

## 2. The fix

`ui.tsx`: change `min-h-[40px]` to `min-h-[44px]`. One value, no other class
touched — `px-4 py-2` still governs width/vertical rhythm inside that floor,
so buttons with more content than the floor requires are unaffected; only
the shortest buttons (icon-only or single short word) grow by 4px.

The three close buttons: `w-7 h-7` → `w-11 h-11`, `text-lg` glyph unchanged.
Each sits in a `shrink-0` flex slot next to other row content (step tabs /
modal title / panel title) — growing by 16px on each axis needs a live check
that it doesn't crowd the adjacent label at 375px width (task 3 below); if
the editor's step-tab row gets crowded, the fallback is `w-9 h-9` (36px) for
`TaskWizard.tsx:210` specifically, since that row is the most contested
(shares space with 3 tabs), while the modal/panel headers (`:551`, `:2788`)
have a whole row to themselves and can take the full `w-11 h-11`.

## 3. Test strategy

No pure logic changes — className values only. Per CLAUDE.md's UI lane:
- Preview check at 375px: confirm `Button`'s rendered height is ≥44px for a
  short-label button (e.g. wizard "Next"/"Back"); confirm all three close
  buttons measure ≥36px (44px where the row has room) and that none causes
  visible crowding/overlap with adjacent row content.
- Spot-check the Builder's primary action bar (Save / Launch run / undo /
  redo) and the wizard's step tabs at 375px for any layout regression from
  the 4px `Button` height increase.
- `npm run i18n:check:strict` — no new strings, should no-op.
