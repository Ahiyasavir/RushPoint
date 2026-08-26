// How far through the run is this team, counted in MISSIONS (change:
// test-mode-game-feel).
//
// PlayScreen used to render `<Progress done={completedStages}
// total={team.stages.length} />`. That is correct for a five-stage city race and
// useless for the shape assessments actually take: ONE stage holding 20-24
// questions. A whole run then showed a single empty segment that only moved when
// the run ended — twenty answers with no signal that anything was happening, which
// is most of why a sealed test-mode run felt like a form rather than a game.
//
// Counting missions is also what makes an honest "question 8 of 20" counter
// possible, and that counter incidentally fixes a second complaint: adaptive
// routing hands questions out in fit order, so the TITLES a player sees jump
// around ("question 2" before "question 1"). `current` is position in THEIR run,
// which never goes backwards.
//
// Pure, DOM-free, framework-free; covered by scripts/test-mission-progress.ts.
// TOTAL by contract: it runs on every render of the participant's only screen,
// over a server-written document, so a malformed stage degrades to zero rather
// than taking the screen down.

/** The subset of `RunStageRecord` this reads. Structural on purpose, so a caller
 *  can pass the real shared type without this module importing React or Firebase. */
export interface StageLike {
  status?: unknown;
  requiredTaskCount?: unknown;
  tasks?: unknown;
}

export interface MissionProgress {
  /** Missions finished, clamped to `total`. */
  done: number;
  /** Missions this team must finish to reach the end of the run. */
  total: number;
  /** 1-based position of the mission in hand — `done + 1`, clamped. 0 when empty. */
  current: number;
  /** Stages finished (kept for callers that still want stage granularity). */
  stageDone: number;
  /** Stages in the run. */
  stageTotal: number;
}

const EMPTY: MissionProgress = { done: 0, total: 0, current: 0, stageDone: 0, stageTotal: 0 };

/**
 * How many missions this stage contributes to the finish line.
 *
 * `requiredTaskCount` is a PARTIAL stage: finish N of M and the rest auto-skip, so
 * the honest denominator is N. Anything that is not a positive whole number within
 * the stage's own task count is not a requirement — it falls back to "all of them"
 * rather than shrinking a player's run on a bad document.
 */
function stageRequirement(stage: StageLike): number {
  const tasks = Array.isArray(stage.tasks) ? stage.tasks.length : 0;
  const req = stage.requiredTaskCount;
  if (typeof req !== 'number' || !Number.isInteger(req) || req <= 0) return tasks;
  return Math.min(req, tasks);
}

/** Completed task records in this stage. */
function stageCompleted(stage: StageLike): number {
  if (!Array.isArray(stage.tasks)) return 0;
  let n = 0;
  for (const rec of stage.tasks) {
    if (rec && typeof rec === 'object' && (rec as { status?: unknown }).status === 'completed') n++;
  }
  return n;
}

/**
 * Mission-level progress for a team, summed across every stage of the run.
 *
 * A stage whose own `status` is 'completed' credits its FULL requirement, not its
 * completed task records. `skipStage` (and its consolation award) finishes a stage
 * without finishing its tasks, so counting records alone would leave the bar
 * permanently short of full for a team that did nothing wrong.
 */
export function missionProgress(stages: readonly StageLike[] | null | undefined): MissionProgress {
  if (!Array.isArray(stages)) return EMPTY;

  let done = 0;
  let total = 0;
  let stageDone = 0;
  let stageTotal = 0;

  for (const raw of stages) {
    const stage = (raw && typeof raw === 'object' ? raw : {}) as StageLike;
    stageTotal++;
    const need = stageRequirement(stage);
    total += need;
    const finished = stage.status === 'completed';
    if (finished) stageDone++;
    // Clamp per stage, not just at the end: a partial stage can auto-skip its
    // siblings AFTER more than `requiredTaskCount` completions have landed, and
    // that surplus must not eat another stage's share of the bar.
    done += finished ? need : Math.min(stageCompleted(stage), need);
  }

  if (total <= 0) return { ...EMPTY, stageDone, stageTotal };
  done = Math.max(0, Math.min(done, total));
  return { done, total, current: Math.min(done + 1, total), stageDone, stageTotal };
}
