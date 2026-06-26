## ADDED Requirements

### Requirement: TaskRunner uses i18n for all user-visible strings
Every user-visible string in `TaskRunner.tsx` SHALL be sourced from `useT()` (the `t.task.*`
namespace), including its sub-components (`CodeEntry`, `QuizEntry`, `NumericEntry`,
`PhotoEntry`, `GeofenceAuto`, `SequenceRunner`, `DistanceBadge`). No string literal in JSX or user-facing message assignments SHALL remain
after this change except brand names and unit abbreviations (e.g., "m", "km").

The following keys SHALL exist in `t.task` (both HE and EN):
| Key | EN value |
|-----|----------|
| `routing` | `Finding your next task…` |
| `routingError` | `Could not get your next task.` |
| `retryRouting` | `Try again` |
| `yourTask` | `Your task` |
| `routedTask` | `Routed task` |
| `stopOf` | (fn) `Stop {{done}} of {{total}}` |
| `markComplete` | `Mark complete` |
| `imHere` | `I'm here` |
| `verify` | `Verify` |
| `wrongCode` | `Wrong code. Try again.` |
| `yourAnswer` | `Your answer` |
| `submitAnswer` | `Submit answer` |
| `enterNumber` | `Enter a number` |
| `submit` | `Submit` |
| `uploadingPhoto` | `Uploading photo…` |
| `approved` | `Approved!` |
| `pendingReview` | `Submitted. Waiting for review.` |
| `submitPhoto` | `Submit photo` |
| `working` | `Working…` |
| `pastePhotoUrl` | `…or paste a photo URL` |
| `hintStuck` | (fn) `Stuck? Reveal a hint (−{{cost}} pts)` |
| `stepOf` | (fn) `Step {{step}} of {{total}}` |
| `stepAnswer` | `Answer (or leave blank to confirm)` |
| `submitStep` | `Submit step` |
| `findingLocation` | `Finding your location…` |
| `youreHere` | `You're here! Checking in…` |
| `walkCloser` | (fn) `{{dist}} m away. Walk closer to auto-check-in (within {{radius}} m).` |
| `gpsWarning` | `GPS unavailable — location cannot be recorded. Enable GPS and try again, or contact your host.` |
| `gpsUnavailable` | `GPS is not available on this device or was denied.` |
| `gpsContactHost` | `Contact your host if you need help completing this task.` |

#### Scenario: TaskRunner renders in Hebrew — no English string literals in output
- **WHEN** the app language is `he`
- **THEN** the TaskRunner main card shows Hebrew text for all UI strings
- **THEN** no English-only string is visible in the task interaction area

#### Scenario: TaskRunner renders in English — no Hebrew string literals in output
- **WHEN** the app language is `en`
- **THEN** the TaskRunner main card shows English text for all UI strings

#### Scenario: i18n parity test passes — all t.task keys present in both HE and EN
- **WHEN** `scripts/test-i18n-parity.ts` is run via `npm test`
- **THEN** the test confirms every key in `t.task` of the `HE` map also exists in `EN`
- **THEN** the test confirms every key in `t.task` of the `EN` map also exists in `HE`
- **THEN** `npm test` exits 0
