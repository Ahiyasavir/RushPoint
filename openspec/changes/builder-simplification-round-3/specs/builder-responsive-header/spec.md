## ADDED Requirements

### Requirement: Builder header stays usable at phone width
The Builder header SHALL remain usable below the Tailwind `sm` breakpoint (viewport width <= 639.98px) without horizontal overflow. At that width, secondary controls SHALL be collapsed into a single overflow menu, while primary controls remain directly on the header bar. Every control available on the desktop header SHALL remain reachable at every width; none is removed.

#### Scenario: Secondary controls collapse into one menu on a phone
- **WHEN** the Builder is rendered at a viewport width at or below the mobile breakpoint
- **THEN** the undo control, the redo control, the file export action, the file import action, and the secondary "test run" launch control are reachable through a single overflow menu rather than as separate always-visible header controls

#### Scenario: Primary controls stay directly on the bar on a phone
- **WHEN** the Builder is rendered at a viewport width at or below the mobile breakpoint
- **THEN** the back control, the game title, the save-status indicator, the tab strip, the readiness affordance, and the primary launch control remain directly visible on the header bar, not inside the overflow menu

#### Scenario: The header does not overflow horizontally on a phone
- **WHEN** the Builder is rendered at a phone-class viewport width
- **THEN** the header's contents fit within the viewport width, and the page does not scroll horizontally because of the header

#### Scenario: Desktop layout is unchanged
- **WHEN** the Builder is rendered above the mobile breakpoint
- **THEN** the header renders exactly as it does today, with undo/redo, the File menu, and both launch controls directly on the bar

#### Scenario: Collapsed actions still work
- **WHEN** a creator opens the overflow menu at phone width and activates the export, import, undo, redo, or test-run action
- **THEN** that action performs identically to activating its desktop control, including the file-picker flow for import

#### Scenario: The overflow menu stays on screen
- **WHEN** the overflow menu is opened at a phone-class viewport
- **THEN** the menu is positioned within the viewport (clamped and flipped as needed by the shared overflow-menu primitive) rather than clipped off-screen

#### Scenario: Overflow menu labels are sourced from i18n
- **WHEN** the overflow menu and its trigger render in either language
- **THEN** their text comes from `t.*` translation keys with EN and HE entries, matching the app's existing i18n conventions
