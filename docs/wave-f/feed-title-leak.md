# wave-f S1 — hidden-location live-feed leak (fix + staged e2e)

## Leak (confirmed)
`writeFeedItem({ taskTitle, photoUrl })` broadcasts a completed task into the
run-wide live photo feed (`FeedPanel`), visible to **every** team. Two write
sites in `functions/src/index.ts`:
- `submitStationPhoto` autoApprove path
- `reviewStationSubmission` approve path

For a **hidden-location** task (`task.hideLocation === true`), the instant the
first team arrives + its photo is approved, the feed item reaches every team
STILL hunting the spot. That reopens exactly the secrecy the wave-D gating
(`getMyTeamState` omission, `buildRecommendations` `locationHidden`, the
`sanitizeTask` sealed stub) protects. `hideLocation` is orthogonal to task
`type`, so hidden photo / smart-station tasks are real.

## Decision: FULL EXCLUSION (not just a title scrub)
A photo taken AT the secret spot is a **bigger** giveaway than its title — a
hunting team can recognize the location from the image regardless of the
caption. Title-scrubbing alone would still broadcast that photo. So a
hidden-location task is kept **out of the live feed entirely**. Implemented
behind the same `hideLocation` check at both sites via the shared pure helper
`shouldFeedTask` (`functions/src/feedVisibility.ts`) so they cannot diverge.
Fail-closed: an unresolvable task (absent from its own game doc) returns
`false`. Non-hidden tasks are completely unaffected.

## Files changed
- NEW `functions/src/feedVisibility.ts` — `shouldFeedTask(task) => boolean`.
- NEW `functions/src/feedVisibility.test.ts` — co-located vitest (RED→GREEN, 4 tests).
- `functions/src/index.ts`:
  - import `shouldFeedTask` / `FeedTaskVisibilityInput`.
  - `submitStationPhoto`: capture `feedTask = { hideLocation }` from the game
    snapshot; guard the feed write with `&& shouldFeedTask(feedTask)`.
  - `reviewStationSubmission`: add `hideLocation` to the inline game type,
    capture `feedTask`, guard the feed write with `&& shouldFeedTask(feedTask)`.

## Staged e2e assertion (apply to scripts/e2e-verify.mjs after the P0 agent frees it)
Add to the live-photo-feed scenario (or a new `hidden-location-feed-secrecy`
scenario). A hidden-location photo task whose approval must NOT broadcast into
the feed — assert BOTH the exclusion (no feed item) AND that a normal task
still feeds (guard didn't over-suppress).

```js
// wave-f S1: a HIDDEN-LOCATION photo task must NOT enter the run-wide live feed
// (its photo would leak the secret spot to teams still hunting it). Full
// exclusion — neither title NOR photo is broadcast.
scenario('hidden-location task is excluded from the live photo feed', async () => {
  // Build a game with photoFeedEnabled and TWO photo tasks with smart.autoApprove:
  //   - hiddenTaskId : { hideLocation: true, smart:{ verificationType:'photo', autoApprove:true } }
  //   - normalTaskId : { hideLocation: false, smart:{ verificationType:'photo', autoApprove:true } }
  // Launch a run, join one team, drive it to arrive (reportArrival) at the hidden
  // task so it is revealed and completable, then submit+autoApprove a photo for it.
  await callAs(team, 'submitStationPhoto', {
    ownerUid, gameId, runId, taskId: hiddenTaskId, photoUrl: hiddenPhotoUrl,
  });
  // …and submit+autoApprove a photo for the ordinary task.
  await callAs(team, 'submitStationPhoto', {
    ownerUid, gameId, runId, taskId: normalTaskId, photoUrl: normalPhotoUrl,
  });

  // Read the feed collection directly (admin) — feedItemsCol(ownerUid, gameId, runId).
  const feed = await adminDb
    .collection(FIRESTORE_PATHS.feedItemsCol(ownerUid, gameId, runId))
    .get();
  const feededTaskIds = feed.docs.map((d) => d.data().taskId);

  assert(
    !feededTaskIds.includes(hiddenTaskId),
    'hidden-location task must NOT appear in the live feed (photo leaks the secret spot)',
  );
  assert(
    feededTaskIds.includes(normalTaskId),
    'ordinary task must still appear in the feed (guard must not over-suppress)',
  );
  // Belt-and-suspenders: no feed item may carry the hidden task's real title.
  assert(
    !feed.docs.some((d) => d.data().taskTitle === HIDDEN_TASK_TITLE),
    'hidden-location task title must never reach the feed',
  );
});
```

Mirror the same for the staff-reviewed path: submit WITHOUT autoApprove, then
`reviewStationSubmission({ approved: true })` as staff/owner, and assert the
hidden task still never enters the feed.
