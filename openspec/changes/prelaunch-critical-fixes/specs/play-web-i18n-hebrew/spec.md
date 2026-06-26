## MODIFIED Requirements

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
| `shareText` | (fn) `🏆 {{team}} סיימה את "{{game}}"{{rankPart}}{{timePart}}! רוצים לבנות מירוץ הרפתקה משלכם? {{url}}` |
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
