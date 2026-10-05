// The host sheet, as data (change: host-sheet).
//
// One printable briefing a host holds on the day: every station, the order, each
// stage's rule, how each mission is judged, and (optionally) every answer. The page
// (pages/HostSheetPage.tsx) only words and lays out what this module returns; it
// holds no field knowledge, and this module holds no copy, so both languages come
// from the dictionaries and the logic is testable without a renderer
// (scripts/test-host-sheet.ts).
//
// ── SECRECY: COPY OUT, AND NEVER READ A SECRET WHEN ANSWERS ARE OFF ──────────
// Every value is read by NAME onto a new object; nothing is spread from the game,
// so a field the Task type grows tomorrow cannot reach paper by accident (the test
// makes that field a decision instead). With `includeAnswers` off, the answer,
// hint text, operator notes, answer table and staff codes are not computed at all,
// which is stronger than computing and then hiding them.
//
// Total: a malformed or empty game yields a sheet with what could be read, never a
// throw — the page renders whatever the Builder last saved.
import { printMapLayout, type PrintMapLayout } from './printMap';
import { isTaskHidden, maxCompletableTasks, type StaffCapability } from '@rushpoint/shared';

export interface HostSheetOptions {
  includeAnswers: boolean;
  /** Each mission card starts its own page (a marshal per station). */
  cardPerPage: boolean;
  includeMap: boolean;
}

export const DEFAULT_HOST_SHEET_OPTIONS: HostSheetOptions = {
  includeAnswers: true,
  cardPerPage: false,
  includeMap: true,
};

export type HostTaskType =
  | 'field' | 'smart_station' | 'photo' | 'self_report' | 'quiz'
  | 'numeric' | 'geofence' | 'sequence' | 'survey' | 'unknown';

/** How a mission counts as done. Not a secret: the players are told this too. */
export type HostCompletion =
  | 'arrival' | 'autoArrival' | 'selfReport' | 'code' | 'answer' | 'number'
  | 'steps' | 'order' | 'survey' | 'media';

/** The answer key, printed only with answers on. */
export type HostAnswer =
  | { kind: 'choices'; choices: { text: string; correct: boolean }[] }
  | { kind: 'texts'; accepted: string[] }
  | { kind: 'number'; value: number; tolerance: number }
  | { kind: 'steps'; steps: { prompt: string; answer: string }[] }
  | { kind: 'order'; items: string[] }
  | { kind: 'code'; code: string }
  | { kind: 'outcomes'; outcomes: { label: string; accepts: string[]; range?: { min: number; max: number }; points: number }[]; unmatchedPoints: number | null }
  | { kind: 'noRightAnswer'; choices: string[] }
  /** A mission that should have a key and has none. Readiness flags it too. */
  | { kind: 'missing' };

export type HostLocation =
  | { kind: 'anywhere' }
  | { kind: 'unplaced' }
  | { kind: 'point'; lat: number; lng: number; radiusMeters: number | null; navUrl: string };

export interface HostApproval {
  /**
   * `manual`: a person approves (photo missions only); `auto`: a photo mission
   * approved without a person; `automaticCheck`: the server grades an answer or a
   * code; `none`: nothing to judge (arrival, self report, survey).
   */
  mode: 'manual' | 'auto' | 'automaticCheck' | 'none';
  /** Which rule made a photo mission automatic. */
  source: 'task' | 'run' | 'game' | null;
  /** An automatic VIDEO with a length range: an out-of-range clip still waits for a person. */
  videoLengthCaveat: boolean;
}

export interface HostTaskCard {
  number: number;
  id: string;
  title: string;
  type: HostTaskType;
  description: string;
  /** Player-facing long instructions, when the mission has them. */
  instructions: string;
  completion: HostCompletion;
  mediaKind: 'photo' | 'audio' | 'video' | null;
  location: HostLocation;
  hiddenFromPlayers: boolean;
  /** The free clue players get for a hidden spot. Not a secret: it is sent to them. */
  clue: string;
  approval: HostApproval;
  points: number;
  estimatedMinutes: number;
  difficulty: number | null;
  hint: { text?: string; penalty: number; autoRevealMinutes: number | null; autoRevealAttempts: number | null } | null;
  limits: {
    timeLimitMinutes: number | null;
    /** Only when it is a real queue (a single resource), not "no queue here". */
    maxConcurrentTeams: number | null;
    unlockAfter: number[];
    releaseAfterMinutes: number | null;
    releaseAt: string | null;
    expiresAfterMinutes: number | null;
    expiresAt: string | null;
    pausesTimer: boolean;
    requiredContributors: number | null;
    requirePresence: boolean;
    wrongAnswerPenalty: string | null;
  };
  operatorNotes: string;
  mediaCount: number;
  answer: HostAnswer | null;
}

