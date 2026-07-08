# Phase 2 Specs — Tier 0 Foundation primitives

Verification note: RushPoint has **no component test runner** (per CLAUDE.md, UI is verified via
the preview tools + `npm run i18n:check`). Each TDD below is therefore a **behavioral spec +
manual/preview QA checklist** across mobile (375px) and desktop (≥1024px), light + dark
(creator-web) and RTL (Hebrew) where copy is involved. Build gates that MUST stay green:
`npm run typecheck`, `npm run lint`, `npm run creator:build`, `npm run play:build`,
`npm run i18n:check` (+ `:strict` = zero new PART B warnings).

---

## Item 1 — Skeleton primitive + `shimmer` keyframe

### SDD
- **Files:** `apps/creator-web/src/components/ui.tsx`, `apps/creator-web/src/index.css`,
  `apps/play-web/src/components/ui.tsx`, `apps/play-web/src/index.css`.
- **API (both apps):**
  ```tsx
  export function Skeleton({ className = '' }: { className?: string })
  ```
  Renders `<div aria-hidden="true" className="rp-skeleton rounded-xl {className}" />`.
  Callers set size via `className` (e.g. `h-4 w-24`, `h-32`).
- **Token / CSS:** add to each `index.css`:
  ```css
  .rp-skeleton {
    position: relative;
    overflow: hidden;
    background: <surface-2 equivalent>;
  }
  .rp-skeleton::after {
    content: '';
    position: absolute; inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(90deg, transparent, <highlight>, transparent);
    animation: rp-shimmer 1.4s ease-in-out infinite;
  }
  @keyframes rp-shimmer { 100% { transform: translateX(100%); } }
  @media (prefers-reduced-motion: reduce) { .rp-skeleton::after { animation: none; } }
  ```
  - creator-web base `var(--surface-2)`, highlight `rgba(255,255,255,0.06)` (works both modes
    over the translucent glass).
  - play-web base `#FFF0E0` (`app-raised`), highlight `rgba(255,255,255,0.6)`.
- **Design fit:** rounded-xl matches existing radii; no new colors beyond existing tokens.
- **States:** purely presentational; no loading/empty/error branching of its own.
- **Responsive:** size-agnostic (driven by caller classes); full-width by default via caller.

### TDD / QA
- [ ] Renders a shimmering block at the size given by `className` (e.g. `h-4 w-32`).
- [ ] `prefers-reduced-motion: reduce` → shimmer stops, static block remains (preview: emulate reduced motion).
- [ ] Dark mode (creator-web): visible against `--surface-0` card bg, not pure-black invisible.
- [ ] play-web: warm-tinted, visible against `#FFFCF7` page bg.
- [ ] `aria-hidden="true"` present (screen readers skip it). Verify via preview snapshot/inspect.
- [ ] typecheck + both builds green.

---

## Item 2 — Button a11y + loading state

### SDD
- **Files:** `apps/creator-web/src/components/ui.tsx`, `apps/play-web/src/components/ui.tsx`.
- **API additions (both):** extend Button props with `loading?: boolean`.
  - When `loading`: set `disabled` (OR existing disabled), `aria-busy="true"`, render a small
    inline spinner before `children`, keep label visible (no layout jump — spinner is `me-2`).
  - Reuse the existing spinner ring markup (creator: `border-2 border-current/30 border-t-current`,
    sized `w-4 h-4`; play-web same, `w-5 h-5`).
