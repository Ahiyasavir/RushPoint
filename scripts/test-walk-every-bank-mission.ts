// Every bank mission survives the creator's setup walk (founder, 27.10).
//
// "Every mission in the bank must work in the setup walk", above all the ones that need something
// besides a pin: a picture, a code, an answer, the order of items, choices, a hint, a hidden
// mission's clue, a blank in its sentence. For EVERY bank entry this builds the one-stage game the
// composer would (as authored, and pinned when the composer would site it, and hidden when the
// composer would hide it), runs the walk's own step list (`setupFlowSteps`) and, for each step:
//   1. it points at a real field (`resolveWizardTarget`);
//   2. an empty or placeholder field does not read as done;
//   3. after filling it the way the walk's own box does (SetupFlow.tsx FieldInput), it reads as done.
// Then the game has no launch blocker left and no blank left in any text a player reads.
//
// Section 0 pins the bug that started this: the walk's "blank" (sentenceForm `SLOT`) and Quick
// Setup's "done yet?" (`isPlaceholderValue`) had two definitions, so a `[creator: …]` or a
// `[הוראות למארגן: …]` was a box to fill in the walk and already finished to the launch check.
//   npx tsx scripts/test-walk-every-bank-mission.ts
import type { Game, Stage, Task, TaskMedia, TemplateWizardStep } from '@rushpoint/shared';
import {
  isPlaceholderValue, isWizardStepConfigured, resolveWizardTarget, readWizardFieldValue,
  RUSHPOINT_UPLOAD_ORIGINS, isTaskMediaValid,
} from '@rushpoint/shared';
import { TASK_BANK, type TaskBankEntry } from '../apps/creator-web/src/taskBank';
import { bankSiting } from '../apps/creator-web/src/lib/composeGame';
import { setupFlowSteps, quickSetupLaunchBlockers, SENTENCE_FIELDS } from '../apps/creator-web/src/lib/quickSetup';
import { asCreatorBlanks, fillTemplate, hasOpenSlots, parseSentence } from '../apps/creator-web/src/lib/sentenceForm';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  if (cond) return;
  failures++;
  console.error(`  ✗ ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`);
}
function pass(label: string): void { console.log(`  ✓ ${label}`); }

// ── 0. One definition of a creator blank ────────────────────────────────────
console.log('\n0. a blank to the walk is a blank to the launch check');
const BLANKS = [
  'Go to [creator: the stall] now.',
  'Go to [Creator: the stall] now.',
  'לכו ל[הוראות למארגן: הדוכן] עכשיו.',
  'לכו ל[הערה למארגן: הדוכן] עכשיו.',
  'Meet at [organizer: the gate].',
  'Meet at [organiser: the gate].',
  'לכו ל[הוראות ליוצר: הדוכן] עכשיו.',
  'לכו ל[הוראות למפעיל: הדוכן] עכשיו.',
  asCreatorBlanks('Go to [the stall]'),
  asCreatorBlanks('לכו ל [הדוכן]'),
];
let disagree = 0;
for (const text of BLANKS) {
  const walk = hasOpenSlots(text);
  const launch = isPlaceholderValue(text);
  console.log(`  ${walk && launch ? 'GREEN' : 'RED  '} walk=${walk} launch=${launch}  ${text}`);
  ok(`"${text}" is a blank to both`, walk && launch, { walk, launch });
  if (!(walk && launch)) disagree++;
  // And a step pointing at it is not done.
  const g = { title: 'g', stages: [{ id: 's', order: 0, title: '', tasks: [{ id: 't', title: 'x', description: text }] }] } as unknown as Game;
  ok(`a step on "${text}" is not done`, !isWizardStepConfigured(g, { id: 'q', stageId: 's', taskId: 't', targetFieldPath: 'description', instructionPrompt: '', isRequired: true }));
}
if (disagree === 0) pass(`all ${BLANKS.length} blank forms agree`);

// ── 1. Every bank mission through the walk ──────────────────────────────────
console.log('\n1. every bank mission, walked');
const UPLOAD = `${RUSHPOINT_UPLOAD_ORIGINS[0]}/uploads/walk-test.jpg`;
const PIN = { lat: 31.7767, lng: 35.2345 };
ok('the simulated upload is a media entry the product accepts', isTaskMediaValid({ kind: 'image', url: UPLOAD }));

type Variant = 'authored' | 'sited' | 'hidden';
interface Built { game: Game; task: Task }

