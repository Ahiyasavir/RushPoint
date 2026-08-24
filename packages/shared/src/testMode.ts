// Test mode (change: test-mode-hidden-scoring) — the pure core.
//
// A creator running an ASSESSMENT needs the opposite of what the participant app
// normally does: no live score, no right/wrong verdict, no leaderboard, no
// penalties. This module holds the three pure pieces that make that true, so the
// functions, creator-web and play-web all read ONE definition and cannot drift.
//
// Nothing here is cosmetic. `sanitizeTeamForParticipant` is the SECURITY
// BOUNDARY: getMyTeamState returns the team document whole, so hiding a score in
// the UI would leave it sitting in the callable response, readable in devtools —
// the same failure `manualLeaderboardReveal` had to fix at the source.
import type { Game, RunTeam, RunStageRecord, RunTaskRecord } from './types';

/**
 * Does this game seal scores and correctness from its PARTICIPANTS?
 *
 * The ONE place `Game.testMode` is interpreted. Deliberately strict: only the
 * boolean `true` seals. A truthy string or number from a hand-edited or legacy
 * document is not consent to silence a live run, and anything other than `true`
 * therefore reads as "normal game" — which is also what every game authored
 * before this change reads as.
 *
 * Total by contract: routing and a callable hot path both call it, so a throw
 * here would break the run rather than degrade it.
 */
export function sealsScoreFromParticipant(game: Game | null | undefined): boolean {
  if (!game || typeof game !== 'object') return false;
  return (game as { testMode?: unknown }).testMode === true;
}

/** Ceiling for a stored participant answer — the same bound `surveyResponse` uses. */
export const MAX_STORED_ANSWER_LEN = 500;

/**
 * Bound a participant-submitted answer for storage.
 *
 * The stored answer is the only field on the team document whose length a client
 * chooses, so it is clamped rather than trusted. Returns `undefined` for anything
 * that is not usable text, so the caller writes nothing instead of an empty key.
 */
export function boundStoredAnswer(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_STORED_ANSWER_LEN);
}

/**
 * Project a team document for the PARTICIPANT payload.
 *
 * An allow-list built by construction, mirroring `sanitizeTaskForParticipant` —
 * NOT a delete-list. The distinction is the whole point: with a delete-list every
 * field added to `RunTeam` or `RunTaskRecord` in future ships to the device by
 * default, which is precisely how the stored `wasCorrect` verdict would leak and
 * void the feature. Here, a new field is absent until someone deliberately adds
 * it, and `scripts/test-test-mode.ts` pins the key set so that is a decision, not
 * an accident.
 *
 * `sealed` (from `sealsScoreFromParticipant`) removes the scoring channel:
 * `score`, `bonusPenalty`, `smartStreak`, `streakMultiplier`, and per record
 * `earnedScore` / `scoreBreakdown`.
 *
 * The recorded submission (`submittedAnswer`, `wasCorrect`) is omitted in BOTH
 * modes. It has no participant use in any game, and a `wasCorrect` boolean on the
 * wire would defeat test mode entirely — so it is never allow-listed at all,
 * rather than conditionally stripped.
 *
 * Total: a malformed team degrades to the empty shape instead of throwing, so a
 * single bad document can never take down the participant's only read path.
 */
