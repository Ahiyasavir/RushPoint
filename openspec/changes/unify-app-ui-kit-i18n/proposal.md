## Why

The two web apps each keep their **own divergent copy** of three cross-cutting concerns, and the
copies have already drifted:

- **UI kit.** `apps/creator-web/src/components/ui.tsx` (~201 lines) and
  `apps/play-web/src/components/ui.tsx` (~113 lines) each re-implement `Button` / `Card` / `Input`
  / `Badge` / `Spinner` / `Skeleton` / `EmptyState` with **different props and different markup**.
  For example creator-web's `Button` accepts `variant: 'primary' | 'ghost' | 'danger' | 'subtle'`
  and is inline-auto-width; play-web's `Button` accepts `variant: 'primary' | 'ghost' | 'danger'`
  and is always full-width. `Skeleton` is literally copy-pasted (same JSX, two files). Every fix
  or a11y improvement has to be made twice and is routinely made once.
- **i18n.** `apps/creator-web/src/i18n.ts` (~1385 lines) and `apps/play-web/src/i18n.ts`
  (~823 lines) are **fully separate dictionaries with no shared base.** Truly-common strings — the
  brand name, generic actions (`cancel` / `confirm` / `ok` / `close`), and the identical error
  boundary copy (`errorTitle` / `errorBody` / `tryAgain` / `reload`, which are already
  word-for-word duplicated across both apps in both languages) — can silently drift between the
  apps because nothing ties them together.
- **Chat thread UI.** The HQ↔team chat thread (snapshot listener, unread bookkeeping,
  expand/collapse, message bubbles, reply box) is **near-duplicated** between
  `apps/creator-web/src/pages/RunConsolePage.tsx` (`ChatConsole`, ~100 lines) and
  `apps/play-web/src/screens/StaffConsole.tsx` (`StaffChatSection`, ~120 lines). The logic is
  identical; only theme classes and a `senderName` argument differ.

The hard constraint that makes this non-trivial (and is why it was left duplicated): **the two
apps use different themes.** creator-web is dark; play-web is light and **reverses the Tailwind
zinc scale** (so `text-zinc-100` reads dark-on-light there). A naive shared component that
hardcodes zinc shades or a fixed gradient would look correct in one app and broken in the other.
Any unification must be theme-agnostic — driven by semantic tokens / props, not baked-in palette.

## What Changes

- **Introduce a single-sourced, theme-agnostic UI primitive layer** (a new `packages/ui`
  workspace) that both apps consume. Primitives are styled through **semantic CSS variables /
  Tailwind tokens** that each app already defines per theme (creator: `--surface-*` / `--ink-*` /
  `rp-*`; play: `app-bg` / `glass-border` / reversed zinc), plus a small set of variant props —
  so one component renders correctly under both themes without knowing which theme it is in.
  Genuinely per-app primitives (e.g. play-web's `Progress` / `Screen`, creator-web's `Advanced`)
  stay in the app; only the ones with a shared shape move.
- **Extract a shared `ChatThread` component** into `packages/ui`, parameterized by the
  theme-token classes and the optional `senderName`, and have both `ChatConsole` and
  `StaffChatSection` render it — deleting the duplicated markup while preserving each app's look.
- **Introduce a shared base translation dictionary** in `@rushpoint/shared` for the truly-common
  keys (brand, generic actions, error-boundary copy) in both `he` and `en`. Each app's
  `translations` **extends** the base and adds its own app-specific namespaces, so the common
  strings have exactly one source of truth while each app keeps full control of everything else.
- **No behavior change, no new callable, no Firestore/schema change.** This is a structural
  (refactor) change: the rendered UI and the displayed copy stay pixel- and word-identical in both
  apps and both languages; only where the code lives changes.

## Capabilities

### New Capabilities
- `shared-app-foundation`: establishes the invariants that common UI primitives, the chat thread
  component, and truly-common translation keys are single-sourced across the two apps **while
  each app's theme and app-specific copy remain independent.**

### Modified Capabilities
(none — no existing behavioral spec changes; this adds structural invariants only.)

## Impact

- **New workspace** `packages/ui` — theme-agnostic React primitives (`Button`, `Card`, `Input`,
  `Textarea`, `Select`, `Label`, `Badge`, `Skeleton`, `EmptyState`) + the shared `ChatThread`.
  React is a **peer dependency** (never bundled). Consumed by both apps.
- **`@rushpoint/shared`** — gains an i18n base module (`i18nBase.ts`, plain data, no React) with
  the common `he`/`en` keys and a helper to merge it into an app dictionary.
- **`apps/creator-web/src/components/ui.tsx`** — re-exports the shared primitives (keeping its
  local `Advanced`, and any creator-only variant), so existing imports don't churn.
- **`apps/play-web/src/components/ui.tsx`** — same: re-exports shared primitives, keeps local
  `Progress` / `Screen`.
- **`apps/creator-web/src/pages/RunConsolePage.tsx`** and
  **`apps/play-web/src/screens/StaffConsole.tsx`** — `ChatConsole` / `StaffChatSection` become
  thin wrappers over the shared `ChatThread`.
- **`apps/creator-web/src/i18n.ts`** and **`apps/play-web/src/i18n.ts`** — spread the shared base
  into the `common` namespace of each language, dropping the duplicated literals.
- **Surfaces touched:** shared (`packages/shared` + new `packages/ui`) · creator-web · play-web.
  **NOT touched:** functions/, firestore.rules, any callable, any Firestore path or schema.
- **Gates:** `npm run creator:build` + `npm run play:build` must stay green (both apps still
  compile against the moved code); `npm run i18n:check` (and `:strict`) must stay clean through the
  dictionary refactor (PART A HE/EN parity + purity per app is preserved); `npm run typecheck`,
  `npm run lint`, `npm test`, `npm run e2e` unaffected but must remain green.

## Non-goals

- **Not** forcing a single visual theme. creator-web stays dark; play-web stays light with its
  reversed zinc scale. The shared primitives are explicitly theme-agnostic — this change preserves
  both looks exactly, it does not homogenize them.
- **Not** unifying app-specific components or namespaces (creator-web's `Advanced`, play-web's
  `Progress` / `Screen`; per-app translation namespaces like `runConsole`, `join`, `promo`).
- **Not** a redesign, a new design system, or new components — like-for-like extraction only.
- **Not** changing any user-facing string's wording or any component's rendered output. If a byte
  of copy or a pixel of layout changes in either app, that is a regression, not this change.
- **Not** touching backend, callables, routing, scoring, rules, or Firestore data.
