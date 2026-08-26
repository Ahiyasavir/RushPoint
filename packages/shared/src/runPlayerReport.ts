// The per-player run report (change: post-run-player-report).
//
// WHAT THIS IS FOR. After an event a creator wants the thing no existing surface
// gives them: who played, how each of them did, and — mission by mission — what
// they actually answered. `computeRunAnalytics` is deliberately anonymous ("no
// team-level PII in the payload") and `listRunTeams` is one summary row per team
// with no mission detail, so neither can be stretched into this. Hence a separate
// OWNER-ONLY projection, built here so the callable and the spreadsheet export
// read one definition.
//
// TWO PROPERTIES DO ALL THE WORK:
//
//  1. TOTAL. This walks documents nobody validated on the way in — runs that may
//     be months old, teams written by an older build, games edited or partly
//     deleted since. Every malformed shape degrades to a sane row, because a throw
//     here means the owner cannot see ANY of their report, and there is no other
//     way to get it. One bad team must cost one bad row, never the whole page.
//
//  2. HONEST ABOUT MISSING DATA. An empty answer cell has THREE different causes
//     and conflating them is a lie the creator would act on:
//        • the mission never had an answer channel  (a check-in / geofence)
//        • the player never answered it             (skipped, or still pending)
//        • the answer was never recorded            (played before the answer log
//          shipped, or older than ANSWER_LOG_RETENTION_DAYS)
//     The third is `answersUnavailable`, and it is the reason a legacy run reads
//     as "not recorded" instead of "everybody answered nothing".
//
// PURE and CLOCK-FREE. Ranking comes from the STORED leaderboard whenever one
// exists, so the report and the standings the players actually saw cannot
// disagree — the same live/final parity rule `buildRankings` follows. Timings come
// from the stored records, never from `now`, so re-opening the report next month
// shows the same numbers as opening it that evening.

import type { Game, Run, RunTeam, RunStageRecord, RunTaskRecord, Task, LeaderboardEntry } from './types';
import { ANSWER_LOG_RETENTION_DAYS, type AnswerLogEntry, type AnswerLogKind } from './answerLog';

/**
 * How a mission takes a submission.
 *
 * `none` and `media` are NOT "no answer was given" — they mean the mission has no
 * text channel at all, which is why neither can ever be `answersUnavailable`.
 */
export type ReportAnswerChannel =
  | 'none'          // field / self_report / geofence — arrival or a tap, no submission
  | 'answer'        // quiz (choice or typed) / numeric
  | 'ordering'      // an ordering quiz
  | 'sequence'      // a multi-step sequence
  | 'station_code'  // a smart-station secret code
  | 'survey'        // a survey response (no right answer)
  | 'media';        // photo / audio — the submission is the file

/** One recorded submission, flattened for the report. */
export interface ReportAnswer {
  at: string;
  answer: string;
  /** `null` where the channel has no right answer (a survey) or none was recorded. */
  correct: boolean | null;
  kind: AnswerLogKind;
  /** `-1` when the submission was not a sequence step. */
  stepIndex: number;
}

/** One player x one stored mission record. This is the row the export flattens. */
export interface ReportAnswerRow {
  teamId: string;
  playerName: string;
  stageOrder: number;
  stageTitle: string;
  taskId: string;
  taskTitle: string;
  taskType: string;
  /** The mission text as authored — the "question" a reader needs for context. */
  question: string;
  /** OWNER-ONLY: the answer key, rendered as text. Never leaves this callable. */
  expectedAnswer: string;
  answerChannel: ReportAnswerChannel;
  answers: ReportAnswer[];
  /** The mission takes an answer, the player finished it, and nothing was recorded. */
  answersUnavailable: boolean;
  /** The last recorded submission (or the survey/test-mode single slot). '' if none. */
  finalAnswer: string;
  /** `null` when the channel has no verdict or none was recorded. */
  correct: boolean | null;
  status: string;
  attempts: number;
  earnedScore: number;
  hintUsed: boolean;
  /** Minutes the mission took, from the stored record. `null` when unknown. */
  minutes: number | null;
  mediaUrl: string;
  mediaKind: string;
  reviewStatus: string;
}

