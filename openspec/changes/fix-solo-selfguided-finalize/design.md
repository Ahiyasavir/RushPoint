## Context

`startInstantPlay` builds a self-guided solo run (`functions/src/runs/index.ts:2498-2502`):

```ts
const run: Run = {
  id: runId, gameId, ownerUid, status: 'live', accessCode: code,
  billingType: 'free', maxParticipants: 1, participantCount: 1,
  selfGuided: true, launchedAt: now, createdAt: now, updatedAt: now,
};
```

The finish transition is written per-team, never to the run:

- `completeTaskForTeam` — the shared grading core — computes `allDone` and, inside its transaction,
  writes `...(allDone ? { status: 'finished', finishedAt: now } : {})` to the TEAM doc
  (`:1069, :1088`). It returns `{ completed, heldSlot }` (`:726, :1107`).
- `finalizeRun` (`:1826-1884`) is the only writer of `run.leaderboard`. It reads the game + teams,
  calls `buildRankings(game, teams, now)` (`:1847, :1464`), and does one `runRef.update(...)`
  (`:1862-1881`) that sets `status:'finished'`, `leaderboard: { rankings, frozen:true,
  published: !game.manualLeaderboardReveal, updatedAt }`, and `taskCounts: reconcileTaskCounts(teams)`.
- `onRunFinalized` (`:1919-1932`) is an `onUpdate` trigger on the run doc, guarded to fire once per
  transition into `status:'finished'` (`beforeStatus === 'finished'` early-returns). It records
  player profiles/badges (`recordPlayerResult`, `:1130`), the benchmark aggregate, and the summary
  email — each with its own transactional idempotency claim.

`FinalScreen` reads `run.leaderboard?.published` as `board` and shows the waiting spinner whenever
`!run.leaderboard` (`FinalScreen.tsx:39-42, :284-289`). Badges re-fetch when the `finalized` prop
(`!!run.leaderboard`) flips (`:207, :331-356`). So the moment the run doc carries a published
`leaderboard`, the EXISTING screen renders rank, podium, board and badges — no client change needed.

`completeTaskForTeam` already reads the run doc at its top and has `runData` in scope, including
`runData.selfGuided` and `runData.participantCount` (`:740-750`). That is the natural place to
trigger auto-finalize because every grading callable funnels through it (call sites:
`runs/index.ts:3425, :3828, :4037, :4091`; `index.ts:1047, :1193, :1265`).

## Goals / Non-Goals

**Goals:**
- A solo self-guided finisher gets a real, published final board (rank, podium, badges) with no host.
- Reuse the exact finalize write + `buildRankings` so live/final parity and the frozen-board contract
  are preserved.

**Non-Goals:**
- Changing any normal organizer run's flow (manual finalize + staged reveal stay).
- Auto-finalizing multi-team runs, or any run with `selfGuided` falsy.
- A client-side workaround. (The server fix makes the existing FinalScreen correct; the client-only
  "solo close" fallback described in the findings is explicitly not taken here.)

## Decisions

### D1 — Extract `finalizeRunCore`, keep `finalizeRun` as its authenticated wrapper

Move `finalizeRun`'s body (read game + teams, `buildRankings`, the `runRef.update`) into:

```ts
async function finalizeRunCore(
  ownerUid: string, gameId: string, runId: string,
  opts?: { forcePublish?: boolean },
): Promise<{ rankings: LeaderboardEntry[]; alreadyFinal: boolean }>
```

- Reads the run doc; if `run.status === 'finished'` it returns `{ rankings: [], alreadyFinal: true }`
  WITHOUT rewriting — this is the idempotency backstop (a re-finish, or a manual finalize racing the
  auto path, is a no-op rather than a second `status:'finished'` write).
- Otherwise it performs the identical write finalizeRun does today, except `published` is
  `opts?.forcePublish ? true : !game.manualLeaderboardReveal`.

`finalizeRun` the callable keeps `requireAuth` + the `run.ownerUid !== uid` ownership check
(`:1827-1838`) and then calls `finalizeRunCore(uid, gameId, runId)` (no forcePublish — organizer
runs keep honoring `manualLeaderboardReveal`). Its return shape (`{ rankings }`) is unchanged.

### D2 — `maybeAutoFinalizeSoloRun`: the solo-only, idempotent guard

