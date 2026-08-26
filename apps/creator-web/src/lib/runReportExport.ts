// The run report as one Excel workbook (change: post-run-player-report).
//
// The row model is PURE and lives apart from the library call, the same way
// `adminUsersExport.ts` keeps CSV escaping pure: a mistake in here produces a file
// a human opens, misreads, and acts on, so the rules are pinned by
// `scripts/test-run-report-export.ts` rather than discovered when a Hebrew column
// comes out backwards or a class looks like it answered nothing.
//
// THE RULE THAT MATTERS MOST: an empty answer cell must never be ambiguous. There
// are THREE reasons one can be empty and a creator would act differently on each:
//
//   • the mission has no answer channel  (a check-in, a geofence, a photo)  → "—"
//   • the player never answered it       (skipped, or still open at the end) → "not answered"
//   • the answer was never recorded      (a run played before the answer log
//     shipped, or one past the 30-day retention window)                     → "not recorded"
//
// Rendering all three as "" is the single most misleading thing this file could
// do, so each gets its own label and `formatAnswerCell` is tested on all three.
//
// The workbook library is NOT imported here. `downloadReportWorkbook` at the
// bottom is the only thing that touches it, through a dynamic import, so
// `write-excel-file` stays out of the console's entry chunk and out of every route
// but the report page.

import type { RunPlayerReport, ReportAnswerRow } from '@rushpoint/shared';

/** The three sheets, in order. A closed list so a sheet cannot be added namelessly. */
export const REPORT_SHEET_IDS = ['players', 'answers', 'missions'] as const;
export type ReportSheetId = (typeof REPORT_SHEET_IDS)[number];

/** Every string the workbook shows. Supplied by the page from `t.*` — no copy here. */
export interface ReportExportLabels {
  sheetPlayers: string;
  sheetAnswers: string;
  sheetMissions: string;
  /** "the answer was never recorded" — NOT the same as an empty answer. */
  notRecorded: string;
  /** "this mission never had an answer to give". */
  noAnswerNeeded: string;
  /** "they never answered it" (skipped or still open). */
  notAnswered: string;
  correct: string;
  wrong: string;
  yes: string;
  no: string;
  columns: {
    player: string; members: string; rank: string; score: string; penalty: string;
    status: string; started: string; finished: string; durationMinutes: string;
    missionsDone: string; missionsSkipped: string; hints: string;
    wrongAnswers: string; media: string;
    stage: string; mission: string; type: string; question: string;
    expected: string; theirAnswer: string; verdict: string; attempts: string;
    points: string; minutes: string; mediaLink: string;
    players: string; completed: string; skipped: string;
    completionRate: string; medianMinutes: string;
  };
}

export type Cell = string | number;

export interface ReportSheet {
  id: ReportSheetId;
  /** Header row first, then one row per record. Every row is the header's width. */
  rows: Cell[][];
  /** One width per column, so the file opens readable instead of full of ####. */
  columnWidths: number[];
}

export interface ReportWorkbook {
  sheets: ReportSheet[];
  /** Parallel to `sheets`, because the library takes names separately. */
  sheetNames: string[];
  fileName: string;
}

/**
 * Neutralise a cell Excel would EXECUTE.
 *
 * A leading `=`, `+`, `-` or `@` makes Excel and Google Sheets treat the cell as a
 * formula when the file is opened. Player names, team names and free-typed answers
 * are all participant-authored text, i.e. attacker-influenced, so this is the same
 * hazard `adminUsersExport.ts` documents for the CSV path — and it applies to xlsx
 * too, because the danger is the spreadsheet APPLICATION, not the file format.
 */
function safeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

/** A number Excel can actually sum — never NaN, never Infinity, never a string. */
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Round for display without pretending to a precision the source never had. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Render one player's submissions for one mission into a single readable cell.
 *
 * The WHOLE attempt history, in order, each with its verdict — the wrong guesses
 * are the interesting half of an educational run, and a cell showing only the
 * winning answer would hide exactly what the creator opened this file to see.
 *
 * Total: it is called once per row over data that may be decades of edits old.
 */