export function sanitizeTeamForParticipant(team: RunTeam | null | undefined, sealed: boolean): RunTeam {
  const t = (team && typeof team === 'object' ? team : {}) as Record<string, unknown>;

  const stagesIn = Array.isArray(t.stages) ? (t.stages as RunStageRecord[]) : [];
  const stages = stagesIn.map((stageRaw) => {
    const s = (stageRaw && typeof stageRaw === 'object' ? stageRaw : {}) as Record<string, unknown>;
    const tasksIn = Array.isArray(s.tasks) ? (s.tasks as RunTaskRecord[]) : [];
    const tasks = tasksIn.map((recRaw) => {
      const r = (recRaw && typeof recRaw === 'object' ? recRaw : {}) as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      // Progress the participant legitimately needs to render their own run.
      copy(out, r, 'taskId');
      copy(out, r, 'taskIndex');
      copy(out, r, 'status');
      copy(out, r, 'startedAt');
      copy(out, r, 'completedAt');
      copy(out, r, 'actualMinutes');
      // The hidden-task arrival latch: dropping it would re-seal a task the
      // player has already walked to.
      copy(out, r, 'arrivedAt');
      copy(out, r, 'verificationOutcome');
      copy(out, r, 'photoUrl');
      // Their own survey answer — not secret to its own team.
      copy(out, r, 'surveyResponse');
      if (!sealed) {
        copy(out, r, 'earnedScore');
        copy(out, r, 'scoreBreakdown');
      }
      return out as unknown as RunTaskRecord;
    });
    const stageOut: Record<string, unknown> = {};
    copy(stageOut, s, 'stageId');
    copy(stageOut, s, 'order');
    copy(stageOut, s, 'status');
    copy(stageOut, s, 'startedAt');
    copy(stageOut, s, 'completedAt');
    copy(stageOut, s, 'requiredTaskCount');
    if (!sealed) copy(stageOut, s, 'earnedScore');
    stageOut.tasks = tasks;
    return stageOut as unknown as RunStageRecord;
  });

  const out: Record<string, unknown> = {};
  // ── Always participant-visible ──────────────────────────────────────────────
  // Identity + membership. The participant already knows all of it.
  copy(out, t, 'id');
  copy(out, t, 'runId');
  copy(out, t, 'gameId');
  copy(out, t, 'ownerUid');
  copy(out, t, 'displayName');
  copy(out, t, 'registrationData');
  copy(out, t, 'memberNames');
  copy(out, t, 'memberCount');
  copy(out, t, 'status');
  copy(out, t, 'launched');
  copy(out, t, 'startedAt');
  copy(out, t, 'finishedAt');
  copy(out, t, 'updatedAt');
  // Shared team devices: the join code and roster drive the multi-phone UI, and
  // `deviceJoinCode` is what a second phone types to attach — dropping it breaks
  // joinTeamAsDevice outright.
  copy(out, t, 'deviceUids');
  copy(out, t, 'controllerUid');
  copy(out, t, 'deviceJoinCode');
  copy(out, t, 'devices');
  // Their own progress and pending work.
  copy(out, t, 'activeTaskId');
  copy(out, t, 'taskStepProgress');
  copy(out, t, 'taskHintsUsed');
  copy(out, t, 'stationHintsUsed');
  copy(out, t, 'smartVerifications');
  copy(out, t, 'taskSubmissions');
  copy(out, t, 'discoveryState');
  // Safety + why-are-we-paused. Withholding any of these would leave a stopped
  // participant with no explanation, which is a worse failure than a leaked score.
  copy(out, t, 'held');
  copy(out, t, 'heldAt');
  copy(out, t, 'heldReason');
  copy(out, t, 'heldBy');
  copy(out, t, 'heldMs');
  copy(out, t, 'outOfBounds');
  copy(out, t, 'outOfBoundsAt');
  copy(out, t, 'outOfBoundsOverrideUntil');
  copy(out, t, 'evacuatedFrom');
  copy(out, t, 'guardianConsent');

  // ── Sealed by test mode ─────────────────────────────────────────────────────
  // Each of these is a scoring or correctness signal. `taskAttempts` and
  // `answerPenalties` belong here for a reason that is easy to miss: they are not
  // scores, but a per-task WRONG-ANSWER COUNT and penalty ledger say precisely
  // which questions the participant got wrong — the exact thing test mode exists
  // to withhold. `powerUps` multiply score, and a streak is a run of correct work.
  if (!sealed) {
    copy(out, t, 'score');
    copy(out, t, 'bonusPenalty');
    copy(out, t, 'smartStreak');
    copy(out, t, 'streakMultiplier');
    copy(out, t, 'powerUps');
    copy(out, t, 'taskAttempts');
    copy(out, t, 'answerPenalties');
  }

  // Deliberately NEVER allow-listed, in either mode:
  //   submittedAnswer / wasCorrect  the recorded verdict — see the doc comment
  //   lastBreachAlertAt             a server-side alert cooldown marker; nothing
  //                                 client-side reads it and it is not progress
  out.stages = stages;
  return out as unknown as RunTeam;
}

/** Copy `key` only when the source actually carries it, so absent stays absent. */
function copy(dst: Record<string, unknown>, src: Record<string, unknown>, key: string): void {
  if (src[key] !== undefined) dst[key] = src[key];
}

/**
 * Routing strength derived from ACCURACY rather than pace.
 *
 * In test mode a wrong answer COMPLETES the task, so elapsed time stops measuring
 * competence: a participant who answers instantly and wrongly reads as fast,
 * therefore strong, and `computeSkillRatio` would route them the HARDEST
 * remaining questions — the exact opposite of what an assessment needs. This
 * replaces that signal (it does not blend with it, which would only dilute the
 * inversion rather than remove it).
 *
 * Accuracy `a` maps to `1 - 2a`, chosen so `adaptiveDifficultyMatch` — which
 * targets `-skillRatio` — is reused UNCHANGED:
 *   all correct -> -1 -> targets the hardest difficulty
 *   all wrong   -> +1 -> targets the easiest
 *   even split  ->  0 -> the same neutral value a team has before its first task
 *
 * Returns `null` when there is no evidence (no answered records), so the caller
 * falls back to today's behaviour instead of this inventing a verdict from
 * nothing. Only a real boolean `wasCorrect` counts as an answered record.
 */
export function accuracySkillRatio(records: readonly RunTaskRecord[] | null | undefined): number | null {
  if (!Array.isArray(records)) return null;
  let answered = 0;
  let correct = 0;
  for (const rec of records) {
    const flag = (rec as { wasCorrect?: unknown } | null | undefined)?.wasCorrect;
    if (typeof flag !== 'boolean') continue;
    answered++;
    if (flag) correct++;
  }
  if (answered === 0) return null;
  return 1 - 2 * (correct / answered);
}
