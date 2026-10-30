// The full-screen setup flow, as data (change: setup-flow-full-screen).
//
// Ahiya, 22.10: the Quick Setup card a composed game opened with hid the mission's own instruction
// behind "פרטים" (Hebrew and English in one paragraph), titled every step with a generic line chosen by
// field type, hid what the mission IS while asking for its pin, and walked 18 fields for 10 missions.
// lib/setupFlow.ts turns the same steps into one screen per mission with nothing folded. This pins:
//   1. the language split of seeded prompts;
//   2. the prep/fill verdict for EVERY setup prompt in the bank (a new prompt that reads as preparation
//      and is not caught fails here, by name, instead of quietly becoming an ordinary field);
//   3. screens per mission in step order, the game screen first, items ordered place/prep/fill;
//   4. completion, the before-the-game list, and where the flow opens.
//   npx tsx scripts/test-setup-flow.ts
import type { Game, Task, TemplateWizardStep } from '@rushpoint/shared';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { setupFlowSteps, completionFieldOf } from '../apps/creator-web/src/lib/quickSetup';
import {
  pickLanguage, isPrepInstruction, buildSetupScreens, beforeGameList, firstOpenScreen,
  openRequiredCount, withGameField, gameFieldValue,
  buildSetupBeats, firstBeat, praiseIndex, stageProgress, planStages, prepShareText, whatsappShareUrl,
} from '../apps/creator-web/src/lib/setupFlow';

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); }
};

// ── 1. Language ──────────────────────────────────────────────────────────────
const BI = 'תבנו מגדל אבנים.\n\nBuild a stone tower.';
check('a bilingual prompt shows only Hebrew in Hebrew', pickLanguage(BI, 'he') === 'תבנו מגדל אבנים.', pickLanguage(BI, 'he'));
check('and only English in English', pickLanguage(BI, 'en') === 'Build a stone tower.', pickLanguage(BI, 'en'));
check('a Hebrew only text is kept whole in English (never emptied)', pickLanguage('רק עברית', 'en') === 'רק עברית');
check('a paragraph of numbers stays with the Hebrew', pickLanguage('תכתבו את הקוד.\n\n1234', 'he') === 'תכתבו את הקוד.\n\n1234');
check('non text is empty, never a throw', pickLanguage(undefined, 'he') === '' && pickLanguage(42, 'en') === '');

// ── 2. The verdict for every setup prompt in the bank ────────────────────────
// Reviewed by hand on 22.10: each of these asks the creator to do something IN THE WORLD before the
// game (build, stick up, hide, arrange with a person, go there and count or photograph).
const EXPECTED_PREP = new Set([
  // 23.10: a pen and paper per team (L30), for missions whose players cannot be sure to carry them.
  'youth-absurd-petition|description', 'reverse-shoplifting|description', 'five-cities|description',
  'photo-vantage-point|media', 'challenge-shampoo-pitch|description', 'the-hidden-key|coordinates',
  'exact-count|description', 'sign-cipher|answers', 'odd-one-planted|description', 'trade-up|description',
  'vendor-secret-code|smart.secretCode', 'vendor-secret-code|description', 'how-many-steps|numericAnswer',
  'guess-the-height|numericAnswer', 'passphrase-handoff|smart.secretCode', 'passphrase-handoff|description',
  'paper-airplane-trial|description', 'kims-game|media', 'the-combination-lock|answers', 'mystery-gift|answers',
  'balloon-message|answers', 'color-code-trail|answers', 'tiny-detail|media', 'double-agent|description',
  'four-places|description', 'hand-drawn-map|media', 'sign-word-cipher|description', 'cairn-record|description',
  'record-board|description', 'highest-note|coordinates', 'common-thread|media', 'kid-drawing|media',
  'scytale|answers', 'cache-swap|description', 'agent-in-crowd|smart.secretCode', 'agent-in-crowd|description',
  'five-objects|answers', 'dead-drop|description', 'rolling-challenge|description', 'chalk-code|coordinates',
]);
let prompts = 0;
const wrong: string[] = [];
for (const entry of TASK_BANK) {
  for (const s of entry.setup ?? []) {
    prompts++;
    const key = `${entry.key}|${s.field}`;
    if (isPrepInstruction(s.prompt) !== EXPECTED_PREP.has(key)) wrong.push(`${key} → ${isPrepInstruction(s.prompt) ? 'prep' : 'fill'}`);
  }
}
check(`every one of the bank's setup prompts gets the reviewed verdict (${prompts} prompts)`, prompts > 0 && wrong.length === 0, wrong);
check('the verdict does not depend on the interface language', isPrepInstruction(BI) && isPrepInstruction('לפני המשחק, תבנו מגדל.\n\nBefore the game, build a tower.'));
check('a fill instruction is not preparation', !isPrepInstruction('תסמנו על המפה את המקום המדויק של המשימה הזאת.\n\nDrop this mission’s pin on the map.'));

