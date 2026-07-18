## ADDED Requirements

### Requirement: Logged-out auth screen renders transient feedback

The logged-out creator auth screen SHALL mount a dialog host and a toast host so that
`dialog.*` and `toast.*` calls made before the user signs in render visible UI instead of
silently resolving to their no-host fallback.

#### Scenario: Dialog host present before sign-in
- **WHEN** the creator app renders the logged-out auth/landing screen (no authenticated user)
- **THEN** a dialog host and a toast host are mounted, so any `dialog.alert`/`dialog.confirm`/`dialog.prompt` or `toast.*` invoked from that screen displays to the user

### Requirement: Forgot-password gives visible confirmation

The system SHALL show a visible confirmation when a password reset is requested from the
logged-out auth screen and the request succeeds, and SHALL show an inline "enter your
email first" message (without sending a request) when the email field is empty. The
confirmation text is the existing resetSent string ("שלחנו קישור לאיפוס סיסמה אל …") and
the empty-email text is the existing resetNeedEmail string.

#### Scenario: Reset requested with an email
- **WHEN** the user enters an email on the logged-out sign-in screen and clicks "שכחת סיסמה?"
- **AND** the password-reset request (`accounts:sendOobCode`) succeeds
- **THEN** the `resetSent` confirmation message becomes visible on the screen

#### Scenario: Reset requested with an empty email
- **WHEN** the user clicks "שכחת סיסמה?" with the email field empty
- **THEN** the inline `resetNeedEmail` message is shown and no reset request is sent

### Requirement: Referral-bonus notice is visible on the auth screen

The system SHALL render the referral-bonus notice when a referral bonus is applied while
the user is on the logged-out auth screen. This notice currently no-ops for lack of a
mounted host.

#### Scenario: Referral bonus applied pre-signin
- **WHEN** a referral bonus is applied and the app is showing the logged-out auth screen
- **THEN** the `referralBonusApplied` confirmation renders to the user