```ts
async function maybeAutoFinalizeSoloRun(ownerUid: string, gameId: string, runId: string): Promise<void> {
  const runSnap = await db.doc(runPath(ownerUid, gameId, runId)).get();
  const run = runSnap.data() as Run | undefined;
  if (!run) return;
  if (run.selfGuided !== true) return;              // ← never a normal organizer run
  if ((run.participantCount ?? 1) > 1) return;      // ← solo only
  if (run.status === 'finished') return;            // ← already finalized (idempotent)

  // Confirm the sole participant has actually finished every stage.
  const teamsSnap = await db.collection(teamsCol(ownerUid, gameId, runId)).get();
  if (teamsSnap.size !== 1) return;                 // ← defensive: not a solo shape
  const team = teamsSnap.docs[0].data() as RunTeam;
  if (team.status !== 'finished') return;           // ← the finish transition just happened

  await finalizeRunCore(ownerUid, gameId, runId, { forcePublish: true });
}
```

`forcePublish: true` because a self-guided run has no host to perform a staged reveal — withholding
the board would recreate the dead-end (`FinalScreen`'s "🤫 under wraps" card with nobody to reveal).

### D3 — One best-effort call site inside `completeTaskForTeam`

Immediately before `completeTaskForTeam` returns `result` (`:1121`), gated on the values already in
scope:

```ts
if (result.completed && runData?.selfGuided === true && (runData?.participantCount ?? 1) <= 1) {
  await maybeAutoFinalizeSoloRun(ownerUid, gameId, runId)
    .catch((e) => logBestEffort('autoFinalizeSolo', { ownerUid, gameId, runId }, e));
}
```

- Runs only after a REAL completion (`result.completed`), so a duplicate/idempotent completion never
  re-finalizes.
- The cheap in-scope pre-check (`selfGuided`, `participantCount`) means a normal run pays zero extra
  reads — the helper is entered only for solo self-guided runs.
- Best-effort: a finalize hiccup must never fail the player's completion, which has already committed.
  `maybeAutoFinalizeSoloRun` re-reads the run/team as the source of truth (the team's
  `status:'finished'` was just committed by this call's transaction), so it is safe under the eventual
  read.

### D4 — Edge finish paths (skip / poll-sweep) are out of scope

A solo instant-play run finishes via a grading completion (`completeTaskForTeam`), which this covers.
`skipStage`/`skipTaskForTeam` are organizer/staff callables (no operator on an instant-play run), and
the poll-expiry sweep finish is a rare edge that a subsequent poll's `requestNextTask` does not
finalize either. If a future game makes solo expiry-finish common, the same best-effort call can be
added to the sweep sites; this change deliberately keeps a single choke point.

## Idempotency & the onRunFinalized trigger

- Auto-finalize writes `status:'finished'` via the SAME `runRef.update` as manual finalize, so
  `onRunFinalized` fires exactly once on that transition and records badges/profile/benchmark/email
  the standard way. The solo finisher therefore gets badges — the whole point.
- Two independent guards prevent a double-finalize: `maybeAutoFinalizeSoloRun` bails when
  `run.status === 'finished'`, and `finalizeRunCore` bails on the same condition; `onRunFinalized`'s
  own `beforeStatus === 'finished'` guard prevents double badge/profile writes even under its
  at-least-once delivery.
- The frozen-board contract holds: the write sets `frozen: true`, and
  `maybeRefreshLeaderboardSnapshot` already bails on a frozen board, so no later scoring event can
  overwrite the published solo standings.

## Test Strategy

The new behavior is a callable/trigger path, so `scripts/e2e-verify.mjs` is the authoritative gate
(pure `buildRankings` is already covered by the property/parity oracles):

- **New scenario — solo instant-play finish auto-produces a published leaderboard.** An anonymous
  party calls `startInstantPlay({ gameId })` on a public, instant-play-enabled game, plays its sole
  team through every stage to finish (via `completeTask`/`submitTaskAnswer`/etc.), then asserts the
  run doc now has `leaderboard.published === true`, `leaderboard.frozen === true`, exactly one ranking
  with `rank === 1`, and that `getMyTeamState` returns a non-null `run.leaderboard`. Poll briefly for
  the write to appear (the call awaits it, but stay robust like the existing `onRunFinalized` probe at
  `e2e-verify.mjs:1168-1197`).
- **Regression assertion — a normal organizer run still waits for manual finalize.** After all teams
  of a launched (non-self-guided) run reach `status:'finished'`, assert `run.leaderboard` is still
  null until `finalizeRun` is called. This proves the solo-only guard.

Marked **UNVERIFIED**: the implementer must run `npm run e2e` (and `npm run verify`); it cannot be run
in the authoring lane.

## RTL / i18n notes

No UI or copy change. FinalScreen already renders rank/podium/board/badges bilingually from the
server board; making the board exist is the entire fix. No i18n gate impact.
