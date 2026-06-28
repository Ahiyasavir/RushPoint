# play-web-i18n-hebrew Specification

## Purpose
TBD - created by archiving change prelaunch-critical-fixes. Update Purpose after archive.
## Requirements
### Requirement: play-web i18n covers all participant-facing screens
The `apps/play-web/src/i18n.ts` file SHALL contain translation keys for every
participant-facing screen, including `TaskRunner` and `FinalScreen`.
After this change, the translation maps SHALL include a `task` namespace and a `final`
namespace in addition to the existing `join`, `promo`, and `common` namespaces.
The `typeof HE` constraint on `EN` SHALL continue to enforce compile-time key parity.

The `HE` (Hebrew) values for `t.task` SHALL be:
| Key | HE value |
|-----|----------|
| `routing` | `מחפש את המשימה הבאה שלכם…` |
| `routingError` | `לא הצלחנו לאחזר את המשימה הבאה.` |
| `retryRouting` | `נסו שוב` |
| `yourTask` | `המשימה שלכם` |
| `routedTask` | `משימה מנוהלת` |
| `stopOf` | (fn) `עצור {{done}} מתוך {{total}}` |
| `markComplete` | `סמן כהושלם` |
| `imHere` | `אני כאן` |
| `verify` | `אמת` |
| `wrongCode` | `קוד שגוי. נסו שוב.` |
| `yourAnswer` | `התשובה שלכם` |
| `submitAnswer` | `שלח תשובה` |
| `enterNumber` | `הזינו מספר` |
| `submit` | `שלח` |
| `uploadingPhoto` | `מעלה תמונה…` |
| `approved` | `אושר!` |
| `pendingReview` | `הוגש. ממתין לאישור.` |
| `submitPhoto` | `שלח תמונה` |
| `working` | `עובד…` |
| `pastePhotoUrl` | `…או הדביקו קישור לתמונה` |
| `hintStuck` | (fn) `תקועים? גלו רמז (−{{cost}} נק')` |
| `stepOf` | (fn) `שלב {{step}} מתוך {{total}}` |
| `stepAnswer` | `תשובה (או השאירו ריק לאישור)` |
| `submitStep` | `שלח שלב` |
| `findingLocation` | `מאתר מיקום…` |
| `youreHere` | `אתם כאן! מאשר נוכחות…` |
| `walkCloser` | (fn) `{{dist}} מ' מהנקודה. התקרבו לאישור אוטומטי (עד {{radius}} מ').` |
| `gpsWarning` | `GPS לא זמין — לא ניתן לרשום מיקום. הפעילו GPS ונסו שוב, או פנו למארגן.` |
| `gpsUnavailable` | `GPS אינו זמין במכשיר זה או שהרשאה נדחתה.` |
| `gpsContactHost` | `פנו למארגן אם אתם צריכים עזרה להשלים את המשימה.` |

The `HE` values for `t.final` SHALL be:
| Key | HE value |
|-----|----------|
| `title` | `סיימתם!` |
| `subtitle` | (fn) `{{name}}, סיימתם את כל השלבים.` |
| `scoreLabel` | `ניקוד סופי` |
| `rankLabel` | (fn) `מקום #{{rank}}` |
| `recapTitle` | `המירוץ שלכם, בתמצית` |
| `statTotalTime` | `זמן כולל` |
| `statStages` | `שלבים שהושלמו` |
| `statFastest` | `שלב מהיר ביותר` |
| `statHints` | `רמזים ששומשו` |
| `shareBtn` | `📸 שתפו את התוצאה` |
| `shareCreating` | `יוצר…` |
| `shareSaved` | `✓ נשמר!` |
| `leaderboardTitle` | `טבלת דירוג` |
| `waitingFinalize` | `ממתין לסיום הטורניר על ידי המארגן…` |
| `poweredBy` | `מופעל על ידי RushPoint` |
| `buildOwn` | `בנו מירוץ משלכם, בחינם ←` |
| `leave` | `צא` |
| `shareText` | (fn) `🏆 {{team}} סיימה את "{{game}}"{{rankPart}}{{timePart}}! רוצים לבנות משחק שדה משלכם? {{url}}` |
| `shareRankPart` | (fn) ` · מקום #{{rank}}` |
| `shareTimePart` | (fn) ` תוך {{time}}` |

