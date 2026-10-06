// The host sheet's pure model (change: host-sheet).
//
// The sheet is the one paper a host holds on the day: every station, the order,
// each stage's rule, how each mission is judged and every answer. creator-web has
// no component test runner, so the sheet is a VALUE built by a pure function
// (apps/creator-web/src/lib/hostSheet.ts) and this file asserts on that value.
//
// Three things matter most and each has its own section: approval on paper must
// match what the server does (§3), a copy printed WITHOUT answers must carry no
// secret at all (§4), and a new Task field must force a decision about the paper (§6).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildHostSheet,
  approvalMode,
  stageRule,
  HOST_SHEET_IGNORED_TASK_FIELDS,
  stepAnswerSummary,
  cssString,
  pageFooterCss,
  type HostSheetOptions,
} from '../apps/creator-web/src/lib/hostSheet';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail !== undefined ? ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
}

const ON: HostSheetOptions = { includeAnswers: true, cardPerPage: false, includeMap: true };
const OFF: HostSheetOptions = { ...ON, includeAnswers: false };

const at = { lat: 31.77, lng: 35.21 };
const base = { difficulty: 3, estimatedMinutes: 8, pointValue: 100, maxConcurrentTeams: 99, coordinates: at };

// Every secret value is a distinctive token, so the deep sweep in §4 can look for
// the VALUE wherever it might have been copied, not just for a field name.
const game = {
  id: 'g1',
  title: 'Old City Hunt',
  description: 'A hunt',
  scoringPreset: 'fixed_points_speed',
  mode: 'team',
  stages: [
    {
      id: 's1', order: 0, title: 'Warm up', requiredTaskCount: 2,
      exclusiveGroups: [{ id: 'x', taskIds: ['t-quiz', 't-num'] }],
      releaseAfterMinutes: 20,
      tasks: [
        { ...base, id: 't-quiz', title: 'Gate riddle', type: 'quiz', choices: ['Lion', 'SECRET_WRONG_A'], answers: ['Lion'], hint: 'SECRET_HINT_TEXT', hintPenalty: 25 },
        { ...base, id: 't-num', title: 'Count steps', type: 'numeric', numericAnswer: 37, numericTolerance: 2 },
        { ...base, id: 't-seq', title: 'Three steps', type: 'sequence', steps: [{ id: 'a', prompt: 'First', answer: 'SECRET_STEP_ONE' }, { id: 'b', prompt: 'Second', answer: 'SECRET_STEP_TWO' }] },
        { ...base, id: 't-code', title: 'Station', type: 'smart_station', smart: { enabled: true, verificationType: 'code_verification', secretCode: 'SECRET_CODE_4821', adminNotes: 'SECRET_ADMIN_NOTE' } },
      ],
    },
    {
      id: 's2', order: 1, title: 'Finale', isFinal: true,
      tasks: [
        { ...base, id: 't-photo', title: 'Team selfie', type: 'photo', smart: { enabled: true, verificationType: 'photo_upload' } },
        { ...base, id: 't-video', title: 'Dance', type: 'photo', smart: { enabled: true, verificationType: 'photo_upload', captureKind: 'video', autoApprove: true, videoMinSeconds: 5, videoMaxSeconds: 30 } },
        { ...base, id: 't-survey', title: 'How was it', type: 'survey', surveyChoices: ['Great', 'Fine'], locationless: true },
        { ...base, id: 't-field', title: 'Check in', type: 'field' },
        { ...base, id: 't-geo', title: 'Walk in', type: 'geofence', geofenceRadiusMeters: 30 },
        { ...base, id: 't-self', title: 'Sing', type: 'self_report' },
        { ...base, id: 't-order', title: 'Order them', type: 'quiz', orderItems: ['SECRET_ORDER_1', 'SECRET_ORDER_2', 'SECRET_ORDER_3'] },
        { ...base, id: 't-hidden', title: 'Hidden key', type: 'field', hideLocation: true, locationClue: 'Under the old bench' },
        { ...base, id: 't-outcomes', title: 'Pick a door', type: 'quiz', answerOutcomes: [{ id: 'o1', label: 'Red', accepts: ['SECRET_OUTCOME_RED'], points: 50 }, { id: 'o2', label: 'Blue', points: 10 }], unmatchedPoints: 0 },
        { ...base, id: 't-benched', title: 'Not in the game', type: 'self_report', hidden: true },
      ],
    },
  ],
};