function build(entry: TaskBankEntry, variant: Variant): Built {
  const task = { ...entry.build() } as Task;
  const steps: TemplateWizardStep[] = [];
  if (variant !== 'authored') {
    task.locationless = false;
    task.triggerMode = 'radius';
    steps.push({ id: 'qs-0-placed-coordinates', stageId: 's1', taskId: task.id, targetFieldPath: 'coordinates', instructionPrompt: 'Place it.', isRequired: true });
  }
  for (const s of entry.setup ?? []) {
    steps.push({ id: `qs-0-${s.field}`, stageId: 's1', taskId: task.id, targetFieldPath: s.field, instructionPrompt: s.prompt, isRequired: s.required === true });
  }
  if (variant === 'hidden') {
    task.hideLocation = true;
    steps.push({ id: `qs-hidden-${task.id}-locationClue`, stageId: 's1', taskId: task.id, targetFieldPath: 'locationClue', instructionPrompt: 'Write the clue.', isRequired: true });
  }
  const stage: Stage = { id: 's1', order: 0, title: '', requiredTaskCount: 1, tasks: [task], isFinal: true } as Stage;
  const game = { id: 'g1', ownerUid: 'u', title: 'משחק בדיקה', description: '', stages: [stage], wizardSteps: steps, scoringPreset: 'smart_weighted', mode: 'team' } as unknown as Game;
  return { game, task };
}

const taskOf = (g: Game): Task => g.stages[0].tasks[0];
const TEXT = 'טקסט שהיוצר כתב';

/** Is this value, as stored, still something the creator owes? Independent of the predicate under test. */
function looksEmpty(field: string, value: unknown, task: Task): boolean {
  if (field === 'coordinates') {
    if (task.locationless === true || task.triggerMode === 'locationless') return false;
    const c = value as { lat?: number; lng?: number } | undefined;
    return !c || (c.lat === 0 && c.lng === 0);
  }
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '' || isPlaceholderValue(value) || hasOpenSlots(value);
  if (Array.isArray(value)) return value.length === 0 || value.some((v) => typeof v === 'string' && (v.trim() === '' || isPlaceholderValue(v) || hasOpenSlots(v)));
  return false;
}

/** What the walk's own box does to the field (SetupFlow.tsx FieldInput). Returns false for a field the walk has no box for. */
function fill(game: Game, step: TemplateWizardStep): { game: Game; boxed: boolean } {
  const target = resolveWizardTarget(game, step);
  if (!target || target.scope !== 'task') return { game, boxed: true };
  const t = { ...taskOf(game) } as Task & Record<string, unknown>;
  const field = target.fieldPath;
  let boxed = true;
  // A sentence with blanks: every box typed into (SentenceBoxes → fillTemplate).
  if ((SENTENCE_FIELDS as readonly string[]).includes(field) && hasOpenSlots(t[field])) {
    const tpl = String(t[field]);
    const n = parseSentence(tpl).filter((p) => p.kind === 'slot').length;
    t[field] = fillTemplate(tpl, Array.from({ length: n }, (_, i) => `מילוי ${i + 1}`));
  } else {
    switch (field) {
      case 'coordinates': t.coordinates = { ...PIN }; break;
      case 'media': t.media = [...(t.media ?? []), { id: `m-${Math.random()}`, kind: 'image', url: UPLOAD } as TaskMedia]; break;
      case 'smart.secretCode': t.smart = { ...(t.smart ?? {}), secretCode: '3815' } as Task['smart']; break;
      case 'answers': {
        const choices = (t.choices ?? []).filter((c) => c.trim() !== '');
        t.answers = choices.length > 0 ? [choices[0]] : [TEXT, ...((t.answers ?? []).slice(1))];
        break;
      }
      case 'numericAnswer': t.numericAnswer = 7; break;
      case 'orderItems': case 'choices': {
        const rows = (t[field] as string[] | undefined) ?? [];
        // The rows the creator sees, each typed over when it is still a placeholder or empty.
        const shown = rows.length >= 3 ? [...rows] : [...rows, ...Array(3 - rows.length).fill('')];
        t[field] = shown.map((r, i) => (r.trim() === '' || isPlaceholderValue(r) ? `שורה ${i + 1}` : r));
        break;
      }
      case 'description': case 'hint': case 'locationClue': case 'title': {
        // A plain text box: the creator rewrites what is there.
        t[field] = TEXT;
        break;
      }
      default: boxed = false;
    }
  }
  const stage = { ...game.stages[0], tasks: [t as Task] };
  return { game: { ...game, stages: [stage] } as Game, boxed };
}