export interface HostStageRule { kind: 'all' | 'some'; required: number; total: number }

export interface HostStage {
  number: number;
  id: string;
  title: string;
  rule: HostStageRule;
  /** Each "only one of" group, by its missions' titles. */
  exclusive: string[][];
  releaseAfterMinutes: number | null;
  releaseAt: string | null;
  isFinal: boolean;
  cards: HostTaskCard[];
}

export interface HostStaffCard { label: string; pin: string; capabilities: StaffCapability[]; staffLink: string }

export interface HostSheet {
  options: HostSheetOptions;
  cover: {
    title: string;
    description: string;
    coverImage: string;
    stageCount: number;
    taskCount: number;
    totalMinutes: number;
    mode: string;
    minAge: number | null;
    scoringPreset: string;
    hintsCost: boolean;
    wrongAnswerPenalty: string | null;
    joinCode: string | null;
    joinLink: string | null;
  };
  stages: HostStage[];
  /**
   * One row per mission. `answer` is null for a mission that has no answer KEY at
   * all (arrival, self report, a photo judged by approval); the page says how it
   * counts instead. `{ kind: 'missing' }` is kept for a key that should exist.
   */
  answerRows: { number: number; title: string; completion: HostCompletion; answer: HostAnswer | null }[];
  /** The street map: tiles and numbered markers (change: host-sheet-street-map). Null when off or nothing is located. */
  map: PrintMapLayout | null;
  staffPage: { codes: HostStaffCard[] } | null;
}

/**
 * Task fields the sheet deliberately does not print, each with a reason. Every
 * other field must be read below as `t.<field>` (scripts/test-host-sheet.ts).
 */
export const HOST_SHEET_IGNORED_TASK_FIELDS: Record<string, string> = {
  currentTeamCount: 'a runtime counter on a run, meaningless on paper',
  status: 'a live operator override, not part of the authored game',
  maxDurationMinutes: 'a staff-console warning threshold',
  expectedDurationMinutes: 'a scoring input; estimatedMinutes is what the host plans with',
  tags: 'catalogue metadata for the gallery and the composer',
  choicePoints: 'participant-payload output of the sanitizer, never stored on a game',
  revealOutcomePoints: 'a play-time display switch; the outcomes and their points are printed',
  hidden: 'read through isTaskHidden: a benched mission is not part of the game and is left off',
  locationClueHe: 'read with locationClue, picked by the sheet language',
};

// ── small total readers ─────────────────────────────────────────────────────
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s) => s !== '') : []);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const KNOWN_TYPES: readonly string[] = [
  'field', 'smart_station', 'photo', 'self_report', 'quiz', 'numeric', 'geofence', 'sequence', 'survey',
];

/** A queue only matters when it is small; the authoring default for "open space" is high. */
const REAL_QUEUE_MAX = 10;

/** The step answers of a sequence, for the condensed table. Tap-to-confirm steps have none. */
export function stepAnswerSummary(answer: Extract<HostAnswer, { kind: 'steps' }> | null | undefined): string {
  const steps = Array.isArray(answer?.steps) ? answer.steps : [];
  return steps.map((s) => (typeof s?.answer === 'string' ? s.answer.trim() : '')).filter(Boolean).join(' · ');
}

/**
 * A CSS string literal for the printed page footer (`@page { content: ... }`): quotes and
 * backslashes escaped, line breaks folded to a space. A game title is authored text and
 * may hold any of them; unescaped, one quote would end the CSS string and drop the rule.
 */
export function cssString(text: unknown): string {
  const t = typeof text === 'string' ? text : '';
  return `"${t.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\r\n]+/g, ' ')}"`;
}

/**
 * The printed footer on EVERY page: what the sheet is, when it was printed, the page number
 * (design: host-sheet, Risks). An `@page` margin box, which prints in Chrome; elsewhere the
 * last page's footer line still carries the date. Built here, not in the page: it is CSS.
 */
export function pageFooterCss(text: unknown): string {
  return `@page { @bottom-center { content: ${cssString(text)} " · " counter(page); font-size: 9px; color: #57534e; } }`;
}

export function navigationUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** What makes a mission count as done, from its type and its configuration. */
function completionOf(t: Obj, type: HostTaskType): HostCompletion {
  const smart = obj(t.smart);
  if (strs(t.orderItems).length >= 2) return 'order';
  switch (type) {
    case 'field': return 'arrival';
    case 'geofence': return 'autoArrival';
    case 'self_report': return 'selfReport';
    case 'smart_station': return smart?.verificationType === 'photo_upload' ? 'media' : 'code';
    case 'photo': return 'media';
    case 'numeric': return 'number';
    case 'sequence': return 'steps';
    case 'survey': return 'survey';
    case 'quiz': return 'answer';
    default: return 'selfReport';
  }
}

