## Why

Ahiya, 2.11: start the business model. Everyone but him moves to a community plan, and asking for more
must be a warm conversation with him, not a wall.

## What changes

- `community`: 3 real launches for the account (test drives free, counted from this release on), 3 teams
  and 15 people in a run (an individual game: 15 people), no gallery, no game file in or out, no copy or
  launch through a share link. A link still shows the game.
- `creatorPlans/{uid}`, closed to clients. No document means the default plan: community in production,
  unlimited under the emulator so seeds and simulators keep working; a stored plan is obeyed everywhere.
- `getMyPlan`, and `setCreatorPlan` for the admin roster (3 more launches, open fully).
- `PlanSheet`: the launch moment with the launch number, the home chip, a one tap WhatsApp message.

## Decisions

- Games published before this stay published, and a run already live keeps its limits.
- Launches are counted on the document, so deleting a game gives nothing back.
- The team and head count caps read a value from just before the increment, like the run ceiling: a burst
  can pass by the joins in flight. Accepted at this size.
