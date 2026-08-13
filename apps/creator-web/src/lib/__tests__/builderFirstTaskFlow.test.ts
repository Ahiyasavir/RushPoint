// Pure-logic suite for `builder-first-task-flow`.
//
// The Builder's first-task experience is decided entirely by pure functions so it
// can be proven without rendering React (apps/creator-web has no component test
// runner). Five decision cores are covered here:
//   1. the declared wizard step order + the placement classification (D1/D2)
//   2. the reveal-gating model that stops error-on-open (D3)
//   3. Inspiration-Mode sample lookup + the overwrite guard (D4)
//   4. game readiness — the ONE computation shared by the readiness panel and the
//      launch guard, including the identity test against the legacy guards (D5)
//   5. the honest advanced-section badge (D6)
import { describe, it, expect } from 'vitest';
import type { Game, Stage, Task, TaskType, TriggerMode } from '@rushpoint/shared';
import { validateUnlockGraph } from '@rushpoint/shared';
import {
  WIZARD_STEP_ORDER, type WizardStepKey, stepKeyAt, stepIndexOf, canGoNext, canGoBack,
  taskPlacementState, isTaskLocationValid, isTaskInteractionValid, blankTask,
  shouldAutoOpenFirstTask,
} from '../wizardLogic';
import {
  VALIDATION_FIELDS, type ValidationField,
  initialRevealState, markTouched, shouldReveal, nextFinishAction, taskRevealBlockers,
} from '../taskValidationGating';
import {
  TASK_SAMPLES, applySample, samplesForType, sampleWouldOverwrite,
} from '../taskTemplates';
import { computeGameReadiness, canLaunchGame, firstLaunchBlocker } from '../gameReadiness';
import { defaultActiveGroups, groupSummary } from '../taskOptInGroups';

