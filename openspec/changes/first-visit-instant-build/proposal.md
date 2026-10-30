## Why

Ahiya, 30.10: a visitor must understand exactly what RushPoint is, want to build, and build at once.
A stranger needed 13 taps, the first two on screens that gave nothing (name the game, pick a path).
Research and audit: `docs/first-visit-plan-2026-10-30.md` in the main checkout.

## What changes

- **The first question is on the front page.** "What are you celebrating?" chips on the marketing hero
  and the creator landing. `?start=game&occasion=<id>` carries the answer through sign-in.
- **Three questions.** New games open on a short smart build: who, how long, where. One tap each, the
  last tap builds. Name and path move behind "other ways to start"; the full questions stay there.
- **A real name.** A blank name becomes a title from the occasion, never "untitled".
- **A building moment, then a mission feed.** After composing, real mission names roll for two seconds,
  then every mission is a full-screen card. Swiping keeps, the dice swaps. The last card names the
  game and sends it to a friend. Swaps in the feed do not count toward a guest's free edits.
- **The site explains by showing.** One plain sentence and a three-beat animation, on phones too
  (a real clip replaces it later).
- **Measurement.** `lib/track.ts` sends first-visit funnel events to the existing Google tag.

## Not in this change

- A test drive that opens on a mission one person can do alone (routing decides the first mission).
- The Live race banner and the free participant limit: waiting on Ahiya.