#### Scenario: HE translation map contains all t.task keys
- **WHEN** `scripts/test-i18n-parity.ts` inspects the `HE` map
- **THEN** every key listed in the `t.task` namespace table above exists in HE
- **THEN** every key listed in the `t.final` namespace table above exists in HE

#### Scenario: EN translation map contains all t.task and t.final keys
- **WHEN** `scripts/test-i18n-parity.ts` inspects the `EN` map
- **THEN** every key that exists in HE also exists in EN
- **THEN** `typeof HE` TypeScript constraint compiles without error

#### Scenario: fn keys are functions, not strings
- **WHEN** a key is marked `(fn)` in the tables above
- **THEN** the value in both HE and EN is a TypeScript function, not a string literal

### Requirement: Public leaderboard is displayed whenever boardCode is set
The routing logic in `apps/play-web/src/App.tsx` SHALL display the `PublicLeaderboardScreen`
whenever `boardCode` is truthy, regardless of whether a play session also exists.
Previously the condition was `boardCode && !session`, which prevented a user with an active
session (e.g. a finished participant) from viewing a leaderboard shared link.

After this change, the condition SHALL be `!!boardCode` (i.e. `boardCode` alone without the
`!session` guard). The `PublicLeaderboardScreen` component already provides an `onJoin`
callback that calls `setBoardCode(null)`, which restores the session/play screen — that
behavior SHALL be preserved and is not changed by this fix.

#### Scenario: boardCode set without session → leaderboard shown
- **WHEN** `boardCode` is `"ABCD123"` and `session` is `null`
- **THEN** `PublicLeaderboardScreen` is rendered

#### Scenario: boardCode set WITH session → leaderboard still shown
- **WHEN** `boardCode` is `"ABCD123"` and `session` is a valid `Session` object
- **THEN** `PublicLeaderboardScreen` is rendered (not the play screen)

#### Scenario: No boardCode → leaderboard NOT shown
- **WHEN** `boardCode` is `null`
- **THEN** `PublicLeaderboardScreen` is NOT rendered

#### Scenario: onJoin callback clears boardCode
- **GIVEN** `PublicLeaderboardScreen` is displayed (boardCode is set)
- **WHEN** the user presses the join/play button (`onJoin` is called)
- **THEN** `setBoardCode(null)` is called
- **THEN** the play/join screen is rendered

### Requirement: LINK_CODE is evaluated at component mount, not at module load
The `LINK_CODE` constant in `JoinScreen.tsx` SHALL be moved inside the `JoinScreen` component
body and evaluated using a `useState` initializer
(`useState(() => new URLSearchParams(...).get('code') ?? null)`) or equivalent, rather than
the current module-level (line 8) evaluation.

This ensures the code is read from the current `window.location.search` at mount time rather
than once at bundle-parse time, which is fragile in a single-page application where the URL
can differ between module load and component mount.

No behavior change is expected for the initial render of the component; this is a correctness
improvement for robustness in hot-module-reload, test environments, and future SPA routing
changes.

#### Scenario: LINK_CODE reads correct URL at mount
- **WHEN** `JoinScreen` is mounted with `?code=RUSH42` in the URL
- **THEN** `linkCode` (previously `LINK_CODE`) equals `"RUSH42"`

#### Scenario: LINK_CODE is not frozen at module-load time
- **WHEN** the module is loaded with one URL and the component is mounted later with a different URL
- **THEN** `linkCode` reflects the URL at component mount time
- **THEN** no module-level side-effects read `window.location.search`

