// Quick Setup and the mission editor's settings rows (change: mission-editor-value-rows).
//
// Quick Setup walks a creator through a template's notes, opening the editor at the right control.
// When step 3's chips became rows, two things had to stay true: every field a step can target names a
// row that really holds it, and a step that targets a field this game's scoring ignores (difficulty in
// a points game, points in a speed race) is left out, because that control is no longer shown and the
// step would land on nothing. It must not block the launch either.
import type { Game, Stage, Task } from '../packages/shared/src/types';
import type { TemplateWizardStep } from '../packages/shared/src/templateWizard';
import { QUICK_SETUP_FIELDS, quickSetupSteps, quickSetupLaunchBlockers } from '../apps/creator-web/src/lib/quickSetup';
import { SETTINGS_ROW_KEYS } from '../apps/creator-web/src/lib/missionSettingsRows';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS  ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`); }
}

// ── every target names a real place ────────────────────────────────────────
const validGroups = new Set<string>([...SETTINGS_ROW_KEYS, 'locationAdvanced']);
const badEntries = Object.entries(QUICK_SETUP_FIELDS).filter(([, e]) => e.optInGroup !== null && !validGroups.has(e.optInGroup));
check(`every Quick Setup field opens a real row (checked ${Object.keys(QUICK_SETUP_FIELDS).length} fields)`,
  badEntries.length === 0, badEntries.map(([k, e]) => `${k}→${e.optInGroup}`).join(', '));
const want: Record<string, string> = {
  pointValue: 'scoring', difficulty: 'scoring', hint: 'hint', hintPenalty: 'hint',
  unlockAfterTaskIds: 'opens', maxConcurrentTeams: 'more', tags: 'more', expectedDurationMinutes: 'more',
};
for (const [field, row] of Object.entries(want)) {
  check(`${field} opens the "${row}" row`, QUICK_SETUP_FIELDS[field]?.optInGroup === row, String(QUICK_SETUP_FIELDS[field]?.optInGroup));
}

// ── a step the game's scoring ignores is left out ──────────────────────────
const task = (over: Partial<Task> & { id: string }) => ({
  title: 'משימה', type: 'field', coordinates: { lat: 31.77, lng: 35.23 },
  difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 1, ...over,
}) as Task;
const stages: Stage[] = [{ id: 's1', title: 'שלב', order: 0, tasks: [task({ id: 't1' })] } as unknown as Stage];
const step = (id: string, targetFieldPath: string, isRequired = true): TemplateWizardStep =>
  ({ id, stageId: 's1', taskId: 't1', targetFieldPath, instructionPrompt: 'כתבו', isRequired });
const steps = [step('a', 'description'), step('b', 'difficulty'), step('c', 'pointValue'), step('d', 'expectedDurationMinutes')];
const game = (scoringPreset: string): Game => ({
  id: 'g1', ownerUid: 'u1', title: 'משחק', mode: 'team', stages, scoringPreset,
  registrationFields: [], visibility: 'private', tags: [], playCount: 0, createdAt: '', updatedAt: '', wizardSteps: steps,
} as unknown as Game);
const idsOf = (g: Game) => quickSetupSteps(g).map((s) => s.id).filter((id) => ['a', 'b', 'c', 'd'].includes(id)).sort().join('');

check('points game: the difficulty step is left out', idsOf(game('fixed_points_speed')) === 'acd', idsOf(game('fixed_points_speed')));
check('smart score: points and time-at-the-stop are left out, difficulty kept', idsOf(game('smart_weighted')) === 'ab', idsOf(game('smart_weighted')));
check('speed race: all three scoring steps are left out', idsOf(game('time_only')) === 'a', idsOf(game('time_only')));
check('a game with no preset behaves as the default (points)', idsOf(game(undefined as never)) === 'acd', idsOf(game(undefined as never)));
check('a left-out step never blocks the launch',
  !quickSetupLaunchBlockers(game('fixed_points_speed')).some((s) => s.id === 'b'));

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
