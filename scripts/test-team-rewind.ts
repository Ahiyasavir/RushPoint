// Sending a team back to a mission or a stage (change: send-team-back)
//
// Ahiya, 2026-09-25: "I have no button at all to send a team back, make sure there is one."
// Nothing could reopen a skipped/completed mission or an earlier stage: forceAssignTask refuses both.
// The real case waiting for it: in run oNaUvNrCWRia4Y1b9xOO (2026-09-22) one team lost its whole
// stage 1 to the skip bug fixed by skip-keeps-the-stage, and only a rewind can give it back.
//
// `planTeamRewind` is the pure decision; the callable writes what it returns.
import { planTeamRewind } from '../packages/shared/src/teamRewind';
import type { RunStageRecord } from '../packages/shared/src/types';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
const j = (v: unknown) => JSON.stringify(v);

type Rec = { taskId: string; status: string; earnedScore?: number; skipCause?: string; completedAt?: string; answerLog?: unknown[] };
const st = (stageId: string, status: string, tasks: Rec[], extra: Record<string, unknown> = {}) =>
  ({ stageId, order: 0, status, tasks: tasks.map((t, i) => ({ taskIndex: i, ...t })), ...extra }) as unknown as RunStageRecord;
const G = [
  { id: 's1', tasks: [{ id: 'a' }, { id: 'b', unlockAfterTaskIds: ['a'] }, { id: 'c', unlockAfterTaskIds: ['b', 'a'] }] },
  { id: 's2', requiredTaskCount: 1, tasks: [{ id: 'x' }, { id: 'y' }] },
  { id: 's3', tasks: [{ id: 'z' }] },
];
const statusOf = (stages: RunStageRecord[], id: string) => stages.flatMap((s) => s.tasks).find((t) => t.taskId === id)?.status;
const recOf = (stages: RunStageRecord[], id: string) => stages.flatMap((s) => s.tasks).find((t) => t.taskId === id) as Rec | undefined;

console.log('\n— THE 2026-09-22 TEAM: stage 1 lost to the skip bug, now on stage 2 —');
{
  const stages = [
    st('s1', 'completed', [
      { taskId: 'a', status: 'skipped', earnedScore: 43 },   // the operator skip (legacy: no cause)
      { taskId: 'b', status: 'skipped' },                    // retired by the bug
      { taskId: 'c', status: 'skipped' },
    ]),
    st('s2', 'active', [{ taskId: 'x', status: 'assigned' }, { taskId: 'y', status: 'unassigned' }], { requiredTaskCount: 1 }),
    st('s3', 'locked', [{ taskId: 'z', status: 'unassigned' }]),
  ];
  const p = planTeamRewind({ stages, gameStages: G, target: { kind: 'stage', stageId: 's1' }, teamScore: 43, teamStatus: 'active' });
  ok('the plan is accepted', p.ok, j(p));
  ok('stage 1 is active again, stage 2 waits', p.stages[0].status === 'active' && p.stages[1].status === 'locked', j(p.stages.map((s) => s.status)));
  ok('every lost mission of stage 1 is playable again', ['a', 'b', 'c'].every((id) => statusOf(p.stages, id) === 'unassigned'));
  ok('the mission the team was holding in stage 2 is released (its slot must be freed)',
    statusOf(p.stages, 'x') === 'unassigned' && j(p.releaseTaskIds) === '["x"]', j(p.releaseTaskIds));
  ok('the skip consolation is taken back (43 → 0)', p.scoreDelta === -43 && p.nextTeamScore === 0, j([p.scoreDelta, p.nextTeamScore]));
  ok('nothing is claimed directly: routing picks the next mission in the reopened stage', p.assignTaskId === null);
  ok('the input was not mutated', stages[0].status === 'completed' && stages[0].tasks[0].status === 'skipped');
}