const run = { id: 'r1', accessCode: 'JOIN42', autoApproveAllMedia: false };
const staffCodes = [
  { id: 'c1', label: 'Marshal', pin: 'SECRET_PIN_111', capabilities: ['announce'], legacy: false, usedUp: false, disabled: false, people: [] },
  { id: 'c2', label: 'Old code', pin: 'SECRET_PIN_222', capabilities: ['announce'], legacy: false, usedUp: false, disabled: true, people: [] },
];
const ctx = { ownerUid: 'u1', playUrl: 'https://player.rush-point.com' };

const sheet = buildHostSheet(game, { run, staffCodes, options: ON, ...ctx });
const cards = sheet.stages.flatMap((s) => s.cards);
const card = (id: string) => cards.find((c) => c.id === id)!;

console.log('\nhost sheet');

// ── §1 Every mission type has a completion kind and (with answers) an answer ──
console.log(' §1 per type');
check('a benched mission is not on the sheet', !cards.some((c) => c.id === 't-benched'));
check('cards are numbered 1..N in route order', cards.map((c) => c.number).join(',') === cards.map((_, i) => i + 1).join(','));
for (const c of cards) check(`${c.id} has a completion kind`, typeof c.completion === 'string' && c.completion.length > 0);
const quizAnswer = card('t-quiz').answer;
check('quiz lists every choice with the correct one marked',
  quizAnswer?.kind === 'choices' && quizAnswer.choices.length === 2 && quizAnswer.choices.filter((x) => x.correct).map((x) => x.text).join() === 'Lion', quizAnswer);
