// ───────────────────────────────────────────────────────────────────────────
// v2.1 RED-PHASE BLUEPRINT — Data model & scalability
// ───────────────────────────────────────────────────────────────────────────
// These are NOT yet-implemented features. Each `test.todo(...)` is the precise
// assertion the RED test must encode when its OpenSpec change is started
// (`/opsx:propose "<row title>"` → `/opsx:apply`). Turn a todo into a real
// `test(...)`/e2e assertion as the FIRST task of that change, confirm it fails
// for the right reason, then implement to green. Keeping them as `todo` means
// `npm test` stays green AND surfaces a live checklist of remaining TDD work.
//
// Lane tags:  [pure] vitest/tsx pure-logic · [e2e] scripts/e2e-verify.mjs ·
//             [rules] firestore.rules · [ui] preview tools
// Maps to TECH_SPEC.md Appendix B rows 1, 2, 15, 16, 17.
import { describe, test } from 'vitest';

describe('Appendix B #1 — taskStates subcollection (drop the stages-array overwrite) [§4.C]', () => {
  test.todo('[e2e] joinRun seeds a taskStates/{taskId} doc per task in the active stage');
  test.todo('[e2e] completeTask writes only the single taskStates/{taskId} doc, not the whole stages array');
  test.todo('[pure] resolveActiveStage(taskStates) reconstructs stage progress without a stages[] array');
  test.todo('[e2e] two concurrent completeTask calls on different tasks do not clobber each other (no write contention)');
  test.todo('[e2e] a team with >200 task states stays under the 1MB doc limit (subcollection, not array)');
  test.todo('[rules] clients cannot write taskStates/* (server-only, same as the team doc)');
  test.todo('[e2e] regression: completing a task no longer coerces any array to a "0","1" map');
});

describe('Appendix B #2 — RTDB live-telemetry migration [§4.B, §11]', () => {
  test.todo('[pure] location payload shape { lat, lng, heading, updatedAt } validates; rejects out-of-range');
  test.todo('[e2e] updateLocation writes to RTDB /runs/{runId}/teams/{teamId}/location, not Firestore teamLocations');
  test.todo('[rules] RTDB rules: a team may write only its own location node; staff/owner may read the run subtree');
  test.todo('[e2e] pruneRunPII also deletes the run /runs/{runId} subtree in RTDB');
  test.todo('[ui] LiveTeamMap subscribes to RTDB and renders heading (facing direction)');
});

describe('Appendix B #15 — pagination on listRunTeams / finalizeRun / refreshLeaderboard [§8, §16]', () => {
  test.todo('[e2e] listRunTeams accepts { limit, cursor } and returns at most `limit` teams + a nextCursor');
  test.todo('[e2e] paging through all pages yields every team exactly once (no dupes, no gaps)');
  test.todo('[pure] buildRankings is given an already-paginated team array and never reads the collection itself');
  test.todo('[e2e] finalizeRun over a 100-team run completes without reading the whole subcollection in one get()');
});

describe('Appendix B #16 — cache taskCounts within a routing invocation [§9, §16]', () => {
  test.todo('[pure] assignTask + buildRecommendations share one taskCounts read per routing invocation (not two)');
  test.todo('[pure] getTaskCounts is called exactly once when routing a single team (spy/assert call count)');
  test.todo('[e2e] routing decisions are unchanged vs the pre-cache implementation (same next-task pick)');
});

describe('Appendix B #17 — game snapshot on launch (run.gameSnapshot) [§8, §6]', () => {
  test.todo('[e2e] launchRun copies stages[]+tasks[] into run.gameSnapshot at launch time');
  test.todo('[e2e] editing the game template after launch does NOT change in-flight routing/scoring (snapshot is sealed)');
  test.todo('[pure] completeTaskForTeam / routing / scoring read run.gameSnapshot, never the live game doc');
  test.todo('[e2e] a run launched before snapshot support still resolves (back-compat: fall back to live template)');
  test.todo('[ui] Builder warns/locks edits while a run of this game is live');
});
