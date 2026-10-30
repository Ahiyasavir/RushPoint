// A composed game, walked through as a creator would, is a launchable game (found 29.10 while hunting
// weak points: nothing tied the walk's idea of "done" to the launch rules). Composes games across
// audience, venue, length, prep and difficulty, fills every step the walk asks for, and requires: every
// launch blocker has a walk screen; after the walk the game launches; no blank, bracket or English word
// reaches a player. The counts are printed, so a pass is never a pass over nothing.
import { AGE_BANDS, parseFieldPath, CREATOR_BLANK, SAMPLE_STEP_PREFIX } from '@rushpoint/shared';
import { composeGame, seededRng, type ComposerAnswers, type ComposerDescriptionCopy } from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { translations } from '../apps/creator-web/src/i18n';
import { setupFlowSteps, quickSetupLaunchBlockers } from '../apps/creator-web/src/lib/quickSetup';
import { buildSetupScreens } from '../apps/creator-web/src/lib/setupFlow';
import { computeGameReadiness, canLaunchGame } from '../apps/creator-web/src/lib/gameReadiness';
import { OCCASION_IDS } from '../apps/creator-web/src/lib/occasions';
import { AUDIENCE_TAG_IDS, AREA_TAG_IDS } from '../apps/creator-web/src/bankTags';

const d = (translations as any).he.dashboard;
const copy: ComposerDescriptionCopy = {
  lead: ({ people, minutes, ageLabel }: any) => d.wizard.descriptionLead(people, minutes, ageLabel),
  ageLabel: () => 'גיל', ageTag: () => 'גיל', durationTag: (m: number) => d.wizard.durationTag(m),
  composedLead: ({ people, minutes, ageLabel }: any) => d.wizard.composedLead(people, minutes, ageLabel),
  activityPhrase: (tag: string) => d.wizard.activityPhrases[tag] ?? '',
  activityJoin: (p: string[]) => (p.length ? `${d.wizard.activityPrefix} ${p.join(d.wizard.activityJoinSeparator)}` : ''),
  activityTag: (tag: string) => d.wizard.activityTags[tag] ?? '',
  stageNames: (role: string) => d.wizard.composedStageNames[role] ?? [],
  occasionStageNames: (o: string, role: string) => d.wizard.occasionStageNames[o]?.[role] ?? [],
  placeMissionPrompt: () => d.wizard.placeMissionPrompt,
  placeSpotHint: (s: string) => d.wizard.placeSpotHint[s] ?? '',
  hiddenCluePrompt: () => d.wizard.hiddenCluePrompt,
} as unknown as ComposerDescriptionCopy;