function mediaKindOf(t: Obj, completion: HostCompletion): HostTaskCard['mediaKind'] {
  if (completion !== 'media') return null;
  const k = obj(t.smart)?.captureKind;
  return k === 'video' || k === 'audio' ? k : 'photo';
}

/** The answer key. Only ever called with answers on. */
function answerOf(t: Obj, completion: HostCompletion): HostAnswer | null {
  const outcomes = arr(t.answerOutcomes).map(obj).filter((o): o is Obj => o !== null);
  if (outcomes.length > 0) {
    const range = (o: Obj) => {
      const r = obj(o.range);
      const min = num(r?.min); const max = num(r?.max);
      return min !== null && max !== null ? { range: { min, max } } : {};
    };
    return {
      kind: 'outcomes',
      outcomes: outcomes.map((o) => ({ label: str(o.label), accepts: strs(o.accepts), points: num(o.points) ?? 0, ...range(o) })),
      unmatchedPoints: num(t.unmatchedPoints),
    };
  }
  switch (completion) {
    case 'order': return { kind: 'order', items: strs(t.orderItems) };
    case 'number': {
      const value = num(t.numericAnswer);
      return value === null ? { kind: 'missing' } : { kind: 'number', value, tolerance: num(t.numericTolerance) ?? 0 };
    }
    case 'steps': {
      const steps = arr(t.steps).map(obj).filter((s): s is Obj => s !== null)
        .map((s) => ({ prompt: str(s.prompt), answer: str(s.answer) }));
      return steps.length ? { kind: 'steps', steps } : { kind: 'missing' };
    }
    case 'code': {
      const code = str(obj(t.smart)?.secretCode);
      return code ? { kind: 'code', code } : { kind: 'missing' };
    }
    case 'answer': {
      const accepted = strs(t.answers);
      const choices = strs(t.choices);
      if (!accepted.length) return { kind: 'missing' };
      if (choices.length) {
        const norm = (s: string) => s.toLowerCase();
        const ok = new Set(accepted.map(norm));
        return { kind: 'choices', choices: choices.map((text) => ({ text, correct: ok.has(norm(text)) })) };
      }
      return { kind: 'texts', accepted };
    }
    case 'survey': return { kind: 'noRightAnswer', choices: strs(t.surveyChoices) };
    default: return null;
  }
}

/**
 * How a mission is judged, by exactly the server's rule (`submitStationPhoto`):
 * only a submitted photo, audio or video is reviewed; the mission's own
 * `smart.autoApprove` OR the run's `autoApproveAllMedia` approves it without a
 * person; an automatic VIDEO outside its length range still waits for one
 * (`autoApproveLengthVerdict`). Without a run, the game's launch default stands in.
 */
export function approvalMode(task: unknown, runLike: { autoApproveAllMedia?: unknown } | null | undefined): HostApproval {
  const t = obj(task);
  if (!t) return { mode: 'none', source: null, videoLengthCaveat: false };
  const type = KNOWN_TYPES.includes(str(t.type)) ? (str(t.type) as HostTaskType) : 'unknown';
  const completion = completionOf(t, type);
  if (completion === 'media') {
    const smart = obj(t.smart);
    const perTask = smart?.autoApprove === true;
    const runWide = obj(runLike)?.autoApproveAllMedia === true;
    if (!perTask && !runWide) return { mode: 'manual', source: null, videoLengthCaveat: false };
    const video = mediaKindOf(t, completion) === 'video';
    const ranged = num(smart?.videoMinSeconds) !== null || num(smart?.videoMaxSeconds) !== null;
    return { mode: 'auto', source: perTask ? 'task' : 'run', videoLengthCaveat: video && ranged };
  }
  if (completion === 'code' || completion === 'answer' || completion === 'number' || completion === 'steps' || completion === 'order') {
    return { mode: 'automaticCheck', source: null, videoLengthCaveat: false };
  }
  return { mode: 'none', source: null, videoLengthCaveat: false };
}