- **Focus-visible:** append to the shared className string in BOTH buttons:
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[--surface-1]`
  (creator) / `focus-visible:ring-offset-app-bg` (play). Use `focus-visible`, not `focus`, so
  mouse clicks don't show the ring.
- **Tap target:** creator Button is `py-2` (~34px) — raise to `min-h-[40px]`; play-web already 56px.
- **Reduced motion:** spinner uses `animate-spin`; add `motion-reduce:animate-[spin_1.5s_linear_infinite]`
  is unnecessary — instead leave spin (essential feedback) but it's small; acceptable. No hover
  transform to gate.
- **Design fit:** no new tokens; spinner inherits `currentColor` so it works on every variant.

### TDD / QA
- [ ] `<Button loading>Save</Button>` shows spinner + label, is non-interactive, `aria-busy="true"`.
- [ ] Keyboard Tab to any button → visible fire ring; mouse click → no ring.
- [ ] creator primary/ghost/danger/subtle + play primary/ghost/danger all still render correctly.
- [ ] Button height ≥40px (creator) at default padding — inspect bounding box in preview.
- [ ] Existing callers with no `loading` prop unchanged (default false).
- [ ] typecheck + both builds + lint green.

---

## Item 3 — Toast system (creator-web)

### SDD
- **Files:** new `apps/creator-web/src/components/toast.tsx`; mount `<ToastHost/>` in `App.tsx`
  (next to `<DialogHost/>`); i18n append block for default labels if needed.
- **Pattern:** mirror the existing `dialog.tsx` module singleton (module-level `listener`, a
  `toast.show()` imperative API) so any call site can fire without prop-drilling and it works
  outside React tree, consistent with the codebase's existing dialog approach.
  ```ts
  export const toast = {
    success(msg: string): void,
    error(msg: string): void,
    info(msg: string): void,
  }
  export function ToastHost(): JSX.Element | null
  ```
- **Behavior:** stack of ≤3 toasts, bottom-center on mobile / bottom-right on desktop
  (`fixed bottom-4 inset-x-0 sm:inset-x-auto sm:end-4`), each auto-dismisses after 3.2s,
  manual dismiss via an ✕ button (`aria-label` from i18n). `role="status"` + `aria-live="polite"`
  container so SR users hear it. Enter animation reuses `animate-fade-up` (already in creator).
- **Styling:** a `Card`-like surface with a 3px start-border colored by kind
  (`--rp-go` success, `--rp-alert` error, `--rp-plasma` info). z-50, above content, below dialog (dialog is z-50 modal — toasts should not block; place at z-40).
- **States:** success/error/info variants; empty (host renders null when queue empty).
- **Responsive:** full-width minus margins on mobile, max-w-sm pinned bottom-end on ≥sm.

### TDD / QA
- [ ] `toast.success('Saved')` → green-bordered toast appears bottom, auto-dismisses ~3.2s.
- [ ] Firing 4 rapidly → only newest 3 shown, oldest drops.
- [ ] ✕ dismisses immediately; has `aria-label`.
- [ ] `aria-live="polite"` region announces text (preview snapshot shows role=status).
- [ ] Does not trap focus or block clicks on the page behind it.
- [ ] RTL: toast pins to bottom-start correctly (uses logical `end-4`).
- [ ] i18n:check clean (dismiss label routed through `t.*`).

---

## Item 4 — EmptyState primitive (creator-web)

### SDD
- **File:** `apps/creator-web/src/components/ui.tsx` (co-located with other primitives).
- **API:**
  ```tsx
  export function EmptyState({ icon, title, body, action }: {
    icon?: ReactNode; title: string; body?: string; action?: ReactNode;
  })
  ```
  Centered column: large icon (emoji or node, `text-4xl`, `aria-hidden` wrapper), `title`
  (`text-lg font-semibold text-[--ink-1]`), optional `body` (`text-sm text-[--ink-3] max-w-sm`),
  optional `action` slot (caller passes a `<Button>`). Wrapped in padding `py-16 px-6`.
- **Design fit:** matches the existing inline Dashboard empty-state look so replacing it is 1:1.
- **Consumers in Phase 3:** Gallery no-results, Runs-overview no-runs. Dashboard keeps its richer
  bespoke hero (out of scope to refactor) but MAY adopt later.
- **States:** static; the `action` is optional so it also serves pure "nothing here" cases.

### TDD / QA
- [ ] Renders icon/title/body/action; omitting optional props hides those rows cleanly.
- [ ] Text is centered, body width-capped, readable in light + dark.
- [ ] Icon wrapper `aria-hidden`; title is a real heading-weight element.
- [ ] typecheck + build green.
