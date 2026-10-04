## MODIFIED Requirements

### Requirement: Step 3 shows required verification fields before any opt-in chip
Step 3 SHALL render the task-type-conditional required verification fields first, followed by the
optional settings rows. Required verification fields SHALL always render when applicable to the selected
type; they are never hidden behind a row.

#### Scenario: Creator selects Quiz as the task type
- **WHEN** a task's type is Quiz and the creator is on Step 3
- **THEN** the quiz choices editor renders unconditionally, above the settings rows

#### Scenario: Creator selects a type with no verification config
- **WHEN** a task's type is `field`, `self_report`, or `geofence`
- **THEN** Step 3 shows no required verification fields and the settings rows render directly

## REMOVED Requirements

### Requirement: Optional fields are grouped into 4 opt-in chips
**Reason**: Replaced by value rows (one setting per row, each showing its value). The chips were drawers
of unrelated settings that opened to up to 810px and hid their values behind a count badge.
**Migration**: No data migration. Every field the chips edited is edited by a row or by "עוד הגדרות".

### Requirement: A field group with existing data renders expanded by default
**Reason**: Already superseded in code by builder-nondestructive-disclosure (every group opens collapsed,
a badge advertises content). Value rows make the badge unnecessary: the value is on the row itself.
**Migration**: None.

## ADDED Requirements

### Requirement: Optional settings are rows that show their value
Step 3 SHALL present its optional settings as at most five rows: the scoring row (when the game's
scoring uses one), "רמז", "מתי נפתחת", "זמן לקבוצה", and "עוד הגדרות". Each row SHALL show its current
value in words. Activating a row SHALL open only that setting beneath it and close any other open row.
Opening or closing a row SHALL NOT change the mission.

#### Scenario: A mission with nothing optional set
- **GIVEN** a new mission in a game using the default scoring
- **WHEN** the creator reaches step 3
- **THEN** they see "נקודות 100", "רמז · אין", "מתי נפתחת · מההתחלה", "זמן לקבוצה · בלי הגבלה" and
  "עוד הגדרות · ללא", and no settings controls are expanded

#### Scenario: Opening one row closes another
- **GIVEN** the "רמז" row is open
- **WHEN** the creator opens "זמן לקבוצה"
- **THEN** "רמז" closes and only the time limit choices are shown

#### Scenario: Looking is not editing
- **GIVEN** a mission whose hint is set
- **WHEN** the creator opens and closes every row without choosing anything
- **THEN** the saved mission is unchanged

### Requirement: The scoring row follows the game's scoring
The editor SHALL show points for a game scored by fixed points, difficulty for a game scored by smart
score, and no scoring row for a speed race. A control the game's scoring ignores SHALL NOT be shown, and
its stored value SHALL be kept.

#### Scenario: A points game
- **WHEN** the game uses fixed points with a speed bonus
- **THEN** the scoring row is a points stepper and no difficulty control appears anywhere in step 3

#### Scenario: A speed race
- **WHEN** the game is ranked by time only
- **THEN** step 3 shows no points and no difficulty

#### Scenario: Switching scoring keeps values
- **GIVEN** a mission with difficulty "קשה" in a smart-score game
- **WHEN** the game is switched to fixed points and back
- **THEN** the mission's difficulty is still "קשה"

### Requirement: When a mission opens is one question
The "מתי נפתחת" row SHALL offer: from the start, after another mission (only when the stage has other
missions), N minutes after the start, or at a set time. Choosing an answer SHALL set that condition and
remove the other two. A mission that already holds more than one condition SHALL show all of them,
editable, and lose none of them until the creator chooses an answer.

#### Scenario: Unlock after another mission
- **WHEN** the creator chooses "אחרי משימה אחרת" and picks "כולם בתמונה"
- **THEN** the row reads "מתי נפתחת · אחרי 'כולם בתמונה'"

#### Scenario: Back to the start
- **GIVEN** a mission that opens at 18:00
- **WHEN** the creator chooses "מההתחלה"
- **THEN** the mission has no opening time and no prerequisite stored

### Requirement: Rare settings live in one place, one level down
"עוד הגדרות" SHALL be the only second level. Its row SHALL name the settings inside it that are not at
their default. Inside, each setting SHALL take one line, with its explanation available on demand rather
than printed. No setting SHALL be nested deeper.

#### Scenario: What is set shows on the row
- **GIVEN** a mission allowing 3 teams at once that stops the clock
- **WHEN** the creator looks at step 3
- **THEN** the row reads "עוד הגדרות · קיבולת 3 · עצירת שעון"

#### Scenario: Tag suggestions only while typing
- **WHEN** the creator focuses the gallery tags input and types "חו"
- **THEN** only suggestions containing "חו" are offered, and none are shown before the input is focused

### Requirement: Quick Setup never lands on a hidden control
A Quick Setup step that targets a setting SHALL open the row that holds it. A step whose target the
game's scoring ignores SHALL be left out of that game's Quick Setup.

#### Scenario: A template note about difficulty in a points game
- **GIVEN** a template step targeting a mission's difficulty, in a game using fixed points
- **WHEN** the creator runs Quick Setup
- **THEN** that step is not part of the flow
