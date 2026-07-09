# finalscreen-i18n Specification

## Purpose
TBD - created by archiving change prelaunch-critical-fixes. Update Purpose after archive.
## Requirements
### Requirement: FinalScreen uses i18n for all user-visible strings
Every user-visible string in `apps/play-web/src/screens/FinalScreen.tsx` SHALL be sourced
from `useT()` (the `t.final.*` namespace). No string literal in JSX or user-facing message
assignments SHALL remain after this change except brand name "RushPoint" and numeric units.

The following keys SHALL exist in `t.final` (both HE and EN):
| Key | EN value |
|-----|----------|
| `title` | `Finished!` |
| `subtitle` | (fn) `{{name}}, you completed every stage.` |
| `scoreLabel` | `Final Score` |
| `rankLabel` | (fn) `Rank #{{rank}}` |
| `recapTitle` | `Your race, wrapped` |
| `statTotalTime` | `Total time` |
| `statStages` | `Stages done` |
| `statFastest` | `Fastest stage` |
| `statHints` | `Hints used` |
| `shareBtn` | `📸 Share my result` |
| `shareCreating` | `Creating…` |
| `shareSaved` | `✓ Saved!` |
| `leaderboardTitle` | `Leaderboard` |
| `waitingFinalize` | `Waiting for the host to finalize the leaderboard…` |
| `poweredBy` | `Powered by RushPoint` |
| `buildOwn` | `Build your own race, free →` |
| `leave` | `Leave` |

#### Scenario: FinalScreen renders in Hebrew — all strings in Hebrew
- **WHEN** the app language is `he`
- **THEN** the FinalScreen shows Hebrew text for every label
- **THEN** no English literal is visible in the card area

#### Scenario: FinalScreen renders in English — all strings in English
- **WHEN** the app language is `en`
- **THEN** the FinalScreen shows English text for every label

### Requirement: Share text respects active language
The share text generated in `FinalScreen.share()` SHALL be composed using keys from
`t.final` (via `useT()`) so that it is rendered in the language the participant has
selected. It SHALL NOT be hardcoded in Hebrew or English.

The share text template keys SHALL be:
| Key | EN value | HE value |
|-----|----------|----------|
| `shareText` | (fn) `🏆 {{team}} finished "{{game}}"{{rankPart}}{{timePart}}! Want to build your own field game? {{url}}` | (fn) `🏆 {{team}} סיימה את "{{game}}"{{rankPart}}{{timePart}}! רוצים לבנות משחק שדה משלכם? {{url}}` |
| `shareRankPart` | (fn) ` · Rank #{{rank}}` | (fn) ` · מקום #{{rank}}` |
| `shareTimePart` | (fn) ` in {{time}}` | (fn) ` תוך {{time}}` |

#### Scenario: English user shares — share text is in English
- **WHEN** the app language is `en` and the participant taps "Share my result"
- **THEN** the generated share text string is in English
- **THEN** the text contains the team name, game name, and rank/time if available

#### Scenario: Hebrew user shares — share text is in Hebrew
- **WHEN** the app language is `he` and the participant taps "Share my result"
- **THEN** the generated share text string is in Hebrew

#### Scenario: i18n parity test — all t.final keys present in both HE and EN
- **WHEN** `scripts/test-i18n-parity.ts` is run via `npm test`
- **THEN** the test confirms every key in `t.final` of HE also exists in EN and vice versa
- **THEN** `npm test` exits 0