const blankRe = new RegExp(CREATOR_BLANK.source, 'gi');
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
function taskOf(game: any, stepTaskId: string) { for (const s of game.stages) for (const t of s.tasks) if (t.id === stepTaskId) return t; return null; }
function writePath(obj: any, path: string, value: unknown) {
  const keys = parseFieldPath(path); if (!keys.length) return;
  let c = obj; for (let i = 0; i < keys.length - 1; i++) { if (c[keys[i]] == null || typeof c[keys[i]] !== 'object') c[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {}; c = c[keys[i]]; }
  c[keys[keys.length - 1]] = value;
}
function readPath(obj: any, path: string) { let c = obj; for (const k of parseFieldPath(path)) { if (c == null) return undefined; c = c[k]; } return c; }
const URL = 'https://api.rush-point.com/uploads/gameMedia/u/games/g/x-1.jpg';
function fill(game: any, step: any) {
  const base = step.taskId ? taskOf(game, step.taskId) : game;
  if (!base) return 'no-base';
  const f = step.targetFieldPath as string;
  const cur = readPath(base, f);
  const last = parseFieldPath(f).slice(-1)[0];
  let v: unknown;
  if (last === 'coordinates') v = { lat: 31.77 + Math.random() / 100, lng: 35.21 + Math.random() / 100 };
  else if (last === 'media') v = [{ id: 'm1', kind: 'image', url: URL }];
  else if (last === 'numericAnswer') v = 7;
  else if (last === 'secretCode') v = '1357';
  else if (Array.isArray(cur)) v = cur.length ? cur.map((x: any) => (typeof x === 'string' ? x.replace(blankRe, 'הספסל') + ' ' : x)) : ['תשובה אחת', 'תשובה שתיים'];
  else if (typeof cur === 'string') v = cur.replace(blankRe, 'הספסל הירוק').trim() === cur.trim() && !step.id.startsWith(SAMPLE_STEP_PREFIX) && cur.trim() !== '' ? cur : (cur.replace(blankRe, 'הספסל הירוק') || 'טקסט של היוצר') + (step.id.startsWith(SAMPLE_STEP_PREFIX) ? ' ' : '');
  else v = 'טקסט של היוצר';
  writePath(base, f, v);
  // The walk replaces every blank on its screen, in every text field of the mission.
  if (step.taskId) for (const k of ['title', 'description', 'hint', 'locationClue']) if (typeof base[k] === 'string') base[k] = base[k].replace(blankRe, 'הספסל');
  return 'ok';
}

const findings = new Map<string, { n: number; ex: string }>();
const add = (kind: string, ex: string) => { const f = findings.get(kind) ?? { n: 0, ex }; f.n++; findings.set(kind, f); };
let games = 0; const stat = { steps: 0, blockedBefore: 0, hidden: 0, samples: 0, blanks: 0, readinessBefore: 0, launchableAfter: 0 };
const settings = ['outdoor', 'indoor', 'fromAnywhere'];
const auds = AUDIENCE_TAG_IDS as readonly string[];
for (const audience of auds) for (const setting of settings) for (const minutes of [60, 120, 180]) for (const prepEffort of [1, 3, 5])
for (const difficultyPreference of ['easy', 'balanced', 'hard']) for (const seed of [2]) {
  const occasion = seed === 2 ? OCCASION_IDS[(minutes + prepEffort) % OCCASION_IDS.length] : undefined;
  const band = AGE_BANDS[(prepEffort + seed) % AGE_BANDS.length]?.id;
  const areas = setting === 'outdoor' ? [AREA_TAG_IDS[(minutes / 15 + seed) % AREA_TAG_IDS.length]] : [];
  const answers = { audience, setting, minutes, prepEffort, locationMissions: prepEffort >= 2, difficultyPreference, people: [4, 12, 40][seed % 3], ageBandId: band, occasion, areas } as unknown as ComposerAnswers;
  let r: any;
  try { r = composeGame(TASK_BANK as any, answers, copy, seededRng(seed * 7919 + minutes), { recentBankKeys: [] }); }
  catch (e) { add('composeGame threw', `${audience}/${setting}/${minutes}/${prepEffort}: ${String(e).slice(0, 120)}`); continue; }
  if (!r) { add('composeGame returned null', `${audience}/${setting}/${minutes}/${prepEffort}/${difficultyPreference}`); continue; }
  games++;
  const label = `${audience}/${setting}/${minutes}m/p${prepEffort}/${difficultyPreference}/s${seed}${occasion ? '/' + occasion : ''}`;
  const game: any = { id: 'g', title: 'משחק', stages: r.stages, wizardSteps: r.wizardSteps, scoringPreset: r.scoringPreset, mode: r.mode, description: r.description };

  // Structural: every step points at a real mission in its stage, ids unique.
  const ids = new Set<string>();
  for (const w of game.wizardSteps) {
    if (ids.has(w.id)) add('duplicate wizard step id', `${label}: ${w.id}`); ids.add(w.id);
    if (w.taskId) { const st = game.stages.find((s: any) => s.id === w.stageId); if (!st || !st.tasks.some((t: any) => t.id === w.taskId)) add('step points at a mission not in its stage', `${label}: ${w.id}`); }
  }
  // Hidden missions carry a pin step and a clue step, and are not locationless.
  for (const s of game.stages) for (const t of s.tasks) if (t.hideLocation) {
    if (t.locationless) add('hidden mission is locationless', `${label}: ${t.title}`);
    const steps = game.wizardSteps.filter((w: any) => w.taskId === t.id).map((w: any) => w.targetFieldPath);
    if (!steps.includes('locationClue') && !(typeof t.locationClue === 'string' && t.locationClue.trim())) add('hidden mission with no clue and no clue step', `${label}: ${t.title}`);
    if (!steps.includes('coordinates') && !t.coordinates) add('hidden mission with no pin and no pin step', `${label}: ${t.title}`);
  }

  // Before the walk: every readiness blocker must have a walk screen for its mission.
  const flow = setupFlowSteps(game);
  stat.steps += flow.length; if (quickSetupLaunchBlockers(game).length) stat.blockedBefore++; if (computeGameReadiness(game).length) stat.readinessBefore++;
  stat.hidden += game.stages.flatMap((s: any) => s.tasks).filter((t: any) => t.hideLocation).length; stat.samples += game.wizardSteps.filter((w: any) => w.id.startsWith(SAMPLE_STEP_PREFIX)).length;
  stat.blanks += game.stages.flatMap((s: any) => s.tasks).filter((t: any) => new RegExp(CREATOR_BLANK.source, 'i').test(String(t.description ?? ''))).length;
  const walkTasks = new Set(flow.map((w: any) => w.taskId));
  for (const iss of computeGameReadiness(game) as any[]) {
    if (iss.taskId && !walkTasks.has(iss.taskId)) add(`readiness blocker with no walk screen: ${iss.code}`, `${label}: ${taskOf(game, iss.taskId)?.title}`);
  }
  // Screens build without dropping steps.
  const screens = buildSetupScreens(game, flow, 'he');
  const items = screens.reduce((n: number, s: any) => n + s.items.length, 0);
  if (items < flow.length) add('walk screens drop steps', `${label}: ${items} items for ${flow.length} steps`);

  // Play the walk: fill every step, as the creator would.
  const g2: any = clone(game);
  for (let pass = 0; pass < 3; pass++) for (const w of setupFlowSteps(g2)) fill(g2, w);
  g2.wizardSteps = g2.wizardSteps.map((w: any) => (w.id.startsWith(SAMPLE_STEP_PREFIX) ? { ...w, id: w.id.slice(SAMPLE_STEP_PREFIX.length) } : w));
  const left = quickSetupLaunchBlockers(g2);
  for (const w of left) add(`after the walk still blocked by the walk: ${w.targetFieldPath}`, `${label}: ${taskOf(g2, w.taskId)?.title ?? w.id}`);
  if (canLaunchGame(g2) && left.length === 0) stat.launchableAfter++;
  if (!canLaunchGame(g2)) for (const iss of computeGameReadiness(g2) as any[]) add(`after the walk the launch is refused: ${iss.code}`, `${label}: ${taskOf(g2, iss.taskId)?.title ?? ''}`);
  // Nothing that reaches a player still carries a creator blank.
  for (const s of g2.stages) for (const t of s.tasks) for (const k of ['title', 'description', 'hint', 'locationClue']) if (typeof t[k] === 'string' && new RegExp(CREATOR_BLANK.source, 'i').test(t[k])) add(`a blank survives the walk in ${k}`, `${label}: ${t.title}`);

  for (const s of g2.stages) for (const t of s.tasks) {
    for (const k of ['title', 'description', 'hint', 'locationClue']) {
      const v = t[k]; if (typeof v !== 'string') continue;
      if (/[\[\]]/.test(v)) add(`square bracket left in ${k}`, `${label}: ${t.title}: ${v.slice(0, 80)}`);
      if (/[A-Za-z]{3,}/.test(v) && !/https?:|RushPoint|TikTok|Instagram|WhatsApp|Freeze Frame|GPS|QR/.test(v)) add(`English word in ${k}`, `${label}: ${t.title}: ${v.slice(0, 80)}`);
    }
    if (!String(t.title ?? '').trim()) add('mission with no title', label);
    if (!String(t.description ?? '').trim()) add('mission with no text', `${label}: ${t.title}`);
  }
  // The time estimate is honest-ish against what was asked.
  if (r.estimatedMinutes > minutes * 1.6) add('estimate far above the asked time', `${label}: asked ${minutes}, estimate ${r.estimatedMinutes}`);
}
console.log(`games composed: ${games}`, JSON.stringify(stat));
for (const [k, v] of [...findings].sort((a, b) => b[1].n - a[1].n)) console.log(`FAIL  ${String(v.n).padStart(5)}  ${k}\n        e.g. ${v.ex}`);
const pass = games >= 300 && findings.size === 0 && stat.launchableAfter === games && stat.blockedBefore > 0 && stat.hidden > 0;
console.log(pass ? '\n✅ composed walk to launch: ALL PASS' : '\n❌ composed walk to launch: FAILED');
process.exit(pass ? 0 : 1);
