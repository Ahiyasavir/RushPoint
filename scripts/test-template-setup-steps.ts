// Pure-logic tests — the built-in templates carry no creator instructions in
// player-facing content (change: quick-setup-wizard).
//
// The regression this file exists to prevent is the one that shipped: a template
// whose seeded prose reads "(ערכו את התשובה)" to a PLAYER, and — worse — two
// templates whose literal ANSWER KEY was "(ערכו את התשובה) / (edit this answer)",
// so a team that answered honestly was graded wrong and a team that typed the
// instruction back was graded right.
//
// Nothing about that was catchable by any existing gate: a placeholder is a
// structurally valid answer key, so `computeGameReadiness` launches it clean.
//
//   npx tsx scripts/test-template-setup-steps.ts
import { TEMPLATES, templateWizardSteps } from '../apps/creator-web/src/templates';
import { isPlaceholderValue, resolveWizardTarget, orderQuickSetupSteps } from '../packages/shared/src/templateWizard';
import type { Stage, Task } from '../packages/shared/src/types';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}

/** Every string a PARTICIPANT can read, from one template's seeded stages. */
function playerFacingStrings(stages: Stage[]): string[] {
  const out: string[] = [];
  for (const stage of stages) {
    out.push(stage.title ?? '');
    const n = stage.narrative;
    out.push(n?.intro?.title ?? '', n?.intro?.body ?? '', n?.intro?.bodyHe ?? '', n?.outro?.body ?? '', n?.outro?.bodyHe ?? '');
    for (const task of stage.tasks as Task[]) {
      out.push(task.title ?? '', task.description ?? '', task.hint ?? '', task.locationClue ?? '');
      out.push(...(task.answers ?? []), ...(task.surveyChoices ?? []), ...(task.choices ?? []));
      for (const step of task.steps ?? []) out.push(step.prompt ?? '', step.answer ?? '');
      out.push(task.smart?.longInstructions ?? '', task.smart?.secretCode ?? '');
    }
  }
  return out.filter((s) => typeof s === 'string' && s.trim() !== '');
}

console.log('\nno operator note reaches a player');
for (const template of TEMPLATES) {
  const stages = template.build();
  const leaks = playerFacingStrings(stages).filter(isPlaceholderValue);
  ok(`${template.key}: nothing player-facing is a placeholder${leaks.length ? ` — ${JSON.stringify(leaks[0])}` : ''}`, leaks.length === 0);
}

console.log('\nthe removed instructions became הקמה מהירה steps');
{
  // Every template that HAD placeholders must now declare setup, or the
  // instruction was simply deleted rather than moved.
  const withSetup = TEMPLATES.filter((t) => (t.setup?.length ?? 0) > 0).map((t) => t.key);
  ok(`templates declaring setup: ${withSetup.join(', ')}`, withSetup.length >= 8);
  ok('every quick-start template that seeds an answer key a creator must personalise declares one',
    ['bar_mitzvah', 'corporate', 'birthday', 'school_race', 'wedding', 'conference', 'city_tour', 'riddle']
      .every((k) => withSetup.includes(k)));
}

console.log('\nevery declared step resolves against the stages it was declared for');
for (const template of TEMPLATES) {
  if (!template.setup?.length) continue;
  const stages = template.build();
  const steps = templateWizardSteps(stages, template.setup);
  const game = { stages };
  ok(`${template.key}: every step points at a real mission field`,
    steps.length === template.setup.length && steps.every((s) => resolveWizardTarget(game, s) !== null));
  ok(`${template.key}: every step has a prompt and a unique id`,
    steps.every((s) => s.instructionPrompt.trim() !== '') && new Set(steps.map((s) => s.id)).size === steps.length);
  ok(`${template.key}: the flow orders them without dropping any`,
    orderQuickSetupSteps(game, steps).length === steps.length);
  // Fresh ids per build() call, so two games made from one template must not
  // share step targets.
  const other = templateWizardSteps(template.build(), template.setup);
  ok(`${template.key}: a second instantiation points at ITS own missions`,
    steps.every((s, i) => s.taskId !== other[i].taskId || s.taskId === ''));
}

console.log('\ntemplateWizardSteps is total');
{
  ok('no setup yields no steps', templateWizardSteps([], undefined).length === 0);
  ok('a step declared out of range is dropped, not emitted dangling',
    templateWizardSteps(TEMPLATES[1].build(), [{ stage: 99, task: 0, field: 'answers', prompt: 'x' }]).length === 0);
  ok('a stage-level step needs no task',
    templateWizardSteps(TEMPLATES[1].build(), [{ stage: 0, task: -1, field: 'title', prompt: 'x' }]).length === 1);
}

console.log(failures === 0 ? '\n✅ template-setup-steps: ALL PASS' : `\n❌ template-setup-steps: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