function task(p: Partial<Task> = {}): Task {
  return { ...blankTask('t1'), ...p };
}
function stage(p: Partial<Stage> = {}): Stage {
  return { id: 's1', order: 0, title: 'Stage one', tasks: [task()], ...p };
}
function game(stages: Stage[]): Game {
  return {
    id: 'g1', ownerUid: 'u1', title: 'Test game', mode: 'team', stages,
    scoringPreset: 'fixed_points_speed', registrationFields: [], tags: [], status: 'draft',
  } as unknown as Game;
}
// A task that is fully launchable: completable and pinned.
function readyTask(p: Partial<Task> = {}): Task {
  return task({ title: 'Ready', coordinates: { lat: 31.77, lng: 35.21 }, ...p });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Step order + placement classification
// ─────────────────────────────────────────────────────────────────────────────
describe('wizard step order is declared data, and naming still gates forward', () => {
  // Reordered by task-editor-progressive-disclosure: location leads because it
  // owns the map, which needs the whole panel. Naming remains the ONLY forward
  // gate, so it now guards 2 → 3 instead of 1 → 2.
  it('orders the steps location, details, execution', () => {
    expect([...WIZARD_STEP_ORDER]).toEqual(['location', 'details', 'execution']);
  });

  it('maps every 1 based position to its key and back', () => {
    expect(stepKeyAt(1)).toBe('location');
    expect(stepKeyAt(2)).toBe('details');
    expect(stepKeyAt(3)).toBe('execution');
    for (const key of WIZARD_STEP_ORDER) {
      expect(stepKeyAt(stepIndexOf(key))).toBe(key);
    }
  });

  it('gates the details step on a non empty title and nothing else', () => {
    expect(canGoNext('details', task())).toBe(false);
    expect(canGoNext('details', task({ title: '   ' }))).toBe(false);
    expect(canGoNext('details', task({ title: 'My task' }))).toBe(true);
  });

  // The regression test for the removed placement gate: an unplaced, answer key
  // free task could not advance before this change. Location is now step 1 and
  // must be even less willing to block — a creator has not typed anything yet.
  it('never gates location or execution on coordinates, trigger mode or answer key', () => {
    const cases: Task[] = [
      task(),
      task({ title: 'x', type: 'quiz' }),
      task({ title: 'x', triggerMode: 'radius', coordinates: { lat: 0, lng: 0 } }),
      task({ title: 'x', triggerMode: 'exact', coordinates: { lat: 0, lng: 0 } }),
      task({ title: 'x', triggerMode: 'locationless', locationless: true }),
      task({ title: 'x', type: 'smart_station' }),
    ];
    for (const t of cases) {
      expect(canGoNext('location', t)).toBe(true);
      expect(canGoNext('execution', t)).toBe(true);
    }
  });

  // Step 1 must never block on the empty title a brand new task carries: the
  // creator reaches naming on step 2, so gating step 1 would strand them.
  it('lets an untitled task leave the location step', () => {
    expect(canGoNext('location', task())).toBe(true);
  });

  it('is total over the step keys', () => {
    const keys: WizardStepKey[] = ['location', 'details', 'execution'];
    for (const k of keys) expect(typeof canGoNext(k, task({ title: 'x' }))).toBe('boolean');
    expect(canGoBack(1)).toBe(false);
    expect(canGoBack(2)).toBe(true);
  });
});

describe('taskPlacementState classifies placement in three states', () => {
  it('calls a located task at the unplaced default unplaced', () => {
    expect(taskPlacementState(task({ triggerMode: 'radius' }))).toBe('unplaced');
    expect(taskPlacementState(task({ triggerMode: 'exact' }))).toBe('unplaced');
    expect(taskPlacementState(task())).toBe('unplaced');
  });

  it('calls a located task with real coordinates placed', () => {
    expect(taskPlacementState(task({ coordinates: { lat: 31.77, lng: 35.21 } }))).toBe('placed');
    expect(taskPlacementState(task({ coordinates: { lat: 0, lng: 35.21 } }))).toBe('placed');
  });

  it('calls a task that needs no pin notRequired', () => {
    expect(taskPlacementState(task({ triggerMode: 'locationless' }))).toBe('notRequired');
    expect(taskPlacementState(task({ triggerMode: 'instant' }))).toBe('notRequired');
    expect(taskPlacementState(task({ locationless: true }))).toBe('notRequired');
  });

  it('keeps isTaskLocationValid as the same rule', () => {
    const modes: (TriggerMode | undefined)[] = [undefined, 'radius', 'exact', 'instant', 'locationless'];
    const coords = [{ lat: 0, lng: 0 }, { lat: 31.77, lng: 35.21 }];
    for (const triggerMode of modes) {
      for (const c of coords) {
        for (const locationless of [undefined, true]) {
          const t = task({ triggerMode, coordinates: c, locationless });
          expect(isTaskLocationValid(t)).toBe(taskPlacementState(t) !== 'unplaced');
        }
      }
    }
  });
});

// The first-task auto-open guard is the ONLY safety guarantee that this
// convenience never disturbs a game the creator is returning to edit. It must
// fire for exactly one shape — a single untouched blank task — and refuse
// everything else, so it is covered exhaustively.
describe('shouldAutoOpenFirstTask fires only for a brand-new untouched blank game', () => {
  it('returns the first task target for one stage holding one untouched blank task', () => {
    const g = game([stage({ tasks: [task({ id: 't1' })] })]);
    expect(shouldAutoOpenFirstTask(g)).toEqual({ stageId: 's1', taskId: 't1' });
  });

  it('returns null when the first task has an edited title', () => {
    const g = game([stage({ tasks: [task({ id: 't1', title: 'My first task' })] })]);
    expect(shouldAutoOpenFirstTask(g)).toBeNull();
    // whitespace only is still untouched, so it DOES fire
    expect(shouldAutoOpenFirstTask(game([stage({ tasks: [task({ id: 't1', title: '   ' })] })])))
      .toEqual({ stageId: 's1', taskId: 't1' });
  });

  it('returns null when the first task carries a real (non 0,0) pin', () => {
    const g = game([stage({ tasks: [task({ id: 't1', coordinates: { lat: 31.77, lng: 35.21 } })] })]);
    expect(shouldAutoOpenFirstTask(g)).toBeNull();
    // a single non-zero axis still counts as placed
    expect(shouldAutoOpenFirstTask(game([stage({ tasks: [task({ id: 't1', coordinates: { lat: 0, lng: 35.21 } })] })])))
      .toBeNull();
  });

  it('returns null for two stages, even if the first is a lone blank task', () => {
    const g = game([
      stage({ id: 's1', order: 0, tasks: [task({ id: 't1' })] }),
      stage({ id: 's2', order: 1, title: 'Stage two', tasks: [task({ id: 't2' })] }),
    ]);
    expect(shouldAutoOpenFirstTask(g)).toBeNull();
  });

  it('returns null for a stage with two tasks', () => {
    const g = game([stage({ tasks: [task({ id: 't1' }), task({ id: 't2' })] })]);
    expect(shouldAutoOpenFirstTask(g)).toBeNull();
  });

  it('returns null for an empty game and for a stage with no tasks', () => {
    expect(shouldAutoOpenFirstTask(game([]))).toBeNull();
    expect(shouldAutoOpenFirstTask(game([stage({ tasks: [] })]))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Reveal gating (D3)
// ─────────────────────────────────────────────────────────────────────────────
describe('reveal gating withholds validation until a field is dirtied', () => {
  it('reveals nothing on a fresh state', () => {
    const s = initialRevealState();
    for (const f of VALIDATION_FIELDS) expect(shouldReveal(s, f)).toBe(false);
  });

  it('reveals only the touched field group', () => {
    const s = markTouched(initialRevealState(), 'quizChoices');
    expect(shouldReveal(s, 'quizChoices')).toBe(true);
    expect(shouldReveal(s, 'numericAnswer')).toBe(false);
  });

  it('is monotonic and a repeat touch is a no op', () => {
    const s1 = markTouched(initialRevealState(), 'quizChoices');
    const s2 = markTouched(s1, 'quizChoices');
    expect(s2).toBe(s1);
    const s3 = markTouched(s2, 'numericAnswer');
    expect(shouldReveal(s3, 'quizChoices')).toBe(true);
    expect(shouldReveal(s3, 'numericAnswer')).toBe(true);
    // The earlier state is untouched (a new state is returned every time).
    expect(shouldReveal(s1, 'numericAnswer')).toBe(false);
  });

  it('reveals everything when opened from the readiness surface', () => {
    const s = initialRevealState({ revealAll: true });
    for (const f of VALIDATION_FIELDS) expect(shouldReveal(s, f)).toBe(true);
  });

  it('is total over the ValidationField union', () => {
    const all: ValidationField[] = [
      'title', 'quizChoices', 'quizOrdering', 'numericAnswer',
      'stationCode', 'sequenceSteps', 'surveyChoices', 'placement',
    ];
    expect([...VALIDATION_FIELDS].sort()).toEqual([...all].sort());
    const s = initialRevealState();
    for (const f of all) expect(typeof shouldReveal(s, f)).toBe('boolean');
  });
});

describe('nextFinishAction never traps the creator', () => {
  it('reveals first, then closes', () => {
    let s = initialRevealState();
    expect(nextFinishAction(s, ['quizChoices'])).toBe('reveal');
    s = markTouched(s, 'quizChoices');
    expect(nextFinishAction(s, ['quizChoices'])).toBe('close');
  });

  it('closes immediately when there is no blocker', () => {
    expect(nextFinishAction(initialRevealState(), [])).toBe('close');
  });

  it('closes immediately when everything is already revealed', () => {
    const s = initialRevealState({ revealAll: true });
    expect(nextFinishAction(s, ['quizChoices', 'numericAnswer'])).toBe('close');
  });
});

describe('taskRevealBlockers names the messages a task would show', () => {
  it('is empty for a task that can be completed', () => {
    expect(taskRevealBlockers(task({ type: 'field' }))).toEqual([]);
    expect(taskRevealBlockers(task({ type: 'photo' }))).toEqual([]);
    expect(taskRevealBlockers(task({ type: 'survey' }))).toEqual([]);
    expect(taskRevealBlockers(task({ type: 'numeric', numericAnswer: 42 }))).toEqual([]);
  });

  it('names both quiz groups for an unfinished quiz, so the mounted editor speaks', () => {
    const blockers = taskRevealBlockers(task({ type: 'quiz' }));
    expect(blockers).toContain('quizChoices');
    expect(blockers).toContain('quizOrdering');
  });

  it('names the numeric, station and sequence groups', () => {
    expect(taskRevealBlockers(task({ type: 'numeric' }))).toEqual(['numericAnswer']);
    expect(taskRevealBlockers(task({ type: 'smart_station' }))).toEqual(['stationCode']);
    expect(taskRevealBlockers(task({ type: 'sequence' }))).toEqual(['sequenceSteps']);
  });

  it('never names placement, which is disclosed unconditionally', () => {
    expect(taskRevealBlockers(task({ type: 'field' }))).not.toContain('placement');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Samples (D4)
// ─────────────────────────────────────────────────────────────────────────────
const ALL_TYPES = Object.keys(TASK_SAMPLES) as TaskType[];

describe('every task type offers a working sample', () => {
  it('yields at least one labelled sample per type', () => {
    for (const type of ALL_TYPES) {
      const samples = samplesForType(type);
      expect(samples.length).toBeGreaterThan(0);
      for (const s of samples) {
        expect(s.label.trim()).not.toBe('');
        expect((s.patch.title ?? '').trim()).not.toBe('');
      }
    }
  });

  it('preserves id, coordinates and trigger mode for every sample in the catalogue', () => {
    for (const type of ALL_TYPES) {
      for (const sample of samplesForType(type)) {
        const draft = task({
          id: 'keep-me', type, coordinates: { lat: 31.77, lng: 35.21 }, triggerMode: 'exact',
        });
        const next = applySample(draft, sample);
        expect(next.id).toBe('keep-me');
        expect(next.coordinates).toEqual({ lat: 31.77, lng: 35.21 });
        expect(next.triggerMode).toBe('exact');
        expect(next.locationless).toBeUndefined();
      }
    }
  });

  it('produces a completable task for every sample in the catalogue', () => {
    for (const type of ALL_TYPES) {
      for (const sample of samplesForType(type)) {
        const next = applySample(task({ type }), sample);
        expect({ type, label: sample.label, valid: isTaskInteractionValid(next) })
          .toEqual({ type, label: sample.label, valid: true });
      }
    }
  });
});

describe('sampleWouldOverwrite guards authored content', () => {
  it('returns nothing for a blank draft', () => {
    expect(sampleWouldOverwrite(task(), TASK_SAMPLES.quiz[0])).toEqual([]);
  });

  it('names the authored title, description and answer key', () => {
    const authored = task({
      type: 'quiz', title: 'My own quiz', description: 'My own description',
      choices: ['a', 'b'], answers: ['a'],
    });
    const fields = sampleWouldOverwrite(authored, TASK_SAMPLES.quiz[0]);
    expect(fields).toContain('title');
    expect(fields).toContain('description');
    expect(fields).toContain('answerKey');
  });

  it('names only the fields the sample actually replaces', () => {
    const titled = task({ title: 'My own quiz' });
    expect(sampleWouldOverwrite(titled, TASK_SAMPLES.quiz[0])).toEqual(['title']);
  });

  it('sees a station secret code as an authored answer key', () => {
    const coded = task({
      type: 'smart_station',
      smart: { enabled: true, verificationType: 'code_verification', secretCode: 'MINE' },
    });
    expect(sampleWouldOverwrite(coded, TASK_SAMPLES.smart_station[0])).toContain('answerKey');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Game readiness (D5) — shared by the panel and the launch guard
// ─────────────────────────────────────────────────────────────────────────────
describe('computeGameReadiness reports every blocking issue at once', () => {
  it('reports three uncompletable tasks as three issues, not one', () => {
    const g = game([stage({
      tasks: [
        readyTask({ id: 'a', type: 'quiz' }),
        readyTask({ id: 'b', type: 'numeric' }),
        readyTask({ id: 'c', type: 'smart_station' }),
      ],
    })]);
    const issues = computeGameReadiness(g);
    expect(issues.filter((i) => i.code === 'taskNotCompletable')).toHaveLength(3);
    expect(issues.map((i) => i.taskId)).toEqual(['a', 'b', 'c']);
  });

  it('reports a stage with no tasks', () => {
    const issues = computeGameReadiness(game([stage({ tasks: [] })]));
    expect(issues.map((i) => i.code)).toEqual(['stageHasNoTask']);
    expect(issues[0].stageId).toBe('s1');
  });

  it('reports an empty game with no stage to navigate to', () => {
    const issues = computeGameReadiness(game([]));
    expect(issues.map((i) => i.code)).toEqual(['stageHasNoTask']);
    expect(issues[0].stageId).toBe('');
  });

  it('reports a located task with no pin', () => {
    const g = game([stage({ tasks: [task({ id: 'a', title: 'No pin' })] })]);
    const issues = computeGameReadiness(g);
    expect(issues.map((i) => i.code)).toEqual(['taskNotPlaced']);
    expect(issues[0].taskId).toBe('a');
    expect(issues[0].taskTitle).toBe('No pin');
  });

  it('does not report a locationless task at the unplaced default', () => {
    const g = game([stage({ tasks: [task({ id: 'a', triggerMode: 'locationless', locationless: true })] })]);
    expect(computeGameReadiness(g)).toEqual([]);
  });

  it('reports a stage that requires more completions than it can yield', () => {
    const g = game([stage({
      requiredTaskCount: 2,
      tasks: [
        readyTask({ id: 'a' }),
        readyTask({ id: 'b', unlockAfterTaskIds: ['missing'] }),
      ],
    })]);
    const codes = computeGameReadiness(g).map((i) => i.code);
    expect(codes).toContain('stageUnwinnable');
  });

  // Stage winnability (change: stage-winnability). Exclusive groups shrink what a
  // stage can yield — six tasks in three groups of two yield THREE — and readiness
  // consulted only the unlock graph, so a game a product owner could not finish
  // launched clean. This is the check that makes an ALREADY SAVED broken game
  // announce itself the next time its Builder is opened.
  it('reports a stage requiring more than its exclusive groups can yield', () => {
    const g = game([stage({
      requiredTaskCount: 6,
      tasks: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map((id) => readyTask({ id })),
      exclusiveGroups: [
        { id: 'g-a', taskIds: ['a1', 'a2'] },
        { id: 'g-b', taskIds: ['b1', 'b2'] },
        { id: 'g-c', taskIds: ['c1', 'c2'] },
      ],
    })]);
    const issues = computeGameReadiness(g);
    expect(issues.map((i) => i.code)).toContain('stageUnwinnable');
    expect(issues.find((i) => i.code === 'stageUnwinnable')?.stageId).toBe('s1');
    expect(canLaunchGame(g)).toBe(false);
    expect(firstLaunchBlocker(g)?.code).toBe('stageUnwinnable');
  });

  it('accepts a count that fits under the exclusive group ceiling', () => {
    const g = game([stage({
      requiredTaskCount: 3,
      tasks: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map((id) => readyTask({ id })),
      exclusiveGroups: [
        { id: 'g-a', taskIds: ['a1', 'a2'] },
        { id: 'g-b', taskIds: ['b1', 'b2'] },
        { id: 'g-c', taskIds: ['c1', 'c2'] },
      ],
    })]);
    expect(computeGameReadiness(g)).toEqual([]);
  });

  it('never blocks a grouped stage that leaves requiredTaskCount unset', () => {
    // Unset means "every task", which the stage satisfies by ending once no task
    // remains to do — the normal "pick one of these" shape must stay launchable.
    const g = game([stage({
      tasks: ['a1', 'a2'].map((id) => readyTask({ id })),
      exclusiveGroups: [{ id: 'g-a', taskIds: ['a1', 'a2'] }],
    })]);
    expect(computeGameReadiness(g)).toEqual([]);
  });

  it('orders issues by stage order then task order', () => {
    const g = game([
      stage({ id: 's1', order: 0, tasks: [readyTask({ id: 'a', type: 'quiz' }), readyTask({ id: 'b', type: 'numeric' })] }),
      stage({ id: 's2', order: 1, title: 'Stage two', tasks: [readyTask({ id: 'c', type: 'sequence' })] }),
    ]);
    const issues = computeGameReadiness(g);
    expect(issues.map((i) => [i.stageId, i.taskId])).toEqual([['s1', 'a'], ['s1', 'b'], ['s2', 'c']]);
  });

  it('gives every issue a resolvable stage and every task issue a resolvable task', () => {
    const g = game([stage({ tasks: [task({ id: 'a', type: 'quiz' })] })]);
    for (const issue of computeGameReadiness(g)) {
      expect(issue.stageId).toBe('s1');
      expect(issue.stageTitle).toBe('Stage one');
      if (issue.code === 'taskNotCompletable' || issue.code === 'taskNotPlaced') {
        expect(issue.taskId).toBe('a');
      }
    }
  });

  it('returns nothing for a fully valid game', () => {
    const g = game([stage({ tasks: [readyTask()] })]);
    expect(computeGameReadiness(g)).toEqual([]);
    expect(canLaunchGame(g)).toBe(true);
  });
});

describe('canLaunchGame is identical to the four legacy launch guards', () => {
  // The four predicates re-expressed inline from the pre change
  // BuilderPage.saveAndLaunch, so the extraction is proven faithful.
  const legacyRefuses = (g: Game): boolean => {
    if (g.stages.length === 0 || g.stages.some((s) => s.tasks.length === 0)) return true;
    if (g.stages.flatMap((s) => s.tasks).some((tk) => !isTaskInteractionValid(tk))) return true;
    if (g.stages.flatMap((s) => s.tasks).some((tk) => !isTaskLocationValid(tk))) return true;
    if (g.stages.some((s) => {
      const r = validateUnlockGraph(s);
      return r.warnings.length > 0 || r.errors.length > 0;
    })) return true;
    return false;
  };

  const table: { name: string; g: Game }[] = [
    { name: 'valid game', g: game([stage({ tasks: [readyTask()] })]) },
    { name: 'no stages', g: game([]) },
    { name: 'empty stage', g: game([stage({ tasks: [] })]) },
    { name: 'missing answer key', g: game([stage({ tasks: [readyTask({ type: 'quiz' })] })]) },
    { name: 'unpinned located task', g: game([stage({ tasks: [task({ title: 'no pin' })] })]) },
    {
      name: 'unwinnable stage',
      g: game([stage({ requiredTaskCount: 2, tasks: [readyTask({ id: 'a' }), readyTask({ id: 'b', unlockAfterTaskIds: ['ghost'] })] })]),
    },
    {
      name: 'locationless valid task',
      g: game([stage({ tasks: [task({ title: 'anywhere', triggerMode: 'locationless', locationless: true })] })]),
    },
    {
      name: 'several problems at once',
      g: game([
        stage({ id: 's1', tasks: [readyTask({ id: 'a', type: 'quiz' }), task({ id: 'b', title: 'no pin' })] }),
        stage({ id: 's2', order: 1, tasks: [] }),
      ]),
    },
  ];

  for (const row of table) {
    it(`agrees with the legacy guards for: ${row.name}`, () => {
      expect(canLaunchGame(row.g)).toBe(!legacyRefuses(row.g));
    });
  }

  it('reports at least one issue whenever it refuses', () => {
    for (const row of table) {
      expect(computeGameReadiness(row.g).length > 0).toBe(legacyRefuses(row.g));
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The SECOND duplicate: DashboardPage.launch carried its own four inline
  // predicates. It is now deduped onto `firstLaunchBlocker`, so these tests pin
  // both halves of that dedup: what stayed identical, and the one case where the
  // Dashboard copy had genuinely drifted from the Builder.
  // ───────────────────────────────────────────────────────────────────────────

  // The Dashboard's pre change guards, re-expressed inline from
  // DashboardPage.launch. Note the FIRST line: unlike the Builder it never
  // checked `s.tasks.length === 0`.
  const legacyDashboardRefuses = (g: Game): boolean => {
    if (g.stages.length === 0) return true;
    if (g.stages.flatMap((s) => s.tasks).some((tk) => !isTaskInteractionValid(tk))) return true;
    if (g.stages.flatMap((s) => s.tasks).some((tk) => !isTaskLocationValid(tk))) return true;
    if (g.stages.some((s) => {
      const r = validateUnlockGraph(s);
      return r.warnings.length > 0 || r.errors.length > 0;
    })) return true;
    return false;
  };

  it('firstLaunchBlocker returns null exactly when the launch is allowed', () => {
    for (const row of table) {
      expect(firstLaunchBlocker(row.g) === null).toBe(canLaunchGame(row.g));
    }
  });

  it('agrees with the legacy DASHBOARD guards on every game they both judged', () => {
    // Every row except the one the Dashboard was blind to (see the next test).
    for (const row of table.filter((r) => r.name !== 'empty stage')) {
      expect({ name: row.name, refuses: firstLaunchBlocker(row.g) !== null })
        .toEqual({ name: row.name, refuses: legacyDashboardRefuses(row.g) });
    }
  });

  // REAL BUG, not a refactor artefact: a game whose only stage has no tasks was
  // refused by the Builder and LAUNCHED by the Dashboard. `validateUnlockGraph`
  // is silent on an empty stage (no requiredTaskCount, so no warning), so
  // nothing else caught it. Deduping onto gameReadiness closes the hole.
  it('closes the empty stage hole the Dashboard guards had', () => {
    const g = game([stage({ tasks: [] })]);
    expect(legacyDashboardRefuses(g)).toBe(false);   // the old Dashboard launched it
    expect(legacyRefuses(g)).toBe(true);             // the Builder always refused it
    expect(firstLaunchBlocker(g)?.code).toBe('stageHasNoTask');
  });

  // The Dashboard names ONE offender (it has no readiness panel to point at), so
  // the issue it names must be the same one the old sequential guards reached
  // first: stage emptiness, then answer key, then pin, then unwinnable stage.
  it('names the same first offender the sequential guards named', () => {
    expect(firstLaunchBlocker(game([]))).toEqual({ code: 'stageHasNoTask', stageId: '', stageTitle: '' });
    expect(firstLaunchBlocker(game([stage({ tasks: [readyTask({ id: 'a', type: 'quiz', title: 'Q' })] })])))
      .toMatchObject({ code: 'taskNotCompletable', taskId: 'a', taskTitle: 'Q' });
    expect(firstLaunchBlocker(game([stage({ tasks: [task({ id: 'a', title: 'no pin' })] })])))
      .toMatchObject({ code: 'taskNotPlaced', taskId: 'a', taskTitle: 'no pin' });
    expect(firstLaunchBlocker(game([stage({
      requiredTaskCount: 2,
      tasks: [readyTask({ id: 'a' }), readyTask({ id: 'b', unlockAfterTaskIds: ['ghost'] })],
    })]))).toMatchObject({ code: 'stageUnwinnable', stageId: 's1', stageTitle: 'Stage one' });
    expect(firstLaunchBlocker(game([stage({ tasks: [readyTask()] })]))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Honest opt-in badge (D6, carried over to the chip model by
//    task-editor-progressive-disclosure — the "advanced section" this block used
//    to describe was replaced by the timer/points opt-in group)
// ─────────────────────────────────────────────────────────────────────────────
describe('the timer/points group reports what a task actually carries', () => {
  const fresh = blankTask('t1');

  it('counts an expiry and mounts the group', () => {
    const t = { ...fresh, expiresAfterMinutes: 30 };
    expect(groupSummary('timerPoints', t)).toBe(1);
    expect(defaultActiveGroups(t).timerPoints).toBe(true);
  });

  it('counts an expiry plus a scheduled release as two', () => {
    const t = { ...fresh, expiresAfterMinutes: 30, releaseAt: '2026-01-01T10:00:00.000Z' };
    expect(groupSummary('timerPoints', t)).toBe(2);
  });

  it('counts a delayed release', () => {
    expect(groupSummary('timerPoints', { ...fresh, releaseAfterMinutes: 15 })).toBe(1);
  });

  it('shows no badge for a fresh task and leaves the group as a chip', () => {
    expect(groupSummary('timerPoints', fresh)).toBe(0);
    expect(defaultActiveGroups(fresh).timerPoints).toBe(false);
  });

  it('does not count the derived estimate every task ships with', () => {
    // `estimatedMinutes` is seeded on every task, so it can never signal
    // authorship — counting it would mount the group for every task ever made.
    expect(groupSummary('timerPoints', { ...fresh, estimatedMinutes: 40 })).toBe(0);
  });

  it('DOES count a point value the creator actually chose', () => {
    // A deliberate change from the old advanced badge, which ignored points: a
    // creator who set 250 must see that where they set it, not behind a chip.
    expect(groupSummary('timerPoints', { ...fresh, pointValue: 250 })).toBe(1);
    expect(defaultActiveGroups({ ...fresh, pointValue: 250 }).timerPoints).toBe(true);
  });

  it('derives the mounted flag from the same count', () => {
    const table: Task[] = [
      fresh,
      { ...fresh, expiresAfterMinutes: 30 },
      { ...fresh, releaseAfterMinutes: 5 },
      { ...fresh, releaseAt: '2026-01-01T10:00:00.000Z' },
      { ...fresh, pointValue: 500 },
    ];
    for (const t of table) {
      expect(defaultActiveGroups(t).timerPoints).toBe(groupSummary('timerPoints', t) > 0);
    }
  });
});
