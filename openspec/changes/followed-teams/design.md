## Context (verified 2026-09-30)

- The console streams every team document (`teamFullDocs`, `RunConsolePage.tsx`) and polls
  `listRunTeams` for the rows; the staff app streams the run's team documents in `StaffDashboard`
  (`teamRows`, with `stages`, `held`, `outOfBounds`, `taskSubmissions`, `flashClaims`). So every
  value a followed-team card needs is ALREADY on both clients: zero extra reads.
- Both apps already have a team page / team card with grouped actions (`teamPageActionGroups`,
  `TeamOpsCard`), per-capability gating in the staff app (`can(...)`), and pure triage verdicts in
  the console (`teamAttention.ts`, `runConsoleInbox.ts`).
- `packages/shared` is framework-free, so the list logic and the status verdict live there and both
  apps render them.

## Decisions

### D1: the list is local, per run and per person

`localStorage` key `rp-follow:<runId>:<uid>` (the organizer's uid, or the staff token's uid), value
a JSON array of team ids, newest last. Wrapped in try/catch like every storage use here: blocked
storage ⇒ the feature works for this session only. Rationale: no server write, no quota, no
permission question, and a marshal's phone is the device they follow on. A later "sync" can move the
same array into a document without changing the UI.

### D2: pure list operations (`packages/shared/src/followedTeams.ts`)

- `readFollowed(raw, knownTeamIds)`: parse, drop non-strings, duplicates and teams that no longer
  exist in the run, cap at `MAX_FOLLOWED = 8`. Total.
- `toggleFollowed(list, teamId)`: add (refused when full: returns `{ list, refused: 'full' }`) or
  remove. Pure, returns a new array.
- `neighbourFollowed(list, teamId, dir)`: the previous/next followed team for the team page arrows
  (wraps around; null when the team is not followed or the list has one entry).

### D3: one status per card (`followedTeamStatus`)

A total, clock-injected verdict over the stored team document plus the run's alerts:
`sos` > `removed` > `outOfBounds` > `waitingReview` (a submission or flash claim waiting; the OLDEST
is shown) > `finished` > `stuck` (the caller's verdict, the console's attention rule) > `held` >
`notStarted` > `playing`.
Only SOS / out of bounds (red) and waiting / stuck / paused (amber) get colour;
everything else is neutral grey, following ISA-101's rule that colour means abnormal. The card's
line of text is the current mission title (or the status sentence when abnormal) and, when
waiting, how long.

### D4: one action per card (`followedTeamAction`)

Derived from the status and the person's capabilities: `waitingReview` → approve (the oldest
waiting item; reject stays on the team page), `notStarted` → start, `held` → resume, sealed current
mission + `route` capability → let them in, `sos` → go to the alert. Anything else: no inline
action, the card only opens the team page. A capability the person lacks ⇒ no button (never a
disabled one: the card still opens the page).

### D5: where it appears

- Console: the strip is the first thing on the "עכשיו" screen; ☆ on the team row, the team page
  header, the map pin popup and each "now" row that names a team; a "רק שלי" toggle on the team
  list, the map and the "now" list (items of followed teams are ALSO sorted first when the toggle
  is off).
- Staff app: the strip sits directly under the quick bar (the top of a one-handed screen scrolls
  less than anything else on it); ☆ on every team card; a "רק שלי" toggle above the team list;
  followed teams sorted first. On a phone the strip is a horizontal row of cards, 2.5 cards wide so
  it is obvious it scrolls.
- Empty state (nothing followed yet): one line, "סמנו ☆ ליד קבוצה כדי לעקוב אחריה כאן", never an
  empty box.

### D6: accessibility and size

Cards and stars are real buttons with names ("לעקוב אחרי הלביאות" / "להפסיק לעקוב"), 44px targets
(`TAP_TARGET`), status in words as well as colour, `dir="auto"` on team names.

## Test strategy

- **Pure** `scripts/test-followed-teams.ts`: read/cap/prune/dedupe, toggle incl. the full list,
  neighbours with wrap, the status priority table (one case per status + ties), the action table ×
  capabilities, junk never throws.
- **UI** (preview, no component runner): console at 1280 and 375, staff app at 375×667 and 390×844:
  follow three teams, strip shows them, statuses change live when a team submits / is paused,
  inline approve works, arrows move between them, "רק שלי" filters list, map and "now", reload keeps
  the list, a removed team drops out. `npm run i18n:check:strict`, a11y and tap-target scans.
- No e2e change: no callable is added or changed.