/** One player. */
export interface ReportPlayerRow {
  teamId: string;
  playerName: string;
  memberNames: string[];
  memberCount: number;
  rank: number;
  score: number;
  bonusPenalty: number;
  status: string;
  startedAt: string;
  finishedAt: string;
  durationMinutes: number | null;
  missionsAssigned: number;
  missionsCompleted: number;
  missionsSkipped: number;
  hintsUsed: number;
  wrongAnswers: number;
  mediaCount: number;
  answersRecorded: number;
}

/** One mission, rolled up across the players who met it. */
export interface ReportMissionRow {
  taskId: string;
  title: string;
  type: string;
  stageOrder: number;
  stageTitle: string;
  attemptedBy: number;
  completedBy: number;
  skippedBy: number;
  completionRate: number;
  medianMinutes: number | null;
  hintCount: number;
  wrongAnswerCount: number;
}

export interface RunPlayerReportMeta {
  gameId: string;
  runId: string;
  gameTitle: string;
  accessCode: string;
  status: string;
  launchedAt: string;
  finishedAt: string;
  playerCount: number;
  missionCount: number;
  /** True when no leaderboard has been built, so ranking was derived here. */
  rankingProvisional: boolean;
  /** Disclosed so the UI and the export can state how long answers are kept. */
  answerRetentionDays: number;
}

export interface RunPlayerReport {
  meta: RunPlayerReportMeta;
  players: ReportPlayerRow[];
  answers: ReportAnswerRow[];
  missions: ReportMissionRow[];
}

export interface RunPlayerReportInput {
  game: Game | null | undefined;
  run: Run | null | undefined;
  teams: readonly (RunTeam | null | undefined)[] | null | undefined;
}

// ── Small total helpers ──────────────────────────────────────────────────────
// Everything below is fed by Firestore documents, so "the field is a number" is a
// hope, not a fact. Each helper answers for one shape and never throws.

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;
const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

/** Minutes between two ISO instants, or null when either is unusable. */
function spanMinutes(from: unknown, to: unknown): number | null {
  if (typeof from !== 'string' || typeof to !== 'string') return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round(((b - a) / 60000) * 100) / 100;
}

/** The middle value, or null for an empty set. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(m * 100) / 100;
}

/**
 * Which channel a mission takes a submission through.
 *
 * `quiz` splits on `orderItems`: an ordering quiz is graded as an ARRANGEMENT, so
 * its recorded submission is a serialized list, not a word — the export renders
 * the two differently and the classification is what tells them apart.
 * An unknown / missing task falls back to `answer`, the widest textual channel, so
 * a mission the game no longer has is reported as "we cannot show the answer"
 * rather than silently as "this mission never had one".
 */
export function answerChannelForTask(task: Task | null | undefined): ReportAnswerChannel {
  const type = str((task as unknown as Record<string, unknown>)?.type);
  switch (type) {
    case 'quiz':
      return arr<string>((task as unknown as Record<string, unknown>)?.orderItems).length > 0
        ? 'ordering' : 'answer';
    case 'numeric': return 'answer';
    case 'survey': return 'survey';
    case 'sequence': return 'sequence';
    case 'smart_station': return 'station_code';
    case 'photo': return 'media';
    case 'field':
    case 'self_report':
    case 'geofence':
      return 'none';
    default:
      // Includes the orphaned-record case (no task at all): assume a text channel
      // so a missing answer is reported honestly rather than explained away.
      return 'answer';
  }
}

