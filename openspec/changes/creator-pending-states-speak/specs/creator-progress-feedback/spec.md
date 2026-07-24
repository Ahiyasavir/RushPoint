## ADDED Requirements

### Requirement: WalletPage shows a content-shaped skeleton while loading

The creator WalletPage SHALL, while its wallet/plan status is loading and no load error has occurred,
render a content-shaped placeholder that mirrors the loaded layout (a status card and the credit
package grid) built from the shared `Skeleton` primitive — NOT a bare generic spinner. The
error/retry branch and the loaded view SHALL be unchanged, and the skeleton SHALL introduce no new
i18n string (it is text-free).

#### Scenario: Wallet initial load

- **WHEN** a creator opens the Wallet page and the status has not yet loaded and there is no load
  error
- **THEN** the page shows a skeleton shaped like the status card plus a 3-package grid (reusing the
  `Skeleton` primitive), not a bare centered spinner

#### Scenario: Load error still shows the retry card

- **WHEN** the status load fails
- **THEN** the existing error card with the retry button renders exactly as before (the skeleton
  applies only to the no-error loading branch)

### Requirement: Settings save buttons show in-flight motion

Every save/apply button on the creator Settings page SHALL, while its action is in flight, render the
shared `Button`'s animated spinner by passing the button's own busy signal to the `loading` prop, in
addition to the existing label swap and disabled state. Each button MUST pass the busy signal
specific to its own card, and a card whose busy state is a discriminated value MUST pass the matching
predicate so only the acting button spins.

#### Scenario: A single-flag save button

- **WHEN** the creator saves the Profile, Email, Password, or Data (export) card
- **THEN** that button shows the animated spinner (`loading={busy}`) while the action runs, still
  swaps its label, and stays disabled — and no other button spins

#### Scenario: The sign-in-methods card with a discriminated busy value

- **WHEN** the creator triggers add-password or link-Google on the Sign-in Methods card, whose busy
  state is `'password' | 'google' | null`
- **THEN** only the acting button spins (`loading={busy === 'password'}` / `loading={busy ===
  'google'}`), never both, and the string busy value is never coerced to spin an unrelated button