export function formatAnswerCell(
  row: Pick<ReportAnswerRow, 'answerChannel' | 'answers' | 'answersUnavailable' | 'finalAnswer' | 'status'>
    | null | undefined,
  labels: ReportExportLabels,
): string {
  if (!row || typeof row !== 'object') return labels.noAnswerNeeded;
  // A mission with no text channel: there was never an answer to give, so neither
  // "not recorded" nor "not answered" would be true.
  if (row.answerChannel === 'none' || row.answerChannel === 'media') return labels.noAnswerNeeded;

  const recorded = Array.isArray(row.answers) ? row.answers : [];
  if (recorded.length === 0) {
    if (row.finalAnswer) return safeText(row.finalAnswer);
    // Distinguish "we lost it" from "they never gave one". `answersUnavailable` is
    // only ever set on a mission the player actually COMPLETED.
    if (row.answersUnavailable) return labels.notRecorded;
    return labels.notAnswered;
  }

  return recorded
    .map((entry) => {
      const text = safeText(entry?.answer);
      const step = typeof entry?.stepIndex === 'number' && entry.stepIndex >= 0
        // 1-based: the file is read by a human counting steps, not by an array.
        ? `${entry.stepIndex + 1}. `
        : '';
      // A survey has no right answer, so it gets no marker — a fabricated ✓/✗
      // would be a false statement about a question that has neither.
      const verdict = entry?.correct === true ? ` (${labels.correct})`
        : entry?.correct === false ? ` (${labels.wrong})`
          : '';
      return `${step}${text}${verdict}`;
    })
    .join('\n');
}

/** The final verdict column: a tri-state, never a bare boolean. */
function verdictCell(row: ReportAnswerRow, labels: ReportExportLabels): string {
  if (row.answerChannel === 'none' || row.answerChannel === 'media') return labels.noAnswerNeeded;
  if (row.correct === true) return labels.correct;
  if (row.correct === false) return labels.wrong;
  return labels.noAnswerNeeded;
}

/**
 * Build the whole workbook: three sheets, header row first.
 *
 * Pure — no DOM, no dynamic import, no clock — so the whole shape is unit-testable
 * and the download shell below has nothing left to get wrong.
 */
