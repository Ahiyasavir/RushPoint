## Why

The user's top UX priority, stated twice, verbatim: pressing something and seeing a bare wait "is
very confusing because nothing is not happenning basically" and we should "not only show loading
because its boring and not inviting." We are rolling **branded, visible progress** across the app so
every in-flight action shows content-shaped motion, not a dead spinner or a frozen button.

A read-only hunt found **two** remaining dead-wait gaps in the **creator console** — both P2, both
presentation-only. Closing them completes the creator-side branded-progress rollout (the two waits a
creator hits outside a live run: opening the Wallet, and saving in Settings).

**Scope guard:** this change is explicitly **separate from `creator-launch-liftoff`**, which owns the
launch-run wait. There is **no overlap** — that change never touches WalletPage or SettingsPage, and
this one never touches the launch flow.

## What Changes

- **Finding 1 — WalletPage initial load.** `apps/creator-web/src/pages/WalletPage.tsx:87` returns a
  bare generic `<Spinner label={w.loading} />` while `status` loads. This is the page where a creator
  spends money and it is the deadest wait in the console — every other creator page already shows a
  content-shaped skeleton. Replace the bare spinner with a small skeleton mirroring the status card +
  package grid, reusing the existing `Skeleton` primitive (the established pattern:
  `GalleryPage` `CardSkeletonGrid`, `DashboardPage` `DashboardSkeleton`, `RunsOverviewPage` rows).

- **Finding 2 — Settings save buttons.** The shared `Button`
  (`apps/creator-web/src/components/ui.tsx:64`) renders an animated spinner **only** when `loading`
  is passed. WalletPage/DashboardPage/GalleryPage all pass it and get motion; the Settings save
  buttons never do — they only swap label text + `disabled={busy}`, so an in-flight save shows no
  visible motion. Add `loading={busy}` (the correct per-card busy signal) to each Settings save
  button, keeping the existing label swap.

- **Copy / logic:** none. This reuses existing `Skeleton` and `Button` behaviour and existing i18n
  labels. **Zero new i18n keys.** No new pure logic, no backend, no new tests scripts.

## What does NOT change

- **No overlap with `creator-launch-liftoff`** — the launch-run wait is out of scope here.
- No new i18n keys, no dictionary edits (the WalletPage skeleton is text-free; Settings reuses its
  existing `*Save`/`*Saving`, `*Btn`/`*Busy`, `dataExport*` labels).
- No component runner exists for creator-web; verification is the existing gate set (typecheck/build)
  plus visual review, consistent with prior presentation-only creator changes.
- No backend, no `packages/shared`, no play-web change.

## Impact

- `apps/creator-web/src/pages/WalletPage.tsx` — replace the bare spinner branch with a skeleton
  (reuses `Skeleton` from `components/ui.tsx`).
- `apps/creator-web/src/pages/SettingsPage.tsx` — add `loading={<per-card busy>}` to the save buttons.
- **Not touched:** `apps/creator-web/src/i18n.ts`, `apps/creator-web/src/components/ui.tsx`,
  `functions/`, `packages/shared`, `apps/play-web`, and the `creator-launch-liftoff` launch flow.