const num = card('t-num').answer;
check('numeric answer is 37 with tolerance 2', num?.kind === 'number' && num.value === 37 && num.tolerance === 2, num);
const seq = card('t-seq').answer;
check('sequence lists every step with its answer', seq?.kind === 'steps' && seq.steps.length === 2 && seq.steps[1].answer === 'SECRET_STEP_TWO', seq);
const code = card('t-code').answer;
check('code station prints the secret code', code?.kind === 'code' && code.code === 'SECRET_CODE_4821', code);
const order = card('t-order').answer;
check('ordering prints the order', order?.kind === 'order' && order.items.join() === 'SECRET_ORDER_1,SECRET_ORDER_2,SECRET_ORDER_3', order);
const outc = card('t-outcomes').answer;
check('scored answers print each outcome and its points', outc?.kind === 'outcomes' && outc.outcomes.length === 2 && outc.outcomes[0].points === 50, outc);
check('survey says there is no right answer', card('t-survey').completion === 'survey' && card('t-survey').answer?.kind === 'noRightAnswer');
check('field counts on arrival', card('t-field').completion === 'arrival');
check('geofence counts on automatic arrival', card('t-geo').completion === 'autoArrival');
check('self report is the team saying done', card('t-self').completion === 'selfReport');
check('a photo mission is judged as media', card('t-photo').completion === 'media' && card('t-photo').mediaKind === 'photo');
check('a video mission says video', card('t-video').mediaKind === 'video');
check('locationless says from anywhere', card('t-survey').location.kind === 'anywhere');
const loc = card('t-field').location;
check('a located mission prints its point and a navigation link',
  loc.kind === 'point' && loc.lat === at.lat && loc.lng === at.lng && /^https:\/\//.test(loc.navUrl), loc);
const hid = card('t-hidden');
check('a hidden mission shows the real spot AND the clue', hid.hiddenFromPlayers && hid.location.kind === 'point' && hid.clue === 'Under the old bench');
check('a hint prints its text and price', card('t-quiz').hint?.text === 'SECRET_HINT_TEXT' && card('t-quiz').hint?.penalty === 25);
check('operator notes are printed', card('t-code').operatorNotes === 'SECRET_ADMIN_NOTE');
check('the answer table has a row per mission', sheet.answerRows.length === cards.length, sheet.answerRows.length);
// Found on the seeded demo game: a photo mission has no answer KEY, it is judged by
// approval, so the answer table must not call it "missing".
const photoRow = sheet.answerRows.find((r) => r.number === card('t-photo').number);
check('a photo mission has no answer key, not a missing one', photoRow?.answer === null && photoRow?.completion === 'media', photoRow);
check('the answer row knows the kind of a media mission (a video row must not say "take a photo")', photoRow?.mediaKind === card('t-photo').mediaKind && photoRow?.mediaKind !== undefined, photoRow);
check('an arrival mission has no answer key', sheet.answerRows.find((r) => r.number === card('t-field').number)?.answer === null);
check('a real missing key is still called missing',
  buildHostSheet({ stages: [{ tasks: [{ id: 'q', title: 'Q', type: 'quiz' }] }] }, { options: ON, ...ctx }).answerRows[0]?.answer?.kind === 'missing');
// Tap-to-confirm steps carry no answer text: they must not print empty separators.
const tapSteps = buildHostSheet({ stages: [{ tasks: [{ id: 's', title: 'S', type: 'sequence', steps: [{ id: 'a', prompt: 'Stretch' }, { id: 'b', prompt: 'Type go', answer: 'go' }] }] }] }, { options: ON, ...ctx });
const st = tapSteps.answerRows[0]?.answer;
check('a step without answer text is kept with an empty answer', st?.kind === 'steps' && st.steps.length === 2 && st.steps[0].answer === '');
check('stepAnswerSummary skips empty answers', stepAnswerSummary(st as never) === 'go', stepAnswerSummary(st as never));

// ── §2 Stage rules ────────────────────────────────────────────────────────────
console.log(' §2 stage rules');
const r1 = sheet.stages[0].rule;
check('"2 of 4"', r1.kind === 'some' && r1.required === 2 && r1.total === 4, r1);
check('a stage with no requirement needs all', sheet.stages[1].rule.kind === 'all', sheet.stages[1].rule);
check('the exclusive group is named by its missions',
  sheet.stages[0].exclusive.length === 1 && sheet.stages[0].exclusive[0].join() === 'Gate riddle,Count steps', sheet.stages[0].exclusive);
check('release after N minutes', sheet.stages[0].releaseAfterMinutes === 20);
check('final stage is flagged', sheet.stages[1].isFinal === true && sheet.stages[0].isFinal === false);
check('stageRule caps the requirement at what the stage can yield',
  stageRule({ requiredTaskCount: 9, tasks: [{ id: 'a' }, { id: 'b' }] } as never).required === 2);
check('stageRule on junk does not throw', stageRule(null as never).kind === 'all');

// ── §3 Approval matches the server ────────────────────────────────────────────
console.log(' §3 approval');
const photoTask = game.stages[1].tasks[0];
check('a photo mission with no auto is manual', approvalMode(photoTask as never, { autoApproveAllMedia: false }).mode === 'manual'
  && card('t-photo').approval.mode === 'manual');
check('the run-wide switch makes it automatic', approvalMode(photoTask as never, { autoApproveAllMedia: true }).mode === 'auto'
  && approvalMode(photoTask as never, { autoApproveAllMedia: true }).source === 'run');
check('per-task auto is automatic', card('t-video').approval.mode === 'auto' && card('t-video').approval.source === 'task');
check('an auto video with a length range carries the caveat', card('t-video').approval.videoLengthCaveat === true);
check('a code mission is checked automatically', card('t-code').approval.mode === 'automaticCheck');
check('a quiz is checked automatically', card('t-quiz').approval.mode === 'automaticCheck');
check('a self report needs nobody', card('t-self').approval.mode === 'none');
check('approvalMode on junk does not throw', approvalMode(null as never, null as never).mode === 'none');

// ── §4 Without answers: no secret anywhere ───────────────────────────────────
console.log(' §4 secrecy');
const off = buildHostSheet(game, { run, staffCodes, options: OFF, ...ctx });
const blob = JSON.stringify(off);
const secrets = blob.match(/SECRET_[A-Z0-9_]+/g) ?? [];
check(`no secret value survives with answers off (${(JSON.stringify(sheet).match(/SECRET_[A-Z0-9_]+/g) ?? []).length} seeded and present with answers on)`,
  secrets.length === 0, [...new Set(secrets)]);
check('the seeded secrets really are present with answers on (the sweep looks at something)',
  (JSON.stringify(sheet).match(/SECRET_[A-Z0-9_]+/g) ?? []).length >= 10);
check('the public answer that is ALSO a choice is not leaked as "correct"', !/"correct":true/.test(blob));
check('no answer table with answers off', off.answerRows.length === 0);
check('no staff page with answers off', off.staffPage === null);
check('the cards are still all there with answers off', off.stages.flatMap((s) => s.cards).length === cards.length);
check('the hint price is kept, its text is not', off.stages[0].cards[0].hint?.penalty === 25 && off.stages[0].cards[0].hint?.text === undefined);

// ── §5 Staff page ─────────────────────────────────────────────────────────────
console.log(' §5 staff page');
check('a run sheet with answers has a staff page', sheet.staffPage !== null && sheet.staffPage.codes.length === 1);
check('a disabled code is not printed', !JSON.stringify(sheet.staffPage).includes('SECRET_PIN_222'));
check('the staff card carries the code and a sign in link',
  sheet.staffPage?.codes[0].pin === 'SECRET_PIN_111' && /\?staff=/.test(sheet.staffPage?.codes[0].staffLink ?? ''));
const noRun = buildHostSheet(game, { staffCodes, options: ON, ...ctx });
check('a game sheet without a run has no staff page and no join code', noRun.staffPage === null && noRun.cover.joinCode === null);
check('a run sheet carries the join code and link', sheet.cover.joinCode === 'JOIN42' && /code=JOIN42/.test(sheet.cover.joinLink ?? ''));

// ── §6 Totality + coverage ───────────────────────────────────────────────────
console.log(' §6 totality and coverage');
for (const junk of [undefined, null, {}, { stages: 'nope' }, { stages: [null, { tasks: [null, 7] }] }]) {
  let ok = true;
  try { buildHostSheet(junk as never, { options: ON, ...ctx }); } catch { ok = false; }
  check(`does not throw on ${JSON.stringify(junk)}`, ok);
}
check('an empty game has a cover and an empty route',
  buildHostSheet({ title: 'Empty', stages: [] } as never, { options: ON, ...ctx }).stages.length === 0);
check('the street map has a marker per located card (change: host-sheet-street-map)', (sheet.map?.markers.length ?? 0) === cards.filter((c) => c.location.kind === 'point').length && (sheet.map?.tiles.length ?? 0) > 0);
check('no map when the map is off', buildHostSheet(game, { options: { ...ON, includeMap: false }, ...ctx }).map === null);

// The printed footer carries the game title inside a CSS string.
check('cssString escapes quotes', cssString('Game "X"') === '"Game \\"X\\""', cssString('Game "X"'));
check('cssString escapes backslashes', cssString('a\\b') === '"a\\\\b"', cssString('a\\b'));
check('cssString folds line breaks', cssString('a\nb') === '"a b"', cssString('a\nb'));
check('cssString on junk is an empty string literal', cssString(undefined) === '""');
// The whole @page footer rule is built here, not in the page: it is CSS, not copy, and a
// literal in the .tsx read as hardcoded English to both copy gates.
const footer = pageFooterCss('Game "X" · printed 4.10.2026');
check('the footer rule is an @page bottom-center rule', /^@page \{ @bottom-center \{ content: /.test(footer), footer);
check('the footer rule carries the escaped text and the page number', footer.includes('"Game \\"X\\" · printed 4.10.2026"') && footer.includes('counter(page)'), footer);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const typesSrc = readFileSync(path.join(HERE, '..', 'packages', 'shared', 'src', 'types', 'index.ts'), 'utf8');
const modelSrc = readFileSync(path.join(HERE, '..', 'apps', 'creator-web', 'src', 'lib', 'hostSheet.ts'), 'utf8');
const taskBlock = typesSrc.slice(typesSrc.indexOf('export interface Task {'));
const taskFields = [...taskBlock.slice(0, taskBlock.indexOf('\n}')).matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
const unconsidered = taskFields.filter((f) => !(f in HOST_SHEET_IGNORED_TASK_FIELDS) && !new RegExp(`\\bt\\.${f}\\b`).test(modelSrc));
check(`every Task field is printed or declared ignored (${taskFields.length} fields examined)`, unconsidered.length === 0, unconsidered.join(', '));
check('the Task interface was actually found', taskFields.length > 30, taskFields.length);
check('the ignored list has no stale entries',
  Object.keys(HOST_SHEET_IGNORED_TASK_FIELDS).every((f) => taskFields.includes(f)),
  Object.keys(HOST_SHEET_IGNORED_TASK_FIELDS).filter((f) => !taskFields.includes(f)).join(','));

console.log(failures === 0 ? '\n✅ host sheet: ALL PASS' : `\n❌ host sheet: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