/** The answer key as a human-readable string. OWNER-ONLY — never sanitized out here. */
function expectedAnswerText(task: Task | null | undefined): string {
  const t = obj(task);
  const answers = arr<unknown>(t.answers).filter((x) => typeof x === 'string') as string[];
  if (answers.length > 0) return answers.join(' / ');
  const order = arr<unknown>(t.orderItems).filter((x) => typeof x === 'string') as string[];
  if (order.length > 0) return order.join(' → ');
  if (typeof t.numericAnswer === 'number' && Number.isFinite(t.numericAnswer)) {
    const tol = num(t.numericTolerance);
    return tol > 0 ? `${t.numericAnswer} ±${tol}` : String(t.numericAnswer);
  }
  const steps = arr<Record<string, unknown>>(t.steps)
    .map((s) => str(obj(s).answer))
    .filter((s) => s.length > 0);
  if (steps.length > 0) return steps.join(' → ');
  const code = str(obj(t.smart).secretCode);
  if (code) return code;
  const choices = arr<unknown>(t.surveyChoices).filter((x) => typeof x === 'string') as string[];
  if (choices.length > 0) return choices.join(' / ');
  return '';
}

/** The mission text a reader needs to make sense of an answer. */
function questionText(task: Task | null | undefined): string {
  const t = obj(task);
  const description = str(t.description);
  if (description) return description;
  const clue = str(t.locationClue) || str(t.locationClueHe);
  if (clue) return clue;
  const steps = arr<Record<string, unknown>>(t.steps)
    .map((s) => str(obj(s).prompt))
    .filter((s) => s.length > 0);
  if (steps.length > 0) return steps.join(' | ');
  return '';
}

/** Flatten a stored log into report rows, dropping anything unusable. */
function flattenAnswers(rec: Record<string, unknown>): ReportAnswer[] {
  return arr<unknown>(rec.answerLog)
    .map((raw) => {
      const e = obj(raw) as unknown as AnswerLogEntry;
      const answer = str((e as unknown as Record<string, unknown>).answer);
      if (!answer) return null;
      const correctRaw = (e as unknown as Record<string, unknown>).correct;
      const stepRaw = (e as unknown as Record<string, unknown>).stepIndex;
      return {
        at: str((e as unknown as Record<string, unknown>).at),
        answer,
        correct: typeof correctRaw === 'boolean' ? correctRaw : null,
        kind: (str((e as unknown as Record<string, unknown>).kind, 'answer') as AnswerLogKind),
        stepIndex: typeof stepRaw === 'number' && Number.isFinite(stepRaw) ? stepRaw : -1,
      } satisfies ReportAnswer;
    })
    .filter((e): e is ReportAnswer => e !== null);
}

/**
 * Assemble the whole report.
 *
 * Every row is keyed by the STORED `taskId`, not by the current template, so a
 * mission deleted since the run still produces a row (named by its id) instead of
 * vanishing — the creator's own history must not be rewritten by a later edit.
 */