console.log('\n— return to ONE mission in an earlier stage —');
{
  const stages = [
    st('s1', 'completed', [
      { taskId: 'a', status: 'completed', earnedScore: 40, completedAt: 't', answerLog: [{ a: 1 }] },
      { taskId: 'b', status: 'completed', earnedScore: 40 },
      { taskId: 'c', status: 'completed', earnedScore: 40 },
    ], { earnedScore: 120, completedAt: 't' }),
    st('s2', 'active', [{ taskId: 'x', status: 'completed', earnedScore: 30 }, { taskId: 'y', status: 'assigned' }], { requiredTaskCount: 1 }),
    st('s3', 'locked', [{ taskId: 'z', status: 'unassigned' }]),
  ];
  const p = planTeamRewind({ stages, gameStages: G, target: { kind: 'task', taskId: 'b' }, teamScore: 150, teamStatus: 'active' });
  ok('accepted', p.ok, j(p));
  ok('b is reopened and becomes the mission to claim now', statusOf(p.stages, 'b') === 'unassigned' && p.assignTaskId === 'b');
  ok('a and c stay completed', statusOf(p.stages, 'a') === 'completed' && statusOf(p.stages, 'c') === 'completed');
  ok('b\'s award is removed (150 → 110)', p.scoreDelta === -40 && p.nextTeamScore === 110, j([p.scoreDelta, p.nextTeamScore]));
  ok('b\'s completion stamps are cleared', recOf(p.stages, 'b')?.completedAt === undefined && (recOf(p.stages, 'b')?.earnedScore ?? 0) === 0);
  ok('stage 2 keeps its COMPLETED mission (no work is lost)', statusOf(p.stages, 'x') === 'completed');
  ok('stage 2\'s held mission is released', statusOf(p.stages, 'y') === 'unassigned' && p.releaseTaskIds.includes('y'));
  ok('a ledger entry names the reopened mission', j(p.ledger) === j([{ taskId: 'b', delta: -40 }]), j(p.ledger));
}

console.log('\n— return to a mission in the CURRENT stage —');
{
  const stages = [
    st('s1', 'active', [
      { taskId: 'a', status: 'skipped', skipCause: 'operator', earnedScore: 20 },
      { taskId: 'b', status: 'assigned' },
      { taskId: 'c', status: 'unassigned' },
    ], { requiredTaskCount: 2 }),
    st('s2', 'locked', [{ taskId: 'x', status: 'unassigned' }, { taskId: 'y', status: 'unassigned' }]),
    st('s3', 'locked', [{ taskId: 'z', status: 'unassigned' }]),
  ];
  const p = planTeamRewind({ stages, gameStages: G, target: { kind: 'task', taskId: 'a' }, teamScore: 20, teamStatus: 'active' });
  ok('a is reopened and claimed now, its skip cause cleared',
    p.assignTaskId === 'a' && statusOf(p.stages, 'a') === 'unassigned' && recOf(p.stages, 'a')?.skipCause === undefined);
  ok('the mission they were holding is released for it', statusOf(p.stages, 'b') === 'unassigned' && j(p.releaseTaskIds) === '["b"]');
  ok('the requirement a skip lowered is restored to the template (all 3)', p.stages[0].requiredTaskCount === undefined, j(p.stages[0].requiredTaskCount));
}

console.log('\n— sent to a leftover in a stage that was already satisfied —');
{
  // "2 of 4" stage, the team completed x and y... here s2 is "1 of 2": x completed, y a leftover.
  // Reopening y alone leaves completed(1) >= required(1), so the stage would complete AT ONCE and
  // auto-skip the very mission the organizer sent them to. The operator's intent wins: this team's
  // requirement rises just enough for y to count.
  const stages = [
    st('s1', 'completed', [{ taskId: 'a', status: 'completed' }, { taskId: 'b', status: 'completed' }, { taskId: 'c', status: 'completed' }]),
    st('s2', 'completed', [{ taskId: 'x', status: 'completed', earnedScore: 10 }, { taskId: 'y', status: 'skipped', skipCause: 'stageSatisfied' }], { requiredTaskCount: 1 }),
    st('s3', 'active', [{ taskId: 'z', status: 'unassigned' }]),
  ];
  const p = planTeamRewind({ stages, gameStages: G, target: { kind: 'task', taskId: 'y' }, teamScore: 10, teamStatus: 'active' });
  ok('the requirement rises to completed + 1 so the reopened mission counts',
    p.stages[1].requiredTaskCount === 2, j(p.stages[1].requiredTaskCount));
  ok('never above the number of missions in the stage', (p.stages[1].requiredTaskCount ?? 0) <= 2);
}

