## ADDED Requirements

### Requirement: Google sign-in resolves to the existing email account

The system SHALL sign a user into their existing account when they sign in with Google using
an email that already has a password account, rather than failing or creating a duplicate.
Google sign-in MUST bridge via the Google credential so the auth backend links the
`google.com` provider onto the same account (same uid).

#### Scenario: Password account exists, then Google sign-in same email
- **WHEN** an account was registered with email+password for address X
- **AND** the user then signs in with Google using address X
- **THEN** sign-in succeeds and resolves to the same account (same uid), with Google linked

#### Scenario: No prior account, Google sign-in
- **WHEN** no account exists for the Google email
- **THEN** Google sign-in creates and signs into a single account for that email

### Requirement: Google bridge claims are well-formed

The system SHALL build the emulator Google-credential claims from the signed-in Google
identity, always including the subject, email, and a verified-email flag, and omitting empty
optional fields.

#### Scenario: Claims built from a Google identity
- **WHEN** the bridge builds claims from a Google identity with uid, email, name, and photo
- **THEN** the claims include sub, email, and email_verified true, plus name/picture when present