export function buildRunPlayerReport(input: RunPlayerReportInput): RunPlayerReport {
  const game = (input?.game ?? null) as Game | null;
  const run = (input?.run ?? null) as Run | null;
  const teams = arr<RunTeam | null | undefined>(input?.teams)
    .filter((t): t is RunTeam => !!t && typeof t === 'object');

  // ── Index the template once ───────────────────────────────────────────────
  const taskById = new Map<string, Task>();
  const stageOfTask = new Map<string, { order: number; title: string }>();
  const gameStages = arr<Record<string, unknown>>(obj(game).stages);
  gameStages.forEach((stageRaw, i) => {
    const stage = obj(stageRaw);
    const meta = { order: num(stage.order, i), title: str(stage.title) };
    for (const taskRaw of arr<Record<string, unknown>>(stage.tasks)) {
      const task = obj(taskRaw);
      const id = str(task.id);
      if (!id) continue;
      taskById.set(id, task as unknown as Task);
      stageOfTask.set(id, meta);
    }
  });

  // ── Ranking: the stored board wins, so the report cannot contradict it ────
  const rankings = arr<LeaderboardEntry>(obj(obj(run).leaderboard).rankings)
    .filter((e) => !!e && typeof e === 'object');
  const rankingProvisional = rankings.length === 0;
  const rankByTeam = new Map<string, number>();
  for (const entry of rankings) {
    const id = str((entry as unknown as Record<string, unknown>).teamId);
    const rank = num((entry as unknown as Record<string, unknown>).rank, 0);
    if (id && rank > 0 && !rankByTeam.has(id)) rankByTeam.set(id, rank);
  }

  const answers: ReportAnswerRow[] = [];
  const players: ReportPlayerRow[] = [];

  for (const teamRaw of teams) {
    const team = obj(teamRaw);
    const teamId = str(team.id);
    const playerName = str(team.displayName) || teamId || '—';
    const submissions = obj(team.taskSubmissions);
    const hintsUsed = arr<unknown>(team.taskHintsUsed).filter((x) => typeof x === 'string') as string[];
    const attemptsByTask = obj(team.taskAttempts);

    let missionsAssigned = 0;
    let missionsCompleted = 0;
    let missionsSkipped = 0;
    let wrongAnswers = 0;
    let mediaCount = 0;
    let answersRecorded = 0;

    for (const stageRaw of arr<RunStageRecord>(team.stages)) {
      const stage = obj(stageRaw);
      for (const recRaw of arr<RunTaskRecord>(stage.tasks)) {
        const rec = obj(recRaw);
        const taskId = str(rec.taskId);
        if (!taskId) continue;
        const task = taskById.get(taskId) ?? null;
        const stageMeta = stageOfTask.get(taskId)
          ?? { order: num(stage.order, 0), title: str(stage.stageId) };
        const status = str(rec.status, 'pending');
        const channel = answerChannelForTask(task);
        const recorded = flattenAnswers(rec);

        // The single test-mode slot and the survey response are answers too — the
        // report must show them even on a run that predates the log.
        const legacySingle = str(rec.submittedAnswer) || str(rec.surveyResponse);
        const finalAnswer = recorded.length > 0
          ? recorded[recorded.length - 1].answer
          : legacySingle;

        let correct: boolean | null = null;
        if (channel !== 'survey' && channel !== 'none' && channel !== 'media') {
          if (recorded.length > 0) correct = recorded[recorded.length - 1].correct;
          else if (typeof rec.wasCorrect === 'boolean') correct = rec.wasCorrect;
        }

        const textual = channel === 'answer' || channel === 'ordering'
          || channel === 'sequence' || channel === 'station_code' || channel === 'survey';
        // Only a mission they actually FINISHED can have a missing recording. A
        // skipped or still-pending mission was simply never answered, which is a
        // different (and unremarkable) fact.
        const answersUnavailable = textual && status === 'completed'
          && recorded.length === 0 && legacySingle === '';

        const submission = obj(submissions[taskId]);
        const mediaUrl = str(rec.photoUrl) || str(submission.photoUrl);

        missionsAssigned++;
        if (status === 'completed') missionsCompleted++;
        if (status === 'skipped') missionsSkipped++;
        if (mediaUrl) mediaCount++;
        answersRecorded += recorded.length;
        wrongAnswers += recorded.filter((e) => e.correct === false).length;

        answers.push({
          teamId,
          playerName,
          stageOrder: stageMeta.order,
          stageTitle: stageMeta.title,
          taskId,
          taskTitle: str(obj(task).title) || taskId,
          taskType: str(obj(task).type, 'unknown'),
          question: questionText(task),
          expectedAnswer: expectedAnswerText(task),
          answerChannel: channel,
          answers: recorded,
          answersUnavailable,
          finalAnswer,
          correct,
          status,
          attempts: num(attemptsByTask[taskId]),
          earnedScore: num(rec.earnedScore),
          hintUsed: hintsUsed.includes(taskId),
          minutes: typeof rec.actualMinutes === 'number' && Number.isFinite(rec.actualMinutes)
            ? rec.actualMinutes
            : spanMinutes(rec.startedAt, rec.completedAt),
          mediaUrl,
          mediaKind: str(submission.mediaKind, mediaUrl ? 'photo' : ''),
          reviewStatus: str(rec.verificationOutcome) || str(submission.status),
        });
      }
    }

    players.push({
      teamId,
      playerName,
      memberNames: arr<unknown>(team.memberNames).filter((x) => typeof x === 'string') as string[],
      memberCount: num(team.memberCount, arr<unknown>(team.memberNames).length),
      rank: rankByTeam.get(teamId) ?? 0,
      score: num(team.score),
      bonusPenalty: num(team.bonusPenalty),
      status: str(team.status, 'registered'),
      startedAt: str(team.startedAt),
      finishedAt: str(team.finishedAt),
      durationMinutes: spanMinutes(team.startedAt, team.finishedAt),
      missionsAssigned,
      missionsCompleted,
      missionsSkipped,
      hintsUsed: hintsUsed.length,
      wrongAnswers,
      mediaCount,
      answersRecorded,
    });
  }

  // ── Order the players ────────────────────────────────────────────────────
  // With a stored board, mirror it exactly. Without one, rank by score then by the
  // earlier finish — the same tie-break the live standings use — and SAY it is
  // provisional rather than presenting a derived order as the official result.
  if (rankingProvisional) {
    players.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const af = a.finishedAt || '￿';
      const bf = b.finishedAt || '￿';
      if (af !== bf) return af < bf ? -1 : 1;
      return a.playerName.localeCompare(b.playerName);
    });
    players.forEach((p, i) => { p.rank = i + 1; });
  } else {
    players.sort((a, b) => {
      const ar = a.rank || Number.MAX_SAFE_INTEGER;
      const br = b.rank || Number.MAX_SAFE_INTEGER;
      if (ar !== br) return ar - br;
      return a.playerName.localeCompare(b.playerName);
    });
  }

  // ── Mission rollup ───────────────────────────────────────────────────────
  // Every mission the TEMPLATE still has, plus every mission a stored record
  // names — so a mission nobody reached shows its zeroes, and a deleted one is
  // not silently dropped from the creator's own history.
  const missionIds = new Set<string>([...taskById.keys(), ...answers.map((a) => a.taskId)]);
  const missions: ReportMissionRow[] = [];
  for (const taskId of missionIds) {
    const rows = answers.filter((a) => a.taskId === taskId);
    const task = taskById.get(taskId) ?? null;
    const stageMeta = stageOfTask.get(taskId)
      ?? { order: rows[0]?.stageOrder ?? 0, title: rows[0]?.stageTitle ?? '' };
    const completedBy = rows.filter((r) => r.status === 'completed').length;
    const times = rows
      .filter((r) => r.status === 'completed' && typeof r.minutes === 'number')
      .map((r) => r.minutes as number);
    missions.push({
      taskId,
      title: str(obj(task).title) || rows[0]?.taskTitle || taskId,
      type: str(obj(task).type) || rows[0]?.taskType || 'unknown',
      stageOrder: stageMeta.order,
      stageTitle: stageMeta.title,
      attemptedBy: rows.length,
      completedBy,
      skippedBy: rows.filter((r) => r.status === 'skipped').length,
      completionRate: rows.length > 0 ? completedBy / rows.length : 0,
      medianMinutes: median(times),
      hintCount: rows.filter((r) => r.hintUsed).length,
      wrongAnswerCount: rows.reduce(
        (n, r) => n + r.answers.filter((e) => e.correct === false).length, 0),
    });
  }
  missions.sort((a, b) =>
    a.stageOrder - b.stageOrder || a.title.localeCompare(b.title));

  return {
    meta: {
      gameId: str(obj(run).gameId) || str(obj(game).id),
      runId: str(obj(run).id),
      gameTitle: str(obj(obj(game).branding).name) || str(obj(game).title) || 'RushPoint',
      accessCode: str(obj(run).accessCode),
      status: str(obj(run).status, 'live'),
      launchedAt: str(obj(run).launchedAt),
      finishedAt: str(obj(run).finishedAt),
      playerCount: players.length,
      missionCount: missions.length,
      rankingProvisional,
      answerRetentionDays: ANSWER_LOG_RETENTION_DAYS,
    },
    players,
    answers,
    missions,
  };
}