// ── 3. Screens ───────────────────────────────────────────────────────────────
// A small composed game built the way composeGame builds one: bank missions, setup → wizard steps.
function gameFrom(keys: string[]): { game: Game; steps: TemplateWizardStep[] } {
  const steps: TemplateWizardStep[] = [];
  const tasks: Task[] = [];
  let n = 0;
  for (const key of keys) {
    const entry = TASK_BANK.find((e) => e.key === key);
    if (!entry) throw new Error(`no bank entry ${key}`);
    const task = { ...entry.build(), id: `t-${key}` } as Task;
    tasks.push(task);
    for (const s of entry.setup ?? []) {
      steps.push({ id: `qs-${++n}-${s.field}`, stageId: 's1', taskId: task.id, targetFieldPath: s.field, instructionPrompt: s.prompt, isRequired: s.required === true });
    }
  }
  steps.unshift({ id: 'qs-title', stageId: '', taskId: '', targetFieldPath: 'title', instructionPrompt: '', isRequired: true });
  const game = { id: 'g1', ownerUid: 'u', title: 'משחק בדיקה', mode: 'team', stages: [{ id: 's1', order: 0, title: 'שלב', tasks }] } as unknown as Game;
  return { game, steps };
}
const { game, steps } = gameFrom(['cairn-record', 'common-thread', 'hand-drawn-map']);
const screens = buildSetupScreens(game, steps, 'he');
check('one screen per mission plus the game screen first', screens.length === 4 && screens[0].scope === 'game' && screens.slice(1).every((s) => s.scope === 'task'), screens.map((s) => s.key));
check('missions keep the order their steps came in', screens.slice(1).map((s) => s.taskId).join() === 't-cairn-record,t-common-thread,t-hand-drawn-map');
const cairn = screens[1];
check('the mission screen carries the title players see', cairn.title === 'השיא של הקודמים', cairn.title);
check('and the full text players will read, never cut', cairn.playerText.startsWith('ליד ') && cairn.playerText.includes('כבר עומד מגדל אבנים') && cairn.playerText.endsWith('ואל תפרקו אותם.'), cairn.playerText);
check('within a mission: the place first, then the preparation', cairn.items.map((i) => i.fieldPath).join() === 'coordinates,description' && cairn.items[1].kind === 'prep', cairn.items.map((i) => `${i.fieldPath}:${i.kind}`));
check('the instruction is in the interface language only, in full', cairn.items[1].instruction.startsWith('לפני המשחק, תבנו בנקודה מגדל אבנים קטן') && !/[A-Za-z]/.test(cairn.items[1].instruction), cairn.items[1].instruction);
// 29.10: the tower's text names its spot through a creator blank, so its preparation waits for that.
check('a preparation whose text still has a blank waits for it (the tower case)', cairn.items[1].configured === false);
check('an unplaced mission is not done', cairn.done === false && cairn.items[0].configured === false);
const thread = screens[2];
check('a preparation that also needs a file is prep AND still open (common thread)', thread.items.some((i) => i.fieldPath === 'media' && i.kind === 'prep' && !i.configured), thread.items);
check('the game screen holds the game name step', screens[0].items.length === 1 && screens[0].items[0].fieldPath === 'title' && screens[0].items[0].configured === true);
check('a step whose mission is gone is dropped, not shown empty',
  buildSetupScreens(game, [...steps, { id: 'ghost', stageId: 's1', taskId: 'gone', targetFieldPath: 'coordinates', instructionPrompt: '', isRequired: true }], 'he').length === 4);
