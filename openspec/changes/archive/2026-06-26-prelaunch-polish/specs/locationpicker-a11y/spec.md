## ADDED Requirements

### Requirement: LocationPicker geocoding dropdown supports keyboard navigation
The search results list in `LocationPicker.tsx` SHALL support full keyboard navigation so
users who cannot use a mouse can select geocoding results.

Behavior:
- When the input is focused and results are displayed, `ArrowDown` SHALL move the highlight
  to the next result (or to index 0 if none is highlighted), clamped at `results.length - 1`.
- `ArrowUp` SHALL move the highlight to the previous result, clamped at 0.
- `Enter` key SHALL select the currently highlighted result (if any) and close the dropdown.
- `Escape` key SHALL close the dropdown without selecting.
- When `results` changes (new geocoding response), `activeIndex` SHALL reset to `-1`.
- The highlighted `<li>` SHALL receive a CSS highlight class (`bg-zinc-700` or equivalent)
  so the keyboard position is visually clear.

#### Scenario: ArrowDown moves highlight down
- **GIVEN** the input has 3 results displayed, `activeIndex` is -1
- **WHEN** the user presses ArrowDown
- **THEN** `activeIndex` becomes 0, the first result is visually highlighted

#### Scenario: ArrowDown does not exceed last result
- **GIVEN** `activeIndex` is at `results.length - 1`
- **WHEN** the user presses ArrowDown
- **THEN** `activeIndex` stays at `results.length - 1`

#### Scenario: ArrowUp on first item stays at 0
- **GIVEN** `activeIndex` is 0
- **WHEN** the user presses ArrowUp
- **THEN** `activeIndex` stays at 0

#### Scenario: Enter selects the highlighted result
- **GIVEN** `activeIndex` is 1
- **WHEN** the user presses Enter
- **THEN** `choose(results[1])` is called
- **THEN** the dropdown closes

#### Scenario: Escape closes the dropdown
- **GIVEN** results are displayed
- **WHEN** the user presses Escape
- **THEN** `results` is cleared to `[]`
- **THEN** `activeIndex` resets to -1

#### Scenario: New search results reset highlight
- **GIVEN** `activeIndex` is 2
- **WHEN** new results arrive (setResults called with a new array)
- **THEN** `activeIndex` resets to -1


### Requirement: Interactive buttons in JoinScreen and TaskRunner have aria-labels
Three interactive elements that currently have no accessible name SHALL receive `aria-label`
attributes so screen readers can announce their purpose.

1. **Language toggle button** (`JoinScreen.tsx` line ~88): `aria-label` SHALL be the opposite
   language label — `"Switch to English"` when current lang is `'he'`, or `"עבור לעברית"` when
   current lang is `'en'`. This way the button label describes what pressing it will DO.

2. **Remove member ✕ buttons** (`JoinScreen.tsx` line ~218): each `aria-label` SHALL be
   `"הסר ${name}"` (HE) or `"Remove ${name}"` (EN) using the member's display name, so
   assistive technology users know which member each ✕ button refers to.

3. **Hint reveal button** (`TaskRunner.tsx`): `aria-label` SHALL be `"גלה רמז"` (HE) or
   `"Reveal hint"` (EN), matching the display language.

#### Scenario: Language toggle has accessible name
- **WHEN** the JoinScreen language toggle button is rendered in HE mode
- **THEN** the button has `aria-label="Switch to English"`

#### Scenario: Remove-member button names the member
- **WHEN** a remove-member ✕ button is rendered for member named "ישי"
- **THEN** the button's `aria-label` contains `"ישי"` (in the current language phrasing)

#### Scenario: Hint button has accessible name
- **WHEN** the TaskRunner hint reveal button is rendered in HE mode
- **THEN** the button has `aria-label` containing the Hebrew hint label text
