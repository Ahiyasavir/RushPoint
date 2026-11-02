## Why

A real creator (first visit, 1.11.2026) chose a blank game, got a map as the first thing in the mission
editor, hit the required sign up in the middle of it after three saves, and left 3.5 minutes in with a pin and
a mission that has no name. The API log shows the timing; it cannot show their device, and the time on site
column read 2 minutes.

## What Changes

- The mission editor opens on what the mission is; the map is the second step.
- The required guest sign up waits until the open mission is closed.
- Next on an unnamed mission stays pressable, marks the hint and focuses the name.
- `recordEngagement` stores the device of the latest flush, shown on `/admin/users`. Flush every minute.

## Impact

`wizardLogic`, `TaskWizard`, `guestCreator`, `BuilderPage`, `useEngagementTracker`, `AdminUsersPage`,
`packages/shared` engagement + admin summary, `functions/src/admin`. Needs API and hosting. Reads the same data;
old engagement documents simply have no device.