/** "2 of 4" or "all", capped at what the stage can actually yield. */
export function stageRule(stage: unknown): HostStageRule {
  const s = obj(stage);
  if (!s) return { kind: 'all', required: 0, total: 0 };
  const tasks = arr(s.tasks).filter((x) => obj(x) && !isTaskHidden(x as { hidden?: boolean }));
  const total = tasks.length;
  let ceiling = total;
  try {
    ceiling = maxCompletableTasks({ tasks, exclusiveGroups: s.exclusiveGroups } as never);
  } catch { /* fall back to the plain count */ }
  const asked = num(s.requiredTaskCount);
  if (asked !== null && asked > 0 && asked < total) {
    return { kind: 'some', required: Math.min(asked, ceiling), total };
  }
  // Exclusive groups alone also make "all" impossible: say the real number.
  if (ceiling < total) return { kind: 'some', required: ceiling, total };
  return { kind: 'all', required: total, total };
}

function locationOf(t: Obj): HostLocation {
  if (t.locationless === true || t.triggerMode === 'locationless') return { kind: 'anywhere' };
  const c = obj(t.coordinates);
  const lat = num(c?.lat); const lng = num(c?.lng);
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return { kind: 'unplaced' };
  return { kind: 'point', lat, lng, radiusMeters: num(t.geofenceRadiusMeters), navUrl: navigationUrl(lat, lng) };
}

export interface BuildHostSheetInput {
  run?: { id?: unknown; accessCode?: unknown; autoApproveAllMedia?: unknown } | null;
  /** Rows from `buildStaffCodeRows` (lib/staffCodes.ts). */
  staffCodes?: readonly { label?: unknown; pin?: unknown; capabilities?: unknown; disabled?: unknown; usedUp?: unknown }[] | null;
  options: HostSheetOptions;
  ownerUid?: string;
  playUrl?: string;
  /** Picks the hidden-spot clue's language. */
  lang?: 'he' | 'en';
}

