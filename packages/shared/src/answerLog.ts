// What a participant actually SUBMITTED (change: post-run-player-report).
//
// Before this, an ordinary run graded an answer, sometimes charged for it, and
// threw the text away: `RunTaskRecord.submittedAnswer` / `wasCorrect` are written
// only when `sealsScoreFromParticipant(game)` is true. A creator running a class,
// a youth group or a quiz therefore had no way to see — or hand to anyone else —
// what each player answered. This module is the record.
//
// THREE PROPERTIES, each load-bearing:
//
//  1. BOUNDED. This is the only field on the team document whose SIZE a client
//     chooses: one entry per submission, and a device can submit as often as the
//     rate limiter allows. Uncapped, a brute-forcing phone walks the team document
//     toward Firestore's 1 MB ceiling and takes that team's whole run down with
//     it. Hence MAX_ANSWER_LOG_ENTRIES and MAX_ANSWER_LOG_ANSWER_LEN, applied here
//     rather than trusted at the call site.
//
//  2. TOTAL. `appendAnswerLog` runs INSIDE the transaction that grades and scores
//     the submission. A throw there would fail a legitimate answer over a
//     bookkeeping detail — so a malformed stored log, a non-string answer or a
//     null entry all degrade to "record nothing", never to an exception.
//
//  3. SERVER + OWNER ONLY. `RunTaskRecord.answerLog` is deliberately NOT added to
//     `sanitizeTeamForParticipant`'s allow-list (packages/shared/src/testMode.ts).
//     That allow-list is built by construction, so a new field is invisible to
//     participants until somebody adds it on purpose — which is exactly the
//     property that keeps a per-question wrong-answer history off the player's
//     device, in test mode and out of it. `scripts/test-test-mode.ts` pins it.
//
// The text is destroyed after ANSWER_LOG_RETENTION_DAYS by the sweep in
// functions/src/maintenance — scores, verdicts and timings survive that strip.

import type { RunStageRecord } from './types';

/** Which submission channel produced an entry. */
export type AnswerLogKind =
  | 'answer'         // a typed / chosen quiz or numeric answer
  | 'ordering'       // an ordering-quiz arrangement, serialized
  | 'sequence_step'  // one step of a multi-step sequence task
  | 'station_code'   // a smart-station secret code
  | 'survey';        // a survey response (no right answer, so no verdict)

export interface AnswerLogEntry {
  /** Server ISO instant. Never a client clock. */
  at: string;
  /** The submission, trimmed and truncated to MAX_ANSWER_LOG_ANSWER_LEN. */
  answer: string;
  /**
   * The verdict the grading path ACTED ON, written from that same decision.
   * Omitted entirely where there is no right answer (a survey) — an absent key
   * cannot be misread the way a fabricated `false` could.
   */
  correct?: boolean;
  kind: AnswerLogKind;
  /** Sequence tasks only: which step this submission was for. */
  stepIndex?: number;
}

/**
 * Ceiling for one stored submission.
 *
 * Deliberately tighter than `MAX_STORED_ANSWER_LEN` (500, used by the single
 * `submittedAnswer` slot): this field holds up to MAX_ANSWER_LOG_ENTRIES of them
 * per mission, so the per-entry bound multiplies. 200 chars comfortably holds any
 * real quiz answer, a serialized ordering arrangement, or a station code.
 */
export const MAX_ANSWER_LOG_ANSWER_LEN = 200;

/**
 * How many submissions are kept per mission.
 *
 * Worst case ≈ 6 × (200 chars + the small keys) ≈ 1.4 KB per mission; a
 * 40-mission game stays far under the 1 MB document limit even if every single
 * mission is brute-forced to the cap.
 */
export const MAX_ANSWER_LOG_ENTRIES = 6;

/**
 * How long recorded answer TEXT is kept, in days.
 *
 * Shorter than RUN_DATA_RETENTION_DAYS (90) on purpose: this is free-typed
 * participant text, the most sensitive thing a run captures after location, and
 * the creator's stated need for it is "read the report after the event", not
 * "keep it forever". The sweep that enforces it reuses the same fail-closed
 * `evaluateRunPrune` predicate the 90-day PII sweep uses, so the two cannot drift.
 */
export const ANSWER_LOG_RETENTION_DAYS = 30;

