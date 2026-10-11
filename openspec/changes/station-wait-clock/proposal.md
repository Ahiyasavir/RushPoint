# Waiting for a station stops the team's clock, and the organizer is told

## Why

A station's `maxConcurrentTeams` is enforced, and a team whose every open station is full is
held with a waiting card and an automatic retry (verified 2026-10-10 on "המירוץ לציון",
14 teams, `scripts/simulate-station-caps.mjs`). Two things are missing (Ahiya, 2026-10-10):

- The wait counts against the team. A team that stood 24 s in a queue the organizer created
  carried those 24 s on the leaderboard, and its card said nothing about the clock.
- The organizer cannot see it. `listRunTeams` gives a waiting team no marker, so the console
  shows it like any other team.

## What changes

- The server records when a team starts waiting for a station and how long it waited; that
  time is excluded from the race clock exactly like a staff hold (`heldMs`).
- The clock stops only while the phone keeps asking for a station. A phone that goes quiet
  stops earning excluded time after a short allowance (decided: Ahiya, 2026-10-10), so
  nobody can "stop time" by closing the app.
- The waiting card says the clock is stopped; the race clock on the phone stands still.
- The Run Console shows a "waiting for a station" signal and marks the team's row.

## Out of scope

- The staff app. Queue position. Changing how routing picks a station.