export function buildHostSheet(gameIn: unknown, input: BuildHostSheetInput): HostSheet {
  const options = { ...DEFAULT_HOST_SHEET_OPTIONS, ...(obj(input?.options) as Partial<HostSheetOptions> | null ?? {}) };
  const answersOn = options.includeAnswers === true;
  const game = obj(gameIn) ?? {};
  const run = obj(input?.run);
  const lang = input?.lang === 'he' ? 'he' : 'en';
  // Approval needs a run-wide switch: the run's own when printing for a run, the
  // game's launch default otherwise.
  const approvalContext = run ?? { autoApproveAllMedia: game.autoApproveAllMedia };
  const approvalFromGame = !run && game.autoApproveAllMedia === true;

  const rawStages = arr(game.stages).map(obj).filter((s): s is Obj => s !== null)
    .map((s, i) => ({ s, order: num(s.order) ?? i, i }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map((x) => x.s);

  // Number every playable mission in route order first, so "opens after #3" can
  // refer to a card number.
  const numberOf = new Map<string, number>();
  let n = 0;
  for (const s of rawStages) {
    for (const raw of arr(s.tasks)) {
      const t = obj(raw);
      if (!t || isTaskHidden(t as { hidden?: boolean })) continue;
      const id = str(t.id) || `task-${n + 1}`;
      if (!numberOf.has(id)) numberOf.set(id, ++n);
    }
  }

  const stages: HostStage[] = rawStages.map((s, si) => {
    const titleById = new Map<string, string>();
    const cards: HostTaskCard[] = [];
    let fallback = 0;
    for (const raw of arr(s.tasks)) {
      const t = obj(raw);
      if (!t || isTaskHidden(t as { hidden?: boolean })) continue;
      fallback++;
      const id = str(t.id) || `task-${fallback}`;
      const type: HostTaskType = KNOWN_TYPES.includes(str(t.type)) ? (str(t.type) as HostTaskType) : 'unknown';
      const completion = completionOf(t, type);
      const smart = obj(t.smart);
      const approval = approvalMode(t, approvalContext);
      if (approval.source === 'run' && approvalFromGame) approval.source = 'game';
      const hintText = str(t.hint);
      const penalty = num(t.hintPenalty);
      // A paid hint exists only when it has text (requestTaskHint has nothing to reveal otherwise).
      const hasHint = hintText !== '';
      const title = str(t.title);
      titleById.set(id, title);
      const queue = num(t.maxConcurrentTeams);
      const clue = lang === 'he' ? (str(t.locationClueHe) || str(t.locationClue)) : (str(t.locationClue) || str(t.locationClueHe));
      cards.push({
        number: numberOf.get(id) ?? 0,
        id,
        title,
        type,
        description: str(t.description),
        instructions: lang === 'he' ? (str(smart?.longInstructionsHe) || str(smart?.longInstructions)) : (str(smart?.longInstructions) || str(smart?.longInstructionsHe)),
        completion,
        mediaKind: mediaKindOf(t, completion),
        location: locationOf(t),
        hiddenFromPlayers: t.hideLocation === true,
        clue,
        approval,
        points: num(t.pointValue) ?? 0,
        estimatedMinutes: num(t.estimatedMinutes) ?? 0,
        difficulty: num(t.difficulty),
        hint: hasHint ? {
          ...(answersOn ? { text: hintText } : {}),
          penalty: penalty ?? 0,
          autoRevealMinutes: num(t.hintAutoRevealMinutes),
          autoRevealAttempts: num(t.hintAutoRevealAttempts),
        } : null,
        limits: {
          timeLimitMinutes: num(t.timeLimitMinutes),
          maxConcurrentTeams: queue !== null && queue >= 1 && queue <= REAL_QUEUE_MAX ? queue : null,
          unlockAfter: strs(t.unlockAfterTaskIds).map((x) => numberOf.get(x)).filter((x): x is number => typeof x === 'number'),
          releaseAfterMinutes: num(t.releaseAfterMinutes),
          releaseAt: str(t.releaseAt) || null,
          expiresAfterMinutes: num(t.expiresAfterMinutes),
          expiresAt: str(t.expiresAt) || null,
          pausesTimer: t.pausesTimer === true,
          requiredContributors: (num(t.requiredContributors) ?? 0) > 0 ? num(t.requiredContributors) : null,
          requirePresence: t.requirePresence === true,
          wrongAnswerPenalty: str(t.wrongAnswerPenalty) || null,
        },
        operatorNotes: answersOn ? str(smart?.adminNotes) : '',
        mediaCount: arr(t.media).length,
        answer: answersOn ? answerOf(t, completion) : null,
      });
    }
    const exclusive = arr(s.exclusiveGroups).map(obj).filter((g): g is Obj => g !== null)
      .map((g) => strs(g.taskIds).filter((id) => titleById.has(id)).map((id) => titleById.get(id) ?? ''))
      .filter((g) => g.length >= 2);
    return {
      number: si + 1,
      id: str(s.id) || `stage-${si + 1}`,
      title: str(s.title),
      rule: stageRule(s),
      exclusive,
      releaseAfterMinutes: num(s.releaseAfterMinutes),
      releaseAt: str(s.releaseAt) || null,
      isFinal: s.isFinal === true,
      cards,
    };
  });

  const cards = stages.flatMap((s) => s.cards);

  const answerRows = answersOn
    ? cards.map((c) => ({ number: c.number, title: c.title, completion: c.completion, answer: c.answer }))
    : [];

  // The street map: every located station, framed, north up (change: host-sheet-street-map).
  const located = stages.flatMap((s) => s.cards
    .filter((c) => c.location.kind === 'point')
    .map((c) => ({ number: c.number, stage: s.number, ...(c.location as { lat: number; lng: number }) })));
  const map = options.includeMap ? printMapLayout(located) : null;

  const accessCode = str(run?.accessCode);
  const playUrl = str(input?.playUrl).replace(/\/+$/, '');
  const runId = str(run?.id);
  const gameId = str(game.id);
  const ownerUid = str(input?.ownerUid) || str(game.ownerUid);

  let staffPage: HostSheet['staffPage'] = null;
  if (answersOn && run) {
    const staffLink = `${playUrl}/?staff=${encodeURIComponent(`${ownerUid}.${gameId}.${runId}`)}`;
    const codes = arr(input?.staffCodes).map(obj).filter((c): c is Obj => c !== null)
      .filter((c) => c.disabled !== true && c.usedUp !== true && str(c.pin) !== '')
      .map((c) => ({
        label: str(c.label),
        pin: str(c.pin),
        capabilities: strs(c.capabilities) as StaffCapability[],
        staffLink,
      }));
    if (codes.length > 0) staffPage = { codes };
  }

  const scoring = obj(game.scoringOptions);
  return {
    options,
    cover: {
      title: str(game.title),
      description: str(game.description),
      coverImage: str(game.coverImage),
      stageCount: stages.length,
      taskCount: cards.length,
      totalMinutes: cards.reduce((sum, c) => sum + c.estimatedMinutes, 0),
      mode: str(game.mode),
      minAge: num(game.minAge),
      scoringPreset: str(game.scoringPreset),
      hintsCost: cards.some((c) => c.hint !== null && c.hint.penalty > 0),
      wrongAnswerPenalty: str(scoring?.wrongAnswerPenalty) || null,
      joinCode: accessCode || null,
      joinLink: accessCode ? `${playUrl}/?code=${accessCode}` : null,
    },
    stages,
    answerRows,
    map,
    staffPage,
  };
}