/** Everything a caller knows at the moment it grades a submission. */
export interface AnswerLogInput {
  kind: AnswerLogKind;
  answer: unknown;
  /** Omit where the submission has no right answer. */
  correct?: boolean;
  /** Sequence steps only. */
  stepIndex?: number;
  /** Server ISO instant — the SAME `now` the grading path stamped. */
  at: string;
}

/**
 * Build one entry, or `null` when there is nothing worth recording.
 *
 * Returning `null` rather than an empty-string entry is the difference between
 * "they submitted nothing" and "we stored a blank": the report distinguishes the
 * two, and a blank entry would read as a real (empty) answer.
 *
 * Total: any input shape yields an entry or `null`, never a throw.
 */
export function buildAnswerLogEntry(input: AnswerLogInput | null | undefined): AnswerLogEntry | null {
  if (!input || typeof input !== 'object') return null;
  const { kind, answer, correct, stepIndex, at } = input;
  if (typeof answer !== 'string') return null;
  const trimmed = answer.trim();
  if (!trimmed) return null;
  // An unstamped entry is not usable evidence — the report orders by `at` and the
  // retention sweep reasons about age, so a blank instant is worse than no record.
  if (typeof at !== 'string' || !at.trim()) return null;

  const entry: AnswerLogEntry = {
    at,
    answer: trimmed.slice(0, MAX_ANSWER_LOG_ANSWER_LEN),
    kind,
  };
  // Only ever write real values: Firestore rejects `undefined`, and an absent key
  // is how "no verdict" / "not a step" is expressed.
  if (typeof correct === 'boolean') entry.correct = correct;
  if (typeof stepIndex === 'number' && Number.isFinite(stepIndex)) entry.stepIndex = stepIndex;
  return entry;
}

/**
 * Append one entry, enforcing the per-mission cap.
 *
 * THE DROP COMES FROM THE MIDDLE. When the cap bites, the two entries a creator
 * actually wants are the FIRST guess (what they thought before they knew) and the
 * NEWEST (what they finally submitted, usually the one that landed). Dropping the
 * oldest would lose the first; dropping the newest would refuse to record the
 * answer that completed the mission. So the oldest `MAX_ANSWER_LOG_ENTRIES - 1`
 * are kept and the newest is appended, and the entries between them are what fall
 * away.
 *
 * Total and non-mutating: returns a fresh array for every input, including a
 * corrupt stored log (discarded) and a `null` entry (existing log returned as-is).
 */
export function appendAnswerLog(
  existing: readonly AnswerLogEntry[] | null | undefined,
  entry: AnswerLogEntry | null | undefined,
): AnswerLogEntry[] {
  const current = Array.isArray(existing)
    ? existing.filter((e): e is AnswerLogEntry => !!e && typeof e === 'object')
    : [];
  if (!entry || typeof entry !== 'object') return [...current];
  if (current.length < MAX_ANSWER_LOG_ENTRIES) return [...current, entry];
  return [...current.slice(0, MAX_ANSWER_LOG_ENTRIES - 1), entry];
}

/**
 * Strip every `answerLog` out of a team's stored stages.
 *
 * Destroys the free-typed TEXT and nothing else: `earnedScore`, `status`,
 * `startedAt` / `completedAt`, `actualMinutes`, `submittedAnswer` and `wasCorrect`
 * are all left byte-identical, so a run's report keeps its scores, verdicts and
 * timings long after the answers themselves are gone.
 *
 * Pure, total and idempotent — a second pass reports `removed: 0` — because it is
 * driven by a retention sweep that must be safe to re-run, and it walks documents
 * nobody validated on the way in.
 */
export function stripAnswerLogsFromStages(
  stages: readonly RunStageRecord[] | null | undefined,
): { stages: RunStageRecord[]; removed: number } {
  if (!Array.isArray(stages)) return { stages: [], removed: 0 };
  let removed = 0;
  const out = stages.map((stageRaw) => {
    if (!stageRaw || typeof stageRaw !== 'object') return stageRaw;
    const stage = stageRaw as unknown as Record<string, unknown>;
    if (!Array.isArray(stage.tasks)) return stageRaw;
    const tasks = (stage.tasks as unknown[]).map((recRaw) => {
      if (!recRaw || typeof recRaw !== 'object') return recRaw;
      const rec = recRaw as Record<string, unknown>;
      if (!('answerLog' in rec)) return recRaw;
      removed++;
      const { answerLog: _dropped, ...rest } = rec;
      return rest;
    });
    return { ...stage, tasks };
  });
  return { stages: out as unknown as RunStageRecord[], removed };
}