console.log('\n— a finished team comes back —');
{
  const stages = [
    st('s1', 'completed', [{ taskId: 'a', status: 'completed', earnedScore: 10 }, { taskId: 'b', status: 'completed', earnedScore: 10 }, { taskId: 'c', status: 'completed', earnedScore: 10 }]),
    st('s2', 'completed', [{ taskId: 'x', status: 'completed', earnedScore: 10 }, { taskId: 'y', status: 'skipped', skipCause: 'stageSatisfied' }], { requiredTaskCount: 1 }),
    st('s3', 'completed', [{ taskId: 'z', status: 'completed', earnedScore: 10 }]),
  ];
  const p = planTeamRewind({ stages, gameStages: G, target: { kind: 'task', taskId: 'z' }, teamScore: 50, teamStatus: 'finished' });
  ok('the team is reactivated', p.ok && p.reactivatesTeam === true, j(p));
  ok('its final stage is active again', p.stages[2].status === 'active');
}

console.log('\n— what stays closed —');
{
  const stages = [
    st('s1', 'completed', [
      { taskId: 'a', status: 'skipped', skipCause: 'exclusive' },
      { taskId: 'b', status: 'skipped', skipCause: 'expired' },
      { taskId: 'c', status: 'completed', earnedScore: 10 },
    ]),
    st('s2', 'active', [{ taskId: 'x', status: 'unassigned' }, { taskId: 'y', status: 'unassigned' }]),
    st('s3', 'locked', [{ taskId: 'z', status: 'unassigned' }]),
  ];
  const p = planTeamRewind({ stages, gameStages: G, target: { kind: 'stage', stageId: 's1' }, teamScore: 10, teamStatus: 'active' });
  ok('returning to a stage keeps an exclusive loss and an expiry closed (the game\'s own rules)',
    statusOf(p.stages, 'a') === 'skipped' && statusOf(p.stages, 'b') === 'skipped');
  ok('but a specific mission CAN be reopened explicitly even if it expired',
    planTeamRewind({ stages, gameStages: G, target: { kind: 'task', taskId: 'b' }, teamScore: 10, teamStatus: 'active' }).ok);
}

console.log('\n— refusals —');
{
  const stages = [
    st('s1', 'active', [{ taskId: 'a', status: 'assigned' }, { taskId: 'b', status: 'unassigned' }, { taskId: 'c', status: 'unassigned' }]),
    st('s2', 'locked', [{ taskId: 'x', status: 'unassigned' }, { taskId: 'y', status: 'unassigned' }]),
    st('s3', 'locked', [{ taskId: 'z', status: 'unassigned' }]),
  ];
  const r = (target: never) => planTeamRewind({ stages, gameStages: G, target, teamScore: 0, teamStatus: 'active' });
  ok('a mission not yet played is refused', r({ kind: 'task', taskId: 'b' } as never).reason === 'targetNotTerminal');
  ok('the mission they are on is refused', r({ kind: 'task', taskId: 'a' } as never).reason === 'targetNotTerminal');
  ok('a future stage is refused', r({ kind: 'stage', stageId: 's2' } as never).reason === 'stageNotReached');
  ok('a mission in a future stage is refused', r({ kind: 'task', taskId: 'x' } as never).reason === 'stageNotReached');
  ok('an unknown id is refused', r({ kind: 'task', taskId: 'nope' } as never).reason === 'unknownTarget');
  ok('garbage is refused, never thrown', planTeamRewind(null as never).ok === false && planTeamRewind({} as never).ok === false);
}

