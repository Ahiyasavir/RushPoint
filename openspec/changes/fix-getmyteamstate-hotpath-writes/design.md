# Design: fix-getmyteamstate-hotpath-writes

## Files touched

- `functions/src/runs/index.ts`:
  - **New exported helper** (near `computeStageUnlock`/`sweepExpiredInFlight`, so it can use those
    module-private functions and be unit-tested):
    ```ts
    export async function advanceTeamStateOnPoll(args: {
      team: RunTeam; game: Game; launchedAt: string | undefined; nowMs: number;
      isController: boolean;
      persist: (patch: Record<string, unknown>) => Promise<void>;
      release: (taskId: string) => Promise<void>;
      onPersistError: (op: string, err: unknown) => void;
    }): Promise<void> {
      const { team, game, launchedAt, nowMs, isController } = args;
      const nowIso = new Date(nowMs).toISOString();

      // (1) Scheduled-release unlock when between stages — advance in memory ALWAYS,
      // persist best-effort + controller-only.
      if (team.stages.findIndex((s) => s.status === 'active') < 0) {
        const stages = team.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }));
        if (computeStageUnlock(stages, game, launchedAt, nowMs)) {
          team.stages = stages;
          if (isController) {
            try { await args.persist({ stages, updatedAt: nowIso }); }
            catch (e) { args.onPersistError('poll.unlock', e); }
          }
        }
      }

      // (2) Expiry sweep of an in-flight expired task — same policy.
      const idx = team.stages.findIndex((s) => s.status === 'active');
      const assignedRec = idx >= 0 ? team.stages[idx].tasks.find((t) => t.status === 'assigned') : undefined;
      const gt = assignedRec ? findGameTask(game, assignedRec.taskId) : undefined;
      if (assignedRec && gt?.expiresAfterMinutes) {
        const swept = sweepExpiredInFlight(team, game, launchedAt, nowMs);
        if (swept) {
          const allDone = swept.stages.every((s) => s.status === 'completed');
          team.stages = swept.stages;
          team.activeTaskId = null;
          if (allDone) { team.status = 'finished'; team.finishedAt = nowIso; }
          if (isController) {
            try {
              await args.persist({ stages: swept.stages, activeTaskId: null,
                ...(allDone ? { status: 'finished', finishedAt: nowIso } : {}), updatedAt: nowIso });
              await args.release(swept.expiredTaskId);
            } catch (e) { args.onPersistError('poll.sweep', e); }
          }
        }
      }
    }
    ```
  - **`getMyTeamState`** replaces the two inline write blocks with one call:
    ```ts
    const isController = resolveDeviceRole(team, uid) === 'controller';
    await advanceTeamStateOnPoll({
      team, game, launchedAt: run.launchedAt, nowMs: Date.now(), isController,
      persist: (patch) => db.doc(teamPath(ctx.ownerUid, ctx.gameId, ctx.runId, team.id)).update(patch),
      release: (taskId) => releaseTask(taskId, ctx.ownerUid, ctx.gameId, ctx.runId),
      onPersistError: (op, e) => logBestEffort(op, { runId: ctx.runId, teamId: team.id }, e),
    });
    ```

## Behavior preserved / changed

- **Preserved:** the response still reflects unlock/sweep immediately (in-memory advance is
  unconditional). The controller path persists exactly what the old code persisted, so the
  scheduled-release "poll-then-complete" flow is unchanged.
- **Changed (the fix):** a non-controller device never writes; a contended/aborted write no longer
  fails the read (best-effort) — the poll returns the advanced state and `requestNextTask` reconciles.

## Test strategy

- **Unit (`functions/src/runs/advanceTeamStateOnPoll.test.ts`, vitest, no emulator)** with injected
  `persist`/`release` spies:
  - controller + a due scheduled-release stage → `persist` called once AND `team.stages` advanced.
  - **non-controller** + due stage → `persist` NEVER called BUT `team.stages` still advanced.
  - `persist` that rejects (simulated lock timeout) → helper does NOT throw, `onPersistError` fires,
    and `team` is still advanced.
  - no due change → neither `persist` nor `release` called.
- **E2E (`scripts/e2e-verify.mjs`):** the existing "scheduled release" scenario is the controller
  persistence regression. Add: attach a **viewer** device, have ONLY the viewer poll `getMyTeamState`
  across a stage boundary, and assert (via an admin read of the team doc) the persisted stage did not
  advance from the viewer poll, while the controller's poll does advance it — proving controller-only
  writes without breaking play.

## Gates

`npm run typecheck` · `npm test` · `npm run lint` · `npm run creator:build` · `npm run play:build` ·
`npm run e2e`.
