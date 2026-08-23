# Proposal — mobile-slidepanel-keyboard-avoidance

## Why

The Builder's root shell is sized with `h-screen` (`App.tsx:90`,
`isBuilder ? 'h-screen overflow-hidden flex flex-col' : ...`). `h-screen` is
Tailwind's `height: 100vh` — on mobile Safari, `100vh` is fixed to the
**largest** possible viewport (browser chrome collapsed) and does **not**
shrink when the on-screen keyboard opens or the URL bar reappears. Combined
with `overflow-hidden` on that same shell, content sized against this
oversized `100vh` can extend below what is actually visible once the
keyboard is up — the textbook "keyboard covers the input" failure on iOS
Safari, and exactly the risk flagged for the task editor's bottom-pinned
`SlidePanel` (`BuilderPage.tsx:2724-2739`), whose own fixed-bottom sheet sits
inside this same `h-screen` shell.

This is not a guess: the codebase already recognizes and works around this
exact issue elsewhere — `GalleryGameDetailModal.tsx:142` and
`GalleryTaskDetailModal.tsx:122` both use `max-h-[88dvh]` (the modern
dynamic-viewport unit that DOES track the visible area), while the Builder's
own shell was never migrated to it.

## What Changes

- `App.tsx:90` — the Builder shell's `h-screen` becomes a new `rp-h-dvh`
  class (`index.css`), which sizes to `100vh` unconditionally and upgrades
  to `100dvh` only inside an `@supports (height: 100dvh)` block. This is
  NOT the same as pairing `h-screen h-dvh` as two Tailwind utilities —
  see design.md §2 for why that first attempt was actually a no-op (the
  compiled CSS order makes `h-screen` win regardless of browser support)
  and why `@supports` is the version that ships.

## Non-goals

- Does not add a `visualViewport`-driven scroll-into-view handler — the root
  cause here is the oversized viewport unit, not a missing JS workaround;
  fixing the unit is the smaller, more standard, precedented fix.
- Does not touch the non-Builder shell (`min-h-screen`, used by every other
  route) — `min-h-screen` grows with content and does not have this failure
  mode the way a hard `h-screen` + `overflow-hidden` combination does.
- Does not change `SlidePanel`'s own fixed-position/height classes — they
  are already sized relative to the shell; fixing the shell's unit fixes
  what they inherit.

## Surfaces touched

`apps/creator-web` only (`App.tsx`). No callable, no shared type.
