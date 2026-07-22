## ADDED Requirements

### Requirement: Settings shows the active sign-in methods
The creator Settings page SHALL show a "Sign in methods" card that lists, for the signed in account,
every supported sign-in method (email and password, Google) together with whether it is currently
active. The list SHALL be derived from the account's own provider data, not from which form happens
to be rendered.

#### Scenario: Google-only account
- **WHEN** the signed in account's providers are `['google.com']`
- **THEN** the card SHALL show Google as active and email and password as not active

#### Scenario: Password-only account
- **WHEN** the signed in account's providers are `['password']`
- **THEN** the card SHALL show email and password as active and Google as not active

#### Scenario: Both methods linked
- **WHEN** the signed in account's providers are `['password', 'google.com']`
- **THEN** the card SHALL show both as active

#### Scenario: Provider order is irrelevant
- **WHEN** the same providers are reported in any order, with unknown provider ids present
- **THEN** the reported status SHALL be identical and unknown provider ids SHALL be ignored

### Requirement: Only applicable actions are offered
The card SHALL offer "Add a password" only when the account has no `password` provider, and "Link
Google" only when the account has no `google.com` provider. When both methods are already active the
card SHALL offer neither action and SHALL say the account is fully covered.

#### Scenario: Google-only account is offered a password
- **WHEN** providers are `['google.com']`
- **THEN** "Add a password" SHALL be offered and "Link Google" SHALL NOT be offered

#### Scenario: Password-only account is offered Google
- **WHEN** providers are `['password']`
- **THEN** "Link Google" SHALL be offered and "Add a password" SHALL NOT be offered

#### Scenario: Fully linked account is offered nothing
- **WHEN** providers are `['password', 'google.com']`
- **THEN** neither action SHALL be offered

### Requirement: A Google account can gain a password
A creator whose account has no password credential SHALL be able to set one from Settings by
supplying a new password and a confirmation, without being asked for a current password. On success
the account SHALL have both providers and the creator SHALL be able to sign in with either.

#### Scenario: Password is set
- **WHEN** a Google-only creator submits a valid new password twice identically
- **THEN** an email and password credential SHALL be linked to the same account, the account uid
  SHALL be unchanged, and the card SHALL report both methods as active

#### Scenario: Password too short
- **WHEN** the submitted password is shorter than 8 characters
- **THEN** the action SHALL be refused locally with the translated minimum-length message and no
  Firebase call SHALL be made

#### Scenario: Confirmation does not match
- **WHEN** the confirmation field differs from the new password
- **THEN** the action SHALL be refused locally with the translated mismatch message and no Firebase
  call SHALL be made

### Requirement: Google may only be linked to the same email address
Linking Google SHALL be accepted only when the email address carried by the chosen Google identity
equals the signed in account's email address. Comparison SHALL ignore surrounding whitespace and
letter case. If either address is missing or empty, the link SHALL be refused.

#### Scenario: Same address, different case and padding
- **WHEN** the account email is `Creator@Example.com` and the Google identity reports
  `  creator@example.com `
- **THEN** the link SHALL be accepted

#### Scenario: A different Google account
- **WHEN** the account email is `a@x.com` and the chosen Google identity reports `b@y.com`
- **THEN** the link SHALL be refused, and the message shown SHALL name both addresses so the creator
  knows which Google account to switch to

#### Scenario: Missing Google email
- **WHEN** the Google identity reports no email, or an empty string
- **THEN** the link SHALL be refused rather than treated as a match

#### Scenario: Missing account email
- **WHEN** the signed in account has no email address
- **THEN** the link SHALL be refused rather than treated as a match

### Requirement: A refused link leaves the account unchanged
When a Google link is refused for a mismatched email, the account SHALL end in exactly the state it
was in before the attempt: no `google.com` provider present that was not present before, the primary
email unchanged, and the session still signed in as the same uid. Where the platform applies the link
before the outcome can be inspected, the link SHALL be rolled back by unlinking the provider before
the refusal is reported.

#### Scenario: Mismatch detected after the platform already linked
- **WHEN** the link has already been applied by Firebase and the resulting Google email does not match
- **THEN** `google.com` SHALL be unlinked from the account and the refusal SHALL be reported

#### Scenario: Mismatch detected before anything is applied
- **WHEN** the chosen Google identity is known before the link is applied and does not match
- **THEN** no link SHALL be attempted and no rollback SHALL be needed

#### Scenario: Account already had Google linked
- **WHEN** the account already had a `google.com` provider before the attempt
- **THEN** rollback SHALL NOT unlink that pre-existing provider

#### Scenario: Rollback itself fails
- **WHEN** the rollback unlink fails
- **THEN** the creator SHALL be told, in translated copy, that the account may be in an unexpected
  state and to retry, rather than being shown a success

### Requirement: Firebase failures reach the creator as translated sentences
Every Firebase Auth error code these flows can produce SHALL be mapped to a specific translated
message. No raw Firebase error text SHALL be rendered. Codes covered SHALL include
`auth/credential-already-in-use`, `auth/email-already-in-use`, `auth/provider-already-linked`,
`auth/popup-closed-by-user`, `auth/cancelled-popup-request`, `auth/popup-blocked`,
`auth/requires-recent-login`, `auth/weak-password`, `auth/network-request-failed`,
`auth/wrong-password`, `auth/invalid-credential` and `auth/too-many-requests`. Any unrecognised code
SHALL fall back to a translated generic message.

#### Scenario: Another account already owns that Google identity
- **WHEN** linking fails with `auth/credential-already-in-use`
- **THEN** the creator SHALL be told that Google account is already attached to a different RushPoint
  account

#### Scenario: The creator dismissed the popup
- **WHEN** linking fails with `auth/popup-closed-by-user` or `auth/cancelled-popup-request`
- **THEN** the flow SHALL end quietly without presenting a failure the creator did not cause

#### Scenario: The browser blocked the popup
- **WHEN** linking fails with `auth/popup-blocked`
- **THEN** the creator SHALL be told to allow popups for the site and try again

#### Scenario: Unknown code
- **WHEN** the error carries a code the mapping does not know, or no code at all
- **THEN** the translated generic message SHALL be shown and no Firebase text SHALL be echoed

### Requirement: A stale login is resolved by re-confirming identity
When a sensitive operation fails with `auth/requires-recent-login`, the creator SHALL be asked to
confirm their identity using a method the account actually has, and the original operation SHALL then
be retried. The raw `requires-recent-login` condition SHALL never be presented as a dead end.

#### Scenario: Password account needs re-auth
- **WHEN** the account has a `password` provider and re-authentication is required
- **THEN** the creator SHALL be prompted for their current password and the operation SHALL be retried
  after a successful re-authentication

#### Scenario: Google-only account needs re-auth
- **WHEN** the account has only `google.com` and re-authentication is required
- **THEN** re-authentication SHALL be performed through a Google popup and the operation SHALL be
  retried

#### Scenario: Re-authentication fails
- **WHEN** the re-authentication itself fails
- **THEN** the failure SHALL be reported through the same translated error mapping, and the original
  operation SHALL NOT be retried

### Requirement: All new copy is translated
Every string the card can display SHALL come from the creator-web translation maps in both Hebrew and
English. No new user-facing literal SHALL be hardcoded in a component.

#### Scenario: Hebrew UI
- **WHEN** the creator has the console set to Hebrew
- **THEN** every label, status, action, and error in the card SHALL render in Hebrew, including the
  email-mismatch message

#### Scenario: English UI
- **WHEN** the creator has the console set to English
- **THEN** every one of those strings SHALL render in English
