## 1. RED

- [x] 1.1 `scripts/test-flash-console-list.ts`: open and taken are current; a submitted claim keeps an old flash current; ended 5 minutes ago with no winner is current; ended 5 minutes ago with a winner is past; ended an hour ago is past; order kept; winners listed; total on junk. Run it and watch it fail.

## 2. GREEN

- [x] 2.1 `lib/flashConsoleList.ts`: `splitFlashes`, `flashWinners`.
- [x] 2.2 `FlashMissionCard`: current flashes as today; past folded in a `<details>` with one line each; no picker on past.
- [x] 2.3 i18n HE + EN (counted summary, winners line, "nobody", the score hint).

## 3. Verify

- [x] 3.1 Browser: the demo run's settled flashes fold; an open one stays in full. (Played the full cycle: sent → in full with picker; ended → still in full; awarded → folded, "זכו: צוות בזק".)
- [x] 3.2 Gates: `npm run verify` green, `npm run i18n:check:strict` clean.
