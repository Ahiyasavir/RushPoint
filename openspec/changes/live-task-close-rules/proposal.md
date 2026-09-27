# Proposal: live-task-close-rules

## Why

The owner asked (2026-09-27) what happens when a mission is paused or closed from the console
while a team is on it, and when other missions depend on it. The answer was three bugs:

1. A team standing on a CLOSED mission kept it, with no message. If the stop is really gone the
   team is stuck on a mission it cannot finish. It could even still complete and score it.
2. A mission that waits for the closed one (`unlockAfterTaskIds`) stayed locked forever for every
   team that had not done it, and the stage could then never end.
3. The pause/close winnability check ignored both the unlock graph and the exclusive groups.

## What changes (owner's decisions)

- **Close** is final for the run. The team on it loses it with a message and no points and is
  routed on. Missions that waited for it open, but any OTHER prerequisite they have still holds.
  Every team's stage requirement shrinks by the smallest amount that keeps it winnable, so no team
  is stuck. A team that joins later gets the same treatment. Closing is confirmed in the console.
- **Pause** stays temporary: a team on it finishes and scores. What waits for a paused mission is
  locked until it returns, and the "stage cannot be finished" warning now counts that.
