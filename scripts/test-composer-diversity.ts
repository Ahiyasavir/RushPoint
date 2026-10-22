// Composer diversity by mechanic tags (change: composer-v2-diversity).
//
// The founder: "מאוד חשוב לי שיהיה מגוון ומקוריות במשימות". Families stop two near-identical
// missions from meeting, but nothing stopped a stage of three "ask a stranger" missions. Every bank
// mission now carries mechanic tags (strangers, hunt, puzzle, physical...); the composer penalises a
// candidate for repeating a mechanic already in its stage (and, lighter, in its game), and caps the
// two that wear out fastest. Checked over a matrix of answers and seeds against the same composer
// with diversity switched off.
//   npx tsx scripts/test-composer-diversity.ts
import { MECHANIC_TAG_IDS, type BankTagId } from '../apps/creator-web/src/bankTags';
import {
  composeGame, seededRng, MECHANIC_STAGE_CAPS, MECHANIC_GAME_CAPS,
  DIVERSITY_STAGE_WEIGHT, DIVERSITY_GAME_WEIGHT,
  type ComposerAnswers, type ComposerDescriptionCopy, type ComposerResult,
} from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';

let failures = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const COPY: ComposerDescriptionCopy = {
  lead: () => 'LEAD', ageLabel: (b) => `AGE[${b}]`, ageTag: (b) => `agetag-${b}`, durationTag: (m) => `durtag-${m}`,
  composedLead: () => 'COMPOSED', activityPhrase: (t) => `phrase-${t}`, activityJoin: (p) => p.join(' + '),
  activityTag: (t) => `acttag-${t}`, placeMissionPrompt: () => 'PLACE_IT',
};

// ── Vocabulary ──────────────────────────────────────────────────────────────
ok('the mechanic list is exported', Array.isArray(MECHANIC_TAG_IDS) && MECHANIC_TAG_IDS.length >= 15);
const untagged = TASK_BANK.filter((e) => !e.tags.some((t) => (MECHANIC_TAG_IDS as readonly string[]).includes(t)));
ok('every bank mission carries at least one mechanic tag', untagged.length === 0, untagged.map((e) => e.key).join(', '));
ok('the weights are bounded below a real mismatch', DIVERSITY_STAGE_WEIGHT > 0 && DIVERSITY_STAGE_WEIGHT <= 0.2
  && DIVERSITY_GAME_WEIGHT > 0 && DIVERSITY_GAME_WEIGHT < DIVERSITY_STAGE_WEIGHT);
ok('the caps name strangers per stage and ongoing per game', MECHANIC_STAGE_CAPS.strangers === 2 && MECHANIC_GAME_CAPS.ongoing === 1);

// Which bank entry built each task: titles are unique in the bank.
const byTitle = new Map<string, BankTagId[]>();
for (const e of TASK_BANK) { try { byTitle.set(e.build().title, e.tags); } catch { /* skip */ } }
const mechOf = (title: string): string[] => (byTitle.get(title) ?? []).filter((t) => (MECHANIC_TAG_IDS as readonly string[]).includes(t));

const ANSWERS: ComposerAnswers[] = [];
for (const audience of ['kids', 'youth', 'adults', 'corporate', 'mixed'] as const) {
  for (const setting of ['outdoor', 'indoor', 'fromAnywhere'] as const) {
    ANSWERS.push({ minutes: 120, audience, setting, difficultyPreference: 'balanced', people: 24, ageBandId: 'band-14-17' } as ComposerAnswers);
  }
}
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);

let strangerOver = 0, ongoingOver = 0, games = 0;
let ratioOn = 0, ratioOff = 0, repeatsOn = 0, repeatsOff = 0;
let drawsMatch = true;

function stageRepeats(r: ComposerResult): number {
  // Pairs of missions in one stage that share a mechanic.
  let n = 0;
  for (const s of r.stages) {
    const ms = s.tasks.map((t) => mechOf(t.title));
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) if (ms[i].some((m) => ms[j].includes(m))) n++;
  }
  return n;
}
function distinctRatio(r: ComposerResult): number {
  const tasks = r.stages.flatMap((s) => s.tasks);
  const all = new Set(tasks.flatMap((t) => mechOf(t.title)));
  return tasks.length === 0 ? 0 : all.size / tasks.length;
}
function counting(seed: number) {
  const inner = seededRng(seed);
  const f = () => { f.n++; return inner(); };
  f.n = 0;
  return f;
}

for (const a of ANSWERS) {
  for (const seed of SEEDS) {
    const rOnRng = counting(seed), rOffRng = counting(seed);
    const on = composeGame(TASK_BANK, a, COPY, rOnRng, { recentBankKeys: [] });
    const off = composeGame(TASK_BANK, a, COPY, rOffRng, { recentBankKeys: [] }, { diversity: false });
    if (!on || !off) continue;
    games++;
    if (rOnRng.n !== rOffRng.n) drawsMatch = false;
    for (const s of on.stages) {
      if (s.tasks.filter((t) => mechOf(t.title).includes('strangers')).length > MECHANIC_STAGE_CAPS.strangers) strangerOver++;
    }
    if (on.stages.flatMap((s) => s.tasks).filter((t) => mechOf(t.title).includes('ongoing')).length > MECHANIC_GAME_CAPS.ongoing) ongoingOver++;
    ratioOn += distinctRatio(on); ratioOff += distinctRatio(off);
    repeatsOn += stageRepeats(on); repeatsOff += stageRepeats(off);
  }
}

ok('the matrix composed games', games >= ANSWERS.length * SEEDS.length * 0.8, `${games}`);
ok('diversity consumes exactly the same draws (seeded results stay reproducible)', drawsMatch);
ok('no stage holds more than two stranger missions', strangerOver === 0, `${strangerOver} stages`);
ok('no game holds more than one ongoing mission', ongoingOver === 0, `${ongoingOver} games`);
ok('stages repeat a mechanic clearly less often than without diversity',
  repeatsOn < repeatsOff * 0.8, `on ${repeatsOn} vs off ${repeatsOff}`);
ok('games use more distinct mechanics than without diversity',
  ratioOn > ratioOff, `on ${(ratioOn / games).toFixed(3)} vs off ${(ratioOff / games).toFixed(3)}`);

console.log(failures === 0 ? '\n✅ composer diversity: ALL PASS' : `\n❌ composer diversity: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