check('malformed input yields no screens, never a throw', buildSetupScreens(null, steps, 'he').length === 0 && buildSetupScreens(game, null, 'he').length === 0);
const en = buildSetupScreens(game, steps, 'en');
check('in English the instruction is the English paragraph', en[1].items[1].instruction.startsWith('Before the game, build a small stone tower'), en[1].items[1].instruction);

// ── 4. Completion, the list, the entry point ─────────────────────────────────
const list = beforeGameList(screens);
check('the before-the-game list names every preparation with its mission', list.length === 3 && list[0].title === 'השיא של הקודמים' && list.every((e) => e.text !== ''), list.map((e) => e.title));
check('the flow opens on the first screen with something required open', firstOpenScreen(screens) === 1, firstOpenScreen(screens));
const placed = {
  ...game,
  stages: game.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t, coordinates: { lat: 31.78, lng: 35.21 }, description: String(t.description ?? '').replace(/\[הוראות ליוצר:[^\]]*\]/g, 'הסלע הגדול') })) })),
} as Game;
const after = buildSetupScreens(placed, steps, 'he');
check('placing a mission and filling its spot completes its screen', after[1].done === true, after[1].items);
check('the count of what is left falls as fields are filled', openRequiredCount(after) < openRequiredCount(screens), [openRequiredCount(screens), openRequiredCount(after)]);
check('everything done opens on the first screen', firstOpenScreen([{ ...after[0], done: true }]) === 0);

// ── 5. Game level fields ─────────────────────────────────────────────────────
const g2 = withGameField(game, 'instructions.bodyHe', 'תקראו לפני היציאה');
check('a nested game field is written into its object', gameFieldValue(g2, 'instructions.bodyHe') === 'תקראו לפני היציאה');
check('writing it leaves the rest of the game as it was', g2.title === game.title && g2.stages === game.stages);
check('a flat game field is written', gameFieldValue(withGameField(game, 'title', 'שם חדש'), 'title') === 'שם חדש');
check('a path it cannot write changes nothing', withGameField(game, 'a.b.c', 'x') === game && withGameField(game, '', 'x') === game);

// ── 6. The walk: plan, one item per screen, finish ───────────────────────────
const beats = buildSetupBeats(screens);
const itemCount = screens.reduce((n, sc) => n + sc.items.length, 0);
check('the walk is the plan, one screen per item, then the route, then the prep list', beats.length === itemCount + 3 && beats[0].kind === 'plan' && beats[beats.length - 2].kind === 'finish' && beats[beats.length - 1].kind === 'prep', beats.map((b) => b.kind));
check('the first item of each mission is marked (it introduces the mission)', beats.filter((b) => b.kind === 'item' && b.firstOfMission).length === screens.length);
check('arriving from the composer opens on the plan', firstBeat(beats, screens, false) === 0);
const firstOpen = firstBeat(beats, screens, true);
check('resumed, it opens on the first required item still open', beats[firstOpen].kind === 'item' && firstOpen > 0, firstOpen);
const afterBeats = buildSetupBeats(after);
check('resumed with nothing required left, it opens on the plan', firstBeat(afterBeats, after.map((sc) => ({ ...sc, items: sc.items.map((i) => ({ ...i, configured: true })) })), true) === 0);
check('no praise after a skipped item, and none on the first item', praiseIndex(5, false) === null && praiseIndex(1, true) === null);
check('praise after a completed item, stable for the same screen', praiseIndex(4, true) === praiseIndex(4, true) && praiseIndex(4, true) !== null);
const two = { ...game, stages: [{ ...game.stages[0], order: 0 }, { id: 's2', order: 1, title: 'שלב שני', tasks: [] }] } as unknown as Game;
const prog = stageProgress(two, screens, beats, 3);
check('the progress bar has one segment per stage that has something to set', prog.length === 1 && prog[0].stageId === 's1', prog);
check('a segment counts its items and what is behind the creator', prog[0].total === itemCount && prog[0].done === 2 && prog[0].current, prog);
const plan = planStages({ ...game, stages: [{ ...game.stages[0], requiredTaskCount: 2 }] } as unknown as Game);
check('the plan says how many missions a team does in each stage, and its topic', plan[0].perTeam === 2 && plan[0].total === 3 && plan[0].title === 'שלב' && plan[0].missions.length === 3, plan);
check('without a requirement a team does every mission of the stage', planStages(game)[0].perTeam === 3);