const report: string[] = [];
let walked = 0;
let stepCount = 0;
for (const entry of TASK_BANK) {
  const variants: Variant[] = ['authored'];
  if (bankSiting(entry) === 'possible') variants.push('sited', 'hidden');
  for (const variant of variants) {
    walked++;
    const name = `${entry.key} [${variant}]`;
    const before = failures;
    let { game } = build(entry, variant);
    const steps = setupFlowSteps(game);
    stepCount += steps.length;
    const task0 = taskOf(game);

    // Each step points somewhere real, and an empty field does not read as done.
    for (const s of steps) {
      const target = resolveWizardTarget(game, s);
      ok(`${name}: step ${s.targetFieldPath} resolves`, target !== null, s.id);
      const value = readWizardFieldValue(game, s);
      if (looksEmpty(target?.fieldPath ?? '', value, task0)) {
        ok(`${name}: ${s.targetFieldPath} is empty and not done`, !isWizardStepConfigured(game, s), value);
      }
    }

    // Everything the entry declares is asked.
    for (const decl of entry.setup ?? []) {
      ok(`${name}: declared setup ${decl.field} is in the walk`, steps.some((s) => s.taskId === task0.id && s.targetFieldPath === decl.field));
    }
    // A hidden mission's clue is asked unless the bank wrote it; a clue that points at the picture asks for the picture.
    if (task0.hideLocation === true) {
      const clue = task0.locationClue ?? '';
      const asked = steps.some((s) => s.targetFieldPath === 'locationClue');
      ok(`${name}: hidden mission has a clue or asks for one`, asked || !looksEmpty('locationClue', clue, task0), clue);
    }
    // Text that points at "the attached picture" asks for the picture when the bank attached none.
    const mentions = [task0.locationClue, task0.description, task0.title].find((v) => typeof v === 'string' && /מצורפ|attached (?:photo|picture|image|map|drawing)/i.test(v));
    if (mentions && (task0.media ?? []).length === 0) {
      ok(`${name}: text pointing at an attached picture asks for the picture`, steps.some((s) => s.targetFieldPath === 'media'), mentions);
    }
    // A hint the creator still owes is asked.
    if (typeof task0.hint === 'string' && looksEmpty('hint', task0.hint, task0) && task0.hint.trim() !== '') {
      ok(`${name}: an unfinished hint gets a step`, steps.some((s) => s.targetFieldPath === 'hint'), task0.hint);
    }
    // Any text a player reads that still carries a creator note is asked about.
    for (const f of SENTENCE_FIELDS) {
      const v = (task0 as unknown as Record<string, unknown>)[f];
      if (typeof v === 'string' && looksEmpty(f, v, task0) && v.trim() !== '') {
        ok(`${name}: player text ${f} with a creator note gets a step`, steps.some((s) => s.targetFieldPath === f), v);
      }
    }

    // Walk it: fill every step the way its box does.
    for (const s of steps) {
      const r = fill(game, s);
      ok(`${name}: the walk has a box for ${s.targetFieldPath}`, r.boxed);
      game = r.game;
    }
    // Re-read the list the way the walk does after edits (a filled sentence step drops out of
    // setupFlowSteps; keepSeenSentenceSteps keeps it on screen, so judge the original list too).
    for (const s of [...steps, ...setupFlowSteps(game)]) {
      ok(`${name}: ${s.targetFieldPath} is done after filling`, isWizardStepConfigured(game, s), readWizardFieldValue(game, s));
    }
    const blockers = quickSetupLaunchBlockers(game);
    ok(`${name}: no launch blocker left`, blockers.length === 0, blockers.map((b) => b.targetFieldPath));
    const t = taskOf(game) as unknown as Record<string, unknown>;
    for (const f of SENTENCE_FIELDS) {
      ok(`${name}: no blank left in ${f}`, !hasOpenSlots(t[f]), t[f]);
      ok(`${name}: no creator note left in ${f}`, !isPlaceholderValue(t[f]), t[f]);
    }
    if (failures > before) report.push(name);
  }
}
console.log(`  walked ${walked} games from ${TASK_BANK.length} bank missions, ${stepCount} steps`);
if (report.length === 0) pass('every bank mission walks clean');
else console.error(`  failing: ${report.join(', ')}`);

console.log(failures === 0 ? '\nPASS walk every bank mission' : `\nFAIL ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