console.log('\n— send-back-from-here (issue 32): "only this mission" or "from this mission on" —');
{
  const T = (m: number) => `2026-10-06T10:${String(m).padStart(2, '0')}:00.000Z`;
  const mk = () => [
    st('s1', 'completed', [
      { taskId: 'a', status: 'completed', earnedScore: 10, completedAt: T(1) },
      { taskId: 'b', status: 'completed', earnedScore: 20, completedAt: T(2) },
      { taskId: 'c', status: 'completed', earnedScore: 30, completedAt: T(3) },
    ]),
    st('s2', 'active', [
      { taskId: 'x', status: 'completed', earnedScore: 40, completedAt: T(4) },
      { taskId: 'y', status: 'assigned' },
    ], { requiredTaskCount: 1 }),
    st('s3', 'locked', [{ taskId: 'z', status: 'unassigned' }]),
  ];
  const base = { gameStages: G, target: { kind: 'task' as const, taskId: 'b' }, teamScore: 100, teamStatus: 'active' };
  const only = planTeamRewind({ ...base, stages: mk() });
  const onlyNamed = planTeamRewind({ ...base, stages: mk(), scope: 'only' });
  ok('"only" is today\'s behaviour and the default', j(only) === j(onlyNamed));
  ok('"only" reopens that mission alone', j(only.reopenedTaskIds) === j(['b']) && statusOf(only.stages, 'c') === 'completed' && statusOf(only.stages, 'x') === 'completed', j(only.reopenedTaskIds));
  const here = planTeamRewind({ ...base, stages: mk(), scope: 'fromHere' });
  ok('"from here" reopens the mission and everything finished after it', j([...here.reopenedTaskIds].sort()) === j(['b', 'c', 'x']), j(here.reopenedTaskIds));
  ok('"from here" keeps what was finished BEFORE it', statusOf(here.stages, 'a') === 'completed' && recOf(here.stages, 'a')?.earnedScore === 10);
  ok('"from here" takes the points of every reopened mission off', here.scoreDelta === -90 && here.nextTeamScore === 10, j([here.scoreDelta, here.nextTeamScore]));
  ok('"from here" writes one ledger line per reopened mission',
    j([...here.ledger].sort((p, q) => p.taskId.localeCompare(q.taskId))) === j([{ taskId: 'b', delta: -20 }, { taskId: 'c', delta: -30 }, { taskId: 'x', delta: -40 }]), j(here.ledger));
  ok('"from here" still makes the target the mission to do now', here.assignTaskId === 'b' && statusOf(here.stages, 'y') === 'unassigned', j(here.assignTaskId));
  // A mission in the target's stage with no completion time is not guessed "after": it stays done.
  const unknown = mk(); delete (unknown[0].tasks[2] as { completedAt?: string }).completedAt;
  const u = planTeamRewind({ ...base, stages: unknown, scope: 'fromHere' });
  ok('an unknown completion time in the same stage stays done (never guessed)', statusOf(u.stages, 'c') === 'completed');
  // An authored loss (exclusive group) after it stays closed; an organizer's skip reopens.
  const losses = mk();
  Object.assign(losses[1].tasks[1], { status: 'skipped', skipCause: 'exclusive' });
  ok('an authored loss after it stays closed', statusOf(planTeamRewind({ ...base, stages: losses, scope: 'fromHere' }).stages, 'y') === 'skipped');
  const opSkip = mk();
  Object.assign(opSkip[1].tasks[1], { status: 'skipped', skipCause: 'operator' });
  ok('an organizer skip after it reopens', statusOf(planTeamRewind({ ...base, stages: opSkip, scope: 'fromHere' }).stages, 'y') === 'unassigned');
  const junk = planTeamRewind({ ...base, stages: mk(), scope: 'whatever' as never });
  ok('an unknown scope is "only"', j(junk.reopenedTaskIds) === j(['b']));
}

console.log('\n— the score never goes below zero —');
{
  const stages = [
    st('s1', 'completed', [{ taskId: 'a', status: 'completed', earnedScore: 100 }, { taskId: 'b', status: 'completed' }, { taskId: 'c', status: 'completed' }]),
    st('s2', 'active', [{ taskId: 'x', status: 'unassigned' }, { taskId: 'y', status: 'unassigned' }]),
    st('s3', 'locked', [{ taskId: 'z', status: 'unassigned' }]),
  ];
  const p = planTeamRewind({ stages, gameStages: G, target: { kind: 'task', taskId: 'a' }, teamScore: 30, teamStatus: 'active' });
  ok('clamped at zero, delta derived from the clamp', p.nextTeamScore === 0 && p.scoreDelta === -30, j([p.nextTeamScore, p.scoreDelta]));
  // Found in the running app 2026-09-25: the preview said "0 points come off" while the ledger said
  // -10. The ledger must record what REALLY happened to the score, so its entries sum to the delta.
  ok('the ledger records the clamped change, not the stored award', j(p.ledger) === j([{ taskId: 'a', delta: -30 }]), j(p.ledger));
  const zero = planTeamRewind({ stages, gameStages: G, target: { kind: 'task', taskId: 'a' }, teamScore: 0, teamStatus: 'active' });
  ok('a score already at zero writes no ledger entry', j(zero.ledger) === '[]' && zero.scoreDelta === 0, j(zero.ledger));
}

if (failures > 0) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall passed');
process.exit(0);