// ── 7. The prep list to copy and share ───────────────────────────────────────
const HE_WORDS = { heading: (title: string) => `מה להכין לפני המשחק ${title}`, empty: 'אין שום דבר להכין מראש.' };
const text = prepShareText('המשחק שלנו', list, HE_WORDS);
check('the shared list has the heading and one bullet per preparation',
  text.startsWith('מה להכין לפני המשחק המשחק שלנו') && text.split('\n').filter((l) => l.startsWith('• ')).length === list.length, text);
check('each bullet names its mission first', text.includes('• השיא של הקודמים: לפני המשחק'), text);
// A lone Latin letter is a symbol ("mark an X on the target"), not English; a word is.
check('a Hebrew list carries no English at all (Ahiya: not one mention)', !/[A-Za-z]{2,}/.test(text), text);
check('an empty list still says something useful', prepShareText('x', [], HE_WORDS).endsWith('אין שום דבר להכין מראש.'));
check('the WhatsApp link carries the text encoded',
  whatsappShareUrl('א ב').startsWith('https://wa.me/?text=') && decodeURIComponent(whatsappShareUrl('א ב').split('=')[1]) === 'א ב');
const enText = prepShareText('Our game', beforeGameList(en), { heading: (title: string) => `What to prepare before ${title}`, empty: 'Nothing.' });
check('an English list has English instructions (mission titles are the creator\'s own words)',
  beforeGameList(en).every((e) => !/[֐-׿]/.test(e.text)) && enText.startsWith('What to prepare'), enText);

// ── setupFlowSteps: every completion the creator supplies, and every blank, gets a card ──
{
  const mk = (id: string, extra: Partial<Task>): Task => ({ id, title: 'מ', description: 'תיאור', type: 'field', order: 0, ...extra } as Task);
  const g = {
    id: 'g', title: 'משחק', stages: [{ id: 's1', order: 0, title: '', tasks: [
      mk('code', { type: 'smart_station', smart: { enabled: true, verificationType: 'code_verification', secretCode: 'AB12' } as Task['smart'] }),
      mk('quiz', { type: 'quiz', answers: ['כן'] }),
      mk('num', { type: 'numeric' }),
      mk('photo', { type: 'photo' }),
      mk('blank', { description: 'תמצאו את [הוראות ליוצר: שם המקום] ותצלמו', hint: 'ליד [הוראות ליוצר: סימן]' }),
      mk('scored', { type: 'quiz', answerOutcomes: [{ answer: 'א', points: 1 }] as never }),
    ] }],
  } as unknown as Game;
  const st = setupFlowSteps(g);
  const has = (task: string, field: string) => st.some((x) => x.taskId === task && x.targetFieldPath === field);
  check('a station code gets a card even when the bank already set it', has('code', 'smart.secretCode'));
  check('a quiz answer and a numeric answer get a card', has('quiz', 'answers') && has('num', 'numericAnswer'));
  check('a photo mission asks for nothing to enter', !st.some((x) => x.taskId === 'photo' && x.targetFieldPath !== 'coordinates'));
  check('a mission scored by answer outcomes is left to its own editor', !has('scored', 'answers'));
  check('blanks in the description and the hint each get a card', has('blank', 'description') && has('blank', 'hint'), st.map((x) => x.taskId + ':' + x.targetFieldPath));
  check('a game with no template notes still gets a walk (location steps)', st.some((x) => x.targetFieldPath === 'coordinates'));
  const screens = buildSetupScreens(g, st, 'he');
  const code = screens.find((x) => x.taskId === 'code')?.items.find((i) => i.fieldPath === 'smart.secretCode');
  check('the preset code counts as configured, so it does not hold the launch', code?.configured === true);
  check('an ordering quiz asks for the right order, not for an answer',
    completionFieldOf(mk('o', { type: 'quiz', orderItems: ['א', 'ב', 'ג'] })) === 'orderItems');
  check('a survey has no right answer to ask for', completionFieldOf(mk('sv', { type: 'survey' })) === null);
  check('completionFieldOf: photo upload stations ask for no code',
    completionFieldOf(mk('p', { type: 'smart_station', smart: { enabled: true, verificationType: 'photo_upload' } as Task['smart'] })) === null);
}

console.log(`\n${failures === 0 ? 'ALL SETUP FLOW TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
