# race-multi-phone-capacity

## Why
A school race this week: 35 teams of 8-12 students, 3-6 phones per team (105-210 phones).
The largest real run so far had 29 phones. Read against the code and production:

- `MAX_RUN_DEVICES = 150`. `joinRun` checks it before creating a team, so once early teams
  attached their extra phones, LATE TEAMS COULD NOT REGISTER AT ALL.
- An attached phone found its team with an UNCACHED `deviceUids array-contains` query on every
  call (every 60s poll, every team-document change). The comment claimed "once per phone".
- The doc-cache TTL was 30s, set when the participant poll was 12s. The poll is now 60s, so every
  quiet poll re-read its team document.
- `joinTeamAsDevice` read-locked the ONE run document inside its transaction: the shape that
  measured `joinRun` at p50 12s / max 56s for 120 simultaneous joins before it was fixed.

Production op counts (fsops, since 2026-10-07): `getMyTeamState` 2.24 reads/call.

## What
1. Attached phones resolve their team through the cached `runDeviceMember/{uid}` index, trusted
   only when the write-invalidated team doc still lists the uid; otherwise the query fallback.
2. Doc-cache TTL 30s -> 120s, pinned to stay longer than the play-web fallback poll.
3. `joinTeamAsDevice`: the run document leaves the transaction; the ceiling is checked on the run
   read already made, and `deviceCount` moves by `FieldValue.increment(1)` after a real attach.
4. `MAX_RUN_DEVICES` 150 -> 250.

## Not in scope
Moving viewer phones' live updates off Firestore listeners (each phone still pays one client read
per team-document change). That is the next lever if a run needs 8+ phones per team on Spark.