export function buildReportWorkbook(
  report: RunPlayerReport,
  labels: ReportExportLabels,
): ReportWorkbook {
  const c = labels.columns;
  const players = Array.isArray(report?.players) ? report.players : [];
  const answers = Array.isArray(report?.answers) ? report.answers : [];
  const missions = Array.isArray(report?.missions) ? report.missions : [];

  const playersSheet: ReportSheet = {
    id: 'players',
    columnWidths: [22, 28, 8, 10, 10, 14, 20, 20, 10, 16, 12, 10, 16, 8],
    rows: [
      [
        c.player, c.members, c.rank, c.score, c.penalty, c.status, c.started, c.finished,
        c.durationMinutes, c.missionsDone, c.missionsSkipped, c.hints, c.wrongAnswers, c.media,
      ],
      ...players.map((p) => [
        safeText(p.playerName),
        safeText((p.memberNames ?? []).join(', ')),
        safeNumber(p.rank),
        safeNumber(p.score),
        safeNumber(p.bonusPenalty),
        safeText(p.status),
        safeText(p.startedAt),
        safeText(p.finishedAt),
        p.durationMinutes === null ? '' : round2(safeNumber(p.durationMinutes)),
        safeNumber(p.missionsCompleted),
        safeNumber(p.missionsSkipped),
        safeNumber(p.hintsUsed),
        safeNumber(p.wrongAnswers),
        safeNumber(p.mediaCount),
      ] as Cell[]),
    ],
  };

  const answersSheet: ReportSheet = {
    id: 'answers',
    columnWidths: [22, 14, 26, 14, 34, 24, 40, 10, 10, 10, 10, 40],
    rows: [
      [
        c.player, c.stage, c.mission, c.type, c.question, c.expected, c.theirAnswer,
        c.verdict, c.attempts, c.points, c.minutes, c.mediaLink,
      ],
      ...answers.map((row) => [
        safeText(row.playerName),
        safeText(row.stageTitle || String(safeNumber(row.stageOrder) + 1)),
        safeText(row.taskTitle),
        safeText(row.taskType),
        safeText(row.question),
        safeText(row.expectedAnswer),
        formatAnswerCell(row, labels),
        verdictCell(row, labels),
        safeNumber(row.attempts),
        safeNumber(row.earnedScore),
        row.minutes === null ? '' : round2(safeNumber(row.minutes)),
        safeText(row.mediaUrl),
      ] as Cell[]),
    ],
  };

  const missionsSheet: ReportSheet = {
    id: 'missions',
    columnWidths: [14, 26, 14, 10, 12, 10, 14, 14, 10, 16],
    rows: [
      [
        c.stage, c.mission, c.type, c.players, c.completed, c.skipped,
        c.completionRate, c.medianMinutes, c.hints, c.wrongAnswers,
      ],
      ...missions.map((m) => [
        safeText(m.stageTitle || String(safeNumber(m.stageOrder) + 1)),
        safeText(m.title),
        safeText(m.type),
        safeNumber(m.attemptedBy),
        safeNumber(m.completedBy),
        safeNumber(m.skippedBy),
        round2(safeNumber(m.completionRate)),
        m.medianMinutes === null ? '' : round2(safeNumber(m.medianMinutes)),
        safeNumber(m.hintCount),
        safeNumber(m.wrongAnswerCount),
      ] as Cell[]),
    ],
  };

  // The access code is the handle a creator recognises a run by; the run id is the
  // fallback so two exports from the same day never overwrite each other.
  const stamp = report?.meta?.accessCode || report?.meta?.runId || 'run';
  return {
    sheets: [playersSheet, answersSheet, missionsSheet],
    sheetNames: [labels.sheetPlayers, labels.sheetAnswers, labels.sheetMissions],
    fileName: `rushpoint-${String(stamp).replace(/[^\w-]/g, '')}.xlsx`,
  };
}

/**
 * Write the workbook and hand it to the browser.
 *
 * The ONLY place `write-excel-file` is referenced, and only through a dynamic
 * import: the library is ~a few hundred KB and would otherwise sit in the
 * console's entry chunk, paid for by every creator on every page, to serve one
 * button on one route.
 *
 * Everything decided above is already decided — this shell only converts the pure
 * row model into the library's cell objects and triggers the download.
 */
export async function downloadReportWorkbook(
  report: RunPlayerReport,
  labels: ReportExportLabels,
  opts: { rightToLeft?: boolean } = {},
): Promise<void> {
  const book = buildReportWorkbook(report, labels);
  // The BROWSER build specifically. The package has no root export — importing
  // `write-excel-file` bare resolves nothing, and the `/node` build pulls in Node
  // stream APIs that do not exist here.
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  await writeXlsxFile(
    book.sheets.map((s, i) => ({
      sheet: book.sheetNames[i],
      // Hebrew is the console's default language, and a Hebrew sheet laid out
      // left-to-right reads as broken even when every cell is correct.
      rightToLeft: opts.rightToLeft ?? false,
      columns: s.columnWidths.map((width) => ({ width })),
      // Freeze the header: an answers sheet is dozens of rows long and scrolling
      // past the column names makes the whole thing unreadable.
      stickyRowsCount: 1,
      data: s.rows.map((row, rowIndex) => row.map((cell) => ({
        value: cell,
        type: typeof cell === 'number' ? Number : String,
        // The only formatting this file needs: tell the column names from the data.
        fontWeight: rowIndex === 0 ? ('bold' as const) : undefined,
        // Submissions are joined with newlines, so the cell must be allowed to
        // wrap or a multi-attempt history renders as one unreadable line.
        wrap: rowIndex > 0 && typeof cell === 'string' && cell.includes('\n'),
        alignVertical: 'top' as const,
      }))),
    })),
  ).toFile(book.fileName);
}
