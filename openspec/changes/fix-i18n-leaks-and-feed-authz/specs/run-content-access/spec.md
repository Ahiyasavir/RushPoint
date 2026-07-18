## ADDED Requirements

### Requirement: All user-facing text is switchable via the translation dictionary
Every user-facing string in the creator and participant apps SHALL be resolved through that app's
translation dictionary (`t.*` in `apps/*/src/i18n.ts`) so that selecting a UI language renders the
entire interface in that language. A component MUST NOT hardcode a user-facing literal, and MUST NOT
hand-roll translation with an inline `lang === '<code>' ? … : …` ternary that bypasses the
dictionary. A deliberate non-switchable literal (a brand name, sample/mock content, or a
language-switcher label that names the target language in its own script) is permitted only when it
carries a trailing `// i18n-ignore` comment stating the reason. When a default value derived from a
string is persisted into stored data (for example a new stage's default title), it SHALL be taken
from the dictionary in the creator's current language, and applying this rule MUST NOT rewrite any
already-stored value.

#### Scenario: Switching UI language flips a dashboard label
- **WHEN** a creator viewing the dashboard in Hebrew switches the UI language to English
- **THEN** the game visibility badge ("Public"/"Private"), the creator-name fallback, and the
  empty-description placeholder all render in English (they are read from `t.*`, not hardcoded)

#### Scenario: A newly created stage's default title is localized without touching existing data
- **WHEN** a creator whose UI is in Hebrew adds a new stage in the Builder
- **THEN** the new stage's default title is the Hebrew dictionary default (e.g. "שלב 3")
- **AND** the titles already stored on that creator's existing games are unchanged

#### Scenario: A deliberate non-switchable literal is explicitly marked
- **WHEN** the language-switcher button shows the target language's name in its own script
  (e.g. "English" / "עברית")
- **THEN** that literal is allowed to remain non-translated because it carries a trailing
  `// i18n-ignore` comment giving the reason, and the strict i18n check reports no new finding for it

### Requirement: A run's live content feed is readable only by that run's participants, staff, and owner
A run's live content feed SHALL be readable only by that run's participants, staff, and owner. The
`feedItems` subcollection of a run (which carries participant photo URLs and team names), and the
run's `announcements` and `flashMissions` broadcasts, SHALL be readable only by: the run's owner, a
staff member scoped to that run via the staff custom-token claims (`token.staff` with matching
`ownerUid`/`gameId`/`runId`), or an authenticated participant of *that* run (a user who owns a team
document under that run). An authenticated user who is none of these — including a user authenticated
against a different run or tenant — MUST be denied read access, even if they know or guess the run's
`ownerUid/gameId/runId` path. These documents remain server-write-only (no client writes).

#### Scenario: A run participant reads their run's feed
- **WHEN** a participant who has joined run X reads run X's `feedItems`
- **THEN** the read is ALLOWED and returns the run's active feed items

#### Scenario: The run owner and run-scoped staff read the feed
- **WHEN** the owner of run X, or a staff member holding a staff token scoped to run X, reads run
  X's `feedItems`
- **THEN** the read is ALLOWED

#### Scenario: A stranger is denied reading another run's feed
- **WHEN** an authenticated user who is not the owner, not run-scoped staff, and not a participant of
  run X attempts to read run X's `feedItems` by its `ownerUid/gameId/runId` path
- **THEN** the read is DENIED (permission denied), so the stranger cannot obtain the run's
  participant photo URLs or team names

#### Scenario: The same scoping applies to announcements and flash missions
- **WHEN** a user who is not a participant/staff/owner of run X attempts to read run X's
  `announcements` or `flashMissions`
- **THEN** the read is DENIED, matching the `feedItems` read scope
