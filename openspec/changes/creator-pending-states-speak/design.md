# Design — creator-pending-states-speak

Presentation-only. Two independent edits, both reusing primitives already in the console. No new
logic, no new i18n keys, no backend.

## Confirmed anchors (grepped, not assumed)

- **WalletPage** `apps/creator-web/src/pages/WalletPage.tsx:86-87`
  ```
  if (!status) {
    if (!statusErr) return <Spinner label={w.loading} />;
  ```
  The `statusErr` retry branch (lines 88-96) and the loaded UI (status card at 106-132, package grid
  at 140+) stay untouched — only the `!statusErr` bare-spinner branch is replaced.

- **`Skeleton` primitive** `apps/creator-web/src/components/ui.tsx:239`
  `export function Skeleton({ className }) { return <div aria-hidden className={`rp-skeleton rounded-xl ${className}`} /> }`.
  The shimmer **and reduced-motion handling live in `index.css` (`.rp-skeleton`)** — the note in
  ui.tsx:237-238 states this — so reusing `Skeleton` inherits `prefers-reduced-motion` correctly with
  no extra work.

- **Established skeleton pattern** to mirror: `GalleryPage.tsx:358` `CardSkeletonGrid()` (a `.map`
  over `Card`s each holding a few `Skeleton` bars), `DashboardPage.tsx:770` `DashboardSkeleton`,
  `RunsOverviewPage` rows.

- **`Button` `loading` prop** `apps/creator-web/src/components/ui.tsx:29-66`: signature accepts
  `loading?: boolean`; at line 60 `disabled={disabled || loading}`, line 61 `aria-busy`, lines 64-66
  render the animated spinner **only when `loading` is truthy**. WalletPage buys already pass it:
  `WalletPage.tsx:153` `loading={busy === id}`.

## Finding 1 — WalletPage skeleton

Replace the single line `if (!statusErr) return <Spinner label={w.loading} />;` with a return of a
small local skeleton component (or inline JSX) that mirrors the loaded layout:

- Same outer wrapper as the loaded view: `<div className="max-w-2xl mx-auto animate-fade-up">`.
- A **status Card** (`<Card className="p-6 mb-5">`) holding: one `Skeleton` bar for the plan
  label/badge row, and a 2-column grid of two tall `Skeleton` blocks mirroring the credits /
  free-runs figures (`grid grid-cols-2 gap-4`).
- A **package grid** mirroring the real one (`grid sm:grid-cols-3 gap-3`) with 3 `Card`s, each
  holding a couple of `Skeleton` bars + a full-width `Skeleton` where the buy `Button` sits — exactly
  the `CardSkeletonGrid` idiom, sized to 3 packages.

This is text-free (all `Skeleton`, `aria-hidden`), so **no i18n**. `w.loading` is simply no longer
read on this branch; leave the key in the dictionary (still used elsewhere / harmless).

`Spinner` may become unused in WalletPage after this — remove it from the import if so, to keep the
lint clean; if `Spinner` is still referenced elsewhere in the file, leave the import.

## Finding 2 — Settings save buttons get `loading`

Each save button already computes the right busy signal and swaps its label; add `loading=<that
signal>` so the shared spinner animates. **Per-card busy variables confirmed by grep** (each card has
its own local `busy` state):

| Card (approx line) | Button line(s) | busy state decl | `loading` to add |
|---|---|---|---|
| ProfileCard | `Button` 162 (`{busy ? s.nameSaving : s.nameSave}`) | `const [busy,setBusy]=useState(false)` @136 | `loading={busy}` |
| EmailCard | `Button` 208-209 | `useState(false)` @175 | `loading={busy}` |
| PasswordCard | `Button` 259-260 | `useState(false)` @224 | `loading={busy}` |
| SignInMethodsCard — add-password | `Button` 371-372 (`busy === 'password' ? …`) | `useState<'password'\|'google'\|null>(null)` @278 | `loading={busy === 'password'}` |
| SignInMethodsCard — link-Google | `Button` 382-383 (`busy === 'google' ? …`) | same @278 | `loading={busy === 'google'}` |
| SignInMethodsCard — reauth confirm | `Button` 393 (`busy !== null` disabled) | same @278 | `loading={busy !== null}` |
| DataCard — export | `Button` 445-446 (`busy ? s.dataExporting : s.dataExportBtn`) | `useState(false)` @419 | `loading={busy}` |

Note the SignInMethodsCard `busy` is a **discriminated string** (`'password' | 'google' | null`), so
its buttons must pass the **specific** predicate (`busy === 'password'`, `busy === 'google'`) — NOT a
bare `loading={busy}`, which would spin both buttons at once and coerce a string to truthy. The
DeleteAccount confirm button (`SettingsPage.tsx:510`, its own `busy` @476) is a destructive-modal CTA
outside the "save" set the finding names; it is optional — if included it takes `loading={busy}`. The
tasks list it as an optional consistency add, not a required step.

Keep every existing `disabled={…}` and label-swap exactly as-is; `loading` is purely additive.

## i18n

**Zero new keys, zero dictionary edits.** Finding 1's skeleton renders no text; Finding 2 reuses each
card's existing label pair. Because no UI *string* changes, this needs no new copy — but any UI touch
still runs `npm run i18n:check:strict` in the gate lane (owned by the build agent), and it must stay
clean (no new PART B hardcoded-string warnings — the edits add none).

## Test strategy

Presentation-only; creator-web has **no component test runner** (per CLAUDE.md, UI is verified via
preview). No pure helper is warranted — both edits are pure reuse of existing primitives (`Skeleton`,
`Button`), introducing **no new logic**, so there is **no new `scripts/test-*.ts`** and nothing for
the pure-logic aggregator to cover. Verification is the standard gate set the build agent runs
(`typecheck` · `lint` · `creator:build`, plus `i18n:check:strict`) and visual review of the two
screens: Wallet load shows a content-shaped skeleton; each Settings save button shows the animated
spinner while in flight. Reduced-motion is already handled by `.rp-skeleton` in `index.css` and by
the shared `Button` spinner; nothing new to test there.
