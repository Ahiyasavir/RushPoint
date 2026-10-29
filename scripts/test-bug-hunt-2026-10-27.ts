// The bug hunt of 2026-10-27, pinned: each block is one finding that was confirmed in the code and
// fixed. (1) the setup walk's list shrank under the creator's typing; (2) a game launched with a
// creator blank still in a mission; (4) a swapped mission kept the old mission's setup steps;
// (5) a mission handed back to a team counted its countdown from an old arrival.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeLimitClockStart } from '../packages/shared/src/taskTimeLimit';
import {
  setupFlowSteps, keepSeenSentenceSteps, quickSetupLaunchBlockers, withoutStepsForTask, withSwappedSteps,
} from '../apps/creator-web/src/lib/quickSetup';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`);
  if (!cond) failures++;
}

const blankTask = { id: 't1', type: 'self_report', title: 'הספסל', description: 'לכו אל [הוראות ליוצר: המקום] וסמנו.', locationless: true, triggerMode: 'locationless' };
const game = (task: object, extra: object = {}) => ({ id: 'g', title: 'x', scoringPreset: 'fixed_points_speed', stages: [{ id: 's1', order: 0, title: 'a', isFinal: true, tasks: [task] }], ...extra }) as never;

// (1) The list does not shrink when the last blank is typed into.
{
  const before = setupFlowSteps(game(blankTask));
  const sentence = before.filter((s) => s.id.startsWith('qs-synthetic-sentence:'));
  ok('a blank makes a sentence step', sentence.length === 1, before.map((s) => s.id));
  const typed = game({ ...blankTask, description: 'לכו אל ה וסמנו.' });
  const raw = setupFlowSteps(typed);
  ok('without the fix the step disappears after one letter (the bug)', raw.length === before.length - 1);
  const kept = keepSeenSentenceSteps(typed, raw, before);
  ok('keepSeenSentenceSteps keeps the screen being typed on', kept.length === before.length && kept.some((s) => s.id === sentence[0].id));
  ok('a step of a mission that no longer exists is not kept',
    keepSeenSentenceSteps(game({ ...blankTask, id: 'other', description: 'x' }), [], before).length === 0);
}

// (2) A blank blocks the launch.
{
  ok('an open creator blank blocks the launch', quickSetupLaunchBlockers(game(blankTask)).some((s) => s.targetFieldPath === 'description'));
  ok('a filled one does not', !quickSetupLaunchBlockers(game({ ...blankTask, description: 'לכו אל הספסל וסמנו.' })).some((s) => s.targetFieldPath === 'description'));
}

// (4) A swapped mission sheds the old mission's authored steps, and only those.
{
  const g = game(blankTask, { wizardSteps: [
    { id: 'a', stageId: 's1', taskId: 't1', targetFieldPath: 'media', instructionPrompt: '', isRequired: true },
    { id: 'b', stageId: 's1', taskId: 't9', targetFieldPath: 'coordinates', instructionPrompt: '', isRequired: true },
  ] }) as { wizardSteps: { id: string }[] };
  const out = withoutStepsForTask(g as never, 't1') as { wizardSteps: { id: string }[] };
  ok('the swapped mission\'s steps are dropped, the others kept', out.wizardSteps.map((s) => s.id).join() === 'b');
  ok('a game with nothing to drop is returned as is', withoutStepsForTask(out as never, 't1') === out);
  const builder = readFileSync(join(process.cwd(), 'apps/creator-web/src/pages/BuilderPage.tsx'), 'utf8');
  ok('both swaps (setup walk and mission card) go through withSwappedSteps', (builder.match(/setGame\(withSwappedSteps\(/g) ?? []).length >= 2);
  // 28.10, found live: a swap also brings the NEW mission's own steps, and the editor's swap moves them too.
  const swapped = withSwappedSteps(g as never, 't1', [
    { id: 'n', stageId: 's1', taskId: 't1', targetFieldPath: 'description', instructionPrompt: 'new', isRequired: true },
  ]) as { wizardSteps: { id: string; instructionPrompt: string }[] };
  ok("a swap drops the old mission's steps and adds the new one's", swapped.wizardSteps.map((s) => s.id).join() === 'b,n');
  ok("the editor's swap moves the steps too, after its own flush", /queueMicrotask\(\(\) => onSwapSteps\(source\.id, swap\.steps\)\)/.test(builder));
  ok("the swapped-in mission's steps come from ITS bank entry", /picked\.setup \?\? \[\]/.test(builder));
}

// (5) The countdown of a mission handed back starts no earlier than the hand-over.
{
  const located = { coordinates: { lat: 31.77, lng: 35.21 }, triggerMode: 'radius', timeLimitMinutes: 4 };
  const start = timeLimitClockStart(located, { startedAt: '2026-10-27T10:20:00.000Z', arrivedAt: '2026-10-27T10:05:00.000Z' }, true);
  ok('an arrival older than the hand-over is not this hold\'s clock', start === '2026-10-27T10:20:00.000Z', start);
  const fresh = timeLimitClockStart(located, { startedAt: '2026-10-27T10:20:00.000Z', arrivedAt: '2026-10-27T10:24:00.000Z' }, true);
  ok('a real arrival still starts the clock', fresh === '2026-10-27T10:24:00.000Z', fresh);
  const runs = readFileSync(join(process.cwd(), 'functions/src/runs/index.ts'), 'utf8');
  ok('both displacement paths clear the arrival', (runs.match(/delete inFlight\.startedAt;[\s\S]{0,200}?delete inFlight\.arrivedAt;/g) ?? []).length >= 2);
}

console.log(failures === 0 ? '\n✅ bug hunt 2026-10-27: ALL PASS' : `\n❌ bug hunt 2026-10-27: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
