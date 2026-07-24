# Tasks — creator-pending-states-speak

Presentation-only; no component test runner exists for creator-web, so the RED here is a **failing
visual/expectation statement** verified against the built app, not a `scripts/test-*.ts` (no pure
logic is added — see design.md "Test strategy"). Findings 1 and 2 are independent and may land
separately.

## Finding 1 — WalletPage skeleton

- [x] **RED.** State the expectation that fails today: opening WalletPage while `status` is loading
  shows a bare `<Spinner label={w.loading} />` (`WalletPage.tsx:87`), not a content-shaped skeleton
  like every other creator page. Confirm no other creator page still uses a bare spinner on initial
  load (grep `<Spinner` in `apps/creator-web/src/pages`).
- [x] **GREEN.** Replace the `if (!statusErr) return <Spinner label={w.loading} />;` branch with a
  skeleton mirroring the status card + package grid, built from the existing `Skeleton` primitive
  (`components/ui.tsx:239`) in the `CardSkeletonGrid` idiom (`GalleryPage.tsx:358`): outer
  `max-w-2xl mx-auto animate-fade-up`, a `Card p-6 mb-5` status placeholder (label bar + 2-col figure
  blocks), and a `grid sm:grid-cols-3 gap-3` of 3 `Card`s each with a couple of bars + a full-width
  bar where the buy button sits. Text-free (`aria-hidden` via `Skeleton`).
- [x] **REFACTOR.** If `Spinner` is now unused in WalletPage, drop it from the import to keep lint
  clean; otherwise leave it. Confirm the `statusErr` retry branch and the loaded UI are byte-for-byte
  unchanged.

## Finding 2 — Settings save buttons show motion

- [x] **RED.** State the expectation that fails today: each Settings save button
  (`SettingsPage.tsx` ProfileCard 162, EmailCard 208, PasswordCard 259, SignInMethods 371/382/393,
  DataCard 445) only swaps label + `disabled={busy}` and passes **no** `loading`, so the shared
  `Button` spinner (`ui.tsx:64`, renders only when `loading` is truthy) never animates during a save.
- [x] **GREEN.** Add the per-card `loading` signal to each save button, keeping the existing label
  swap and `disabled`:
  - ProfileCard 162 → `loading={busy}` (busy @136)
  - EmailCard 208 → `loading={busy}` (busy @175)
  - PasswordCard 259 → `loading={busy}` (busy @224)
  - SignInMethodsCard add-password 371 → `loading={busy === 'password'}` (busy @278, string union)
  - SignInMethodsCard link-Google 382 → `loading={busy === 'google'}`
  - SignInMethodsCard reauth confirm 393 → `loading={busy !== null}`
  - DataCard export 445 → `loading={busy}` (busy @419)
- [x] **REFACTOR (optional, consistency).** DeleteAccount confirm CTA (`SettingsPage.tsx:510`, busy
  @476) may also take `loading={busy}` for parity; skip if out of appetite. Confirm no dictionary
  edit and no new i18n key were introduced. — Skipped the optional DeleteAccount CTA; confirmed no
  dictionary edit and no new i18n key introduced.

## Gate (owned by the build agent, not this SDD lane)

- [ ] `npm run typecheck` · `npm run lint` · `npm run creator:build` green.
- [ ] `npm run i18n:check:strict` clean — no new PART B warnings (these edits add none).
- [ ] Visual review: Wallet load shows the skeleton; each Settings save button spins while in flight.
