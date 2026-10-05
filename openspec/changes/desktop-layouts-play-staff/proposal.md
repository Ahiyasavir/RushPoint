## Why

Ahiya, 2026-10-05, looking at the staff app on his computer: "החלק הזה בממשק קצת מוזר לי. בנוסף
אני רוצה שהממשק יהיה שונה במחשב, כנל גם לשחקן, לא צריך להיות צפיפות אם יש לנו מחשב שלם". Both
apps are phone layouts (`max-w-md`, one column) centred in a wide window: on a 1440px screen the
staff app uses 448px and makes the marshal scroll past contacts and alerts to reach the teams, and
the player's game screen squeezes a map and a mission drawer into a phone-sized column.

## What Changes

- **One threshold, `(min-width: 1024px)`, and the phone layout is untouched below it.** Each app
  decides its layout from that query (`useWideLayout`), never from Tailwind breakpoints inside
  components that are also drawn in narrow containers (CLAUDE.md: a breakpoint asks about the
  window).
- **Staff app on a computer: three columns** under the header.
  - "עכשיו": my teams, help calls, photos to review, flash missions.
  - Teams: the team cards, the main working list.
  - "מפה וקשר": tonight's numbers, the live map, the staff channel, team chat, the photo feed, the
    announcement composer.
  The quick bar (a phone's jump list) is not shown when everything is on screen. Every section is
  defined once and placed by a pure layout table (`staffDesktopColumns`), so the phone order and the
  desktop columns cannot drift and no section can be dropped.
- **Player's game screen on a computer: map and mission side by side.** The map fills the left
  pane at full height; the mission sits in a fixed column (about 440px) that scrolls inside itself,
  with no drawer. The map no longer reserves space for a sheet. The header spans both.
- Join, waiting, removed and final screens keep their centred card (a short form reads best
  narrow); the final screen's leaderboard gets a wider card.

## Impact

- play-web: `lib/useWideLayout.ts` (new), `lib/staffLayout.ts` (new, pure), `screens/StaffConsole.tsx`,
  `screens/PlayScreen.tsx`, `components/ui.tsx` (`GameScreen` width), `screens/FinalScreen.tsx`.
- Tests: `scripts/test-staff-layout.ts` (every section placed exactly once, phone order unchanged),
  `scripts/test-wide-layout.ts` (the query, and that no component under it uses `lg:` for this).
- Browser checks at 1440×900, 1024×768 and 375×812.
