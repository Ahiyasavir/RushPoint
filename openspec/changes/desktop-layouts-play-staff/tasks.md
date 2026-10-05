## 1. RED

- [x] 1.1 `scripts/test-staff-layout.ts`: `STAFF_PHONE_ORDER` is today's order; `staffDesktopColumns`
  places every section exactly once in three columns; the quick bar is phone only; StaffConsole
  renders through the table (source assertion).
- [x] 1.2 `scripts/test-wide-layout.ts`: `WIDE_LAYOUT_QUERY` is `(min-width: 1024px)`; PlayScreen and
  StaffConsole branch on `useWideLayout`, not on `lg:` classes; on wide, PlayScreen renders the
  mission without MissionSheet and the map without a bottom inset.

## 2. GREEN

- [x] 2.1 `lib/useWideLayout.ts`, `lib/staffLayout.ts`.
- [x] 2.2 StaffConsole: sections as named elements; phone stack or three columns.
- [x] 2.3 PlayScreen + GameScreen: side by side on wide.
- [x] 2.4 FinalScreen: wider card on wide.

## 3. Verify

- [ ] 3.1 Browser at 1440×900, 1024×768 and 375×812, staff and player.
- [ ] 3.2 `npm run verify` (+ i18n strict).
