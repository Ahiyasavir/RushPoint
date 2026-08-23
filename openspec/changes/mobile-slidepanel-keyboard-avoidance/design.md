# Design — mobile-slidepanel-keyboard-avoidance

## 1. Current code, audited

`App.tsx:90`:
```tsx
<div className={`relative bg-[--surface-1] dark:bg-[--surface-0] text-[--ink-1] transition-colors duration-250 ${isBuilder ? 'h-screen overflow-hidden flex flex-col' : 'min-h-screen overflow-x-clip'}`}>
```
`isBuilder` routes get `h-screen overflow-hidden flex flex-col` — a hard,
non-scrolling viewport-height shell (documented in
`hooks/liveRunsPolling.ts:70` and `components/ActiveRunBar.tsx:19` as "the
Builder is an `h-screen overflow-hidden` 3-pane workspace"). `BuilderPage.tsx`'s
`SlidePanel` (`:2724-2739`) is `max-lg:fixed max-lg:bottom-0` inside this
shell — it anchors to the shell's own bottom edge, which on mobile Safari is
`100vh` from the top, i.e. the height with the keyboard **closed**. When the
keyboard opens, the visual viewport shrinks but this element's positioning
context does not, so a field near the bottom of the sheet can end up behind
the keyboard.

The codebase already has the fix pattern in production: `GalleryGameDetailModal.tsx:142`
and `GalleryTaskDetailModal.tsx:122` both size against `max-h-[88dvh]` — `dvh`
(dynamic viewport height) is the CSS unit that tracks the *actual* visible
viewport, keyboard included, exactly the browser feature that doesn't exist
in `vh`.

## 2. The fix, and a wrong first attempt worth recording

The first attempt paired the two Tailwind utility classes directly —
`h-screen h-dvh` — reasoning that a browser without `dvh` support would drop
that one invalid declaration and fall back to the `h-screen` rule, matching
the standard hand-written CSS fallback idiom (`height: 100vh; height:
100dvh;`). **That reasoning does not transfer to two separate utility
classes.** A code-review pass caught it before this reached the working
tree unverified: inspecting the actual PRODUCTION build's compiled CSS
(`apps/creator-web/dist/assets/index-*.css`) showed `.h-dvh{height:100dvh}`
is emitted **before** `.h-screen{height:100vh}` in this build — the opposite
of what the fallback idiom needs. Two classes of equal specificity resolve
by the LATER rule in the stylesheet, so pairing them would have made
`h-screen` always win, on every browser, silently discarding the entire
point of the change while looking like a fix. (Tailwind's utility emission
order is an implementation detail of the JIT engine, not a documented
contract — assuming it without checking the compiled output was the actual
mistake, not the fallback idiom itself.)

The fix that ships instead uses `@supports`, which is unambiguous
regardless of any utility ordering — `index.css`:
```css
.rp-h-dvh {
  height: 100vh;
}
@supports (height: 100dvh) {
  .rp-h-dvh {
    height: 100dvh;
  }
}
```
`App.tsx:90`:
```tsx
${isBuilder ? 'rp-h-dvh overflow-hidden flex flex-col' : 'min-h-screen overflow-x-clip'}
```
`overflow-hidden flex flex-col` and every downstream layout (`SlidePanel`,
the 3-pane workspace) is unchanged. Confirmed in the compiled CSS: `.rp-h-dvh{height:100vh}@supports (height: 100dvh){.rp-h-dvh{height:100dvh}}`
— the unconditional `100vh` rule first, the `100dvh` upgrade gated behind
an explicit feature query second, so a browser without `dvh` support simply
never enters the `@supports` block rather than depending on rule order.

## 3. Test strategy

No pure logic changes — a single Tailwind unit token. Per CLAUDE.md's UI
lane, and given this environment's browser tooling cannot simulate a real
iOS software keyboard (confirmed while investigating — Chromium-based
preview tooling does not shrink the visual viewport for a synthetic
keyboard), verification is code-level plus non-keyboard regression checks:
- Confirm `h-dvh` computes to the same pixel height as `h-screen` did with
  no keyboard open, on both desktop and the 375px mobile preview (no visual
  regression when the keyboard is NOT up — the two units only diverge when
  it is).
- Confirm the Builder's 3-pane workspace, header, and `SlidePanel` all still
  render at full height / correct fixed-bottom position after the swap.
- Note in the change's own record that keyboard-open behavior specifically
  could not be verified in this environment and should be spot-checked on a
  real iOS device opportunistically; the fix itself is a direct application
  of a pattern already proven correct elsewhere in this same codebase
  (`GalleryGameDetailModal.tsx`, `GalleryTaskDetailModal.tsx`), so it is not
  speculative.
- `npm run i18n:check:strict` — no new strings, should no-op.
