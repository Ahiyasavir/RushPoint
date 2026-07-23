// Participant-facing task sanitizer — the single security boundary that strips
// every server-secret answer key before a task is sent to a player's device.
//
// Extracted from runs/index.ts so it can be unit-tested directly (it is the most
// security-critical pure function in the codebase: a regression here leaks secret
// codes / quiz answers / numeric targets / hint text to the client). Behavior is
// unchanged — getMyTeamState imports this.
//
// What it MUST strip and never echo back:
//   - task.hint            (paid reveal only, via requestTaskHint)
//   - task.answers         (quiz answer key)
//   - task.numericAnswer   (numeric target)
//   - task.steps[].answer  (sequence step answers — prompts are kept)
//   - task.smart.secretCode + task.smart.adminNotes (and any field NOT in the
//     explicit allow-list below)
import type { Task } from '@rushpoint/shared';
import { seededShuffle, hiddenSearchArea } from '@rushpoint/shared';

export function sanitizeTaskForParticipant(
  task: Task,
  // quiz-ordering: the caller (getMyTeamState) passes a per-team, per-task seed
  // (`${teamId}:${taskId}`) so ordering items reach the client deterministically
  // SHUFFLED — never in the authored (answer-key) order. No seed ⇒ fail closed.
  opts?: {
    shuffleSeed?: string;
    // change: play-task-gating (wave D). Hidden-location ("treasure hunt") tasks
    // are SEALED until the server has confirmed the team physically arrived
    // (reportArrival latches RunTaskRecord.arrivedAt). `revealed` is that
    // server-side verdict; it defaults to FALSE so a caller that forgets to pass
    // it fails CLOSED. It has no effect on a non-hidden task.
    revealed?: boolean;
  },
) {
  // ── Sealed stub (hidden-location, not yet arrived) ──────────────────────────
  // Built by CONSTRUCTION, never by deleting from `...rest`: a field added to
  // `Task` tomorrow must default to WITHHELD, exactly like an answer key. The
  // player gets the clue and a coarse SEARCH AREA and nothing else — not the
  // title, not the type, not the inputs, not the exact spot. `type` is withheld
  // rather than faked; the client keys off `arrivalPending` and renders a sealed
  // card.
  //
  // change: hidden-mission-search-area. `searchArea` is the ONE locational value a
  // sealed task ships, and it is NOT a relaxation of the seal: it is a grid-snapped
  // ~445 m circle, derived by a pure function of the coordinate (so polling this
  // callable cannot sharpen it), guaranteed to CONTAIN the spot but never to be
  // it, and it says nothing about distance, bearing, radius or the task itself.
  // It exists because a hunt whose map showed literally nothing was a dead end
  // rather than a puzzle. Arrival is still decided ONLY by the server's GPS
  // verdict — standing inside the circle unseals nothing. See
  // packages/shared/src/hiddenSearchArea.ts for the containment arithmetic.
  if (task.hideLocation && !opts?.revealed) {
    // Mirrors the participant map's own pin source, so a hidden STATION's circle
    // sits over the station rather than a stale template coordinate.
    const area = hiddenSearchArea(task);
    return {
      id: task.id,
      locationHidden: true as const,
      arrivalPending: true as const,
      ...(task.locationClue != null ? { locationClue: task.locationClue } : {}),
      ...(task.locationClueHe != null ? { locationClueHe: task.locationClueHe } : {}),
      // Coarse search circle — omitted entirely for a locationless or unplaced
      // task, so such a mission's map is byte-identical to before this change.
      ...(area ? { searchArea: area } : {}),
      // The paid-hint affordance survives pre-arrival on purpose: a hint that
      // helps you FIND the spot is exactly what a treasure-hunt hint is for.
      hasHint: !!task.hint && task.hint.trim().length > 0,
      hintPenalty: task.hintPenalty ?? 25,
      // Non-revealing card chrome (how much it's worth / how hard / how long).
      ...(task.pointValue != null ? { pointValue: task.pointValue } : {}),
      ...(task.difficulty != null ? { difficulty: task.difficulty } : {}),
      ...(task.estimatedMinutes != null ? { estimatedMinutes: task.estimatedMinutes } : {}),
    } as Record<string, unknown>;
  }

  // Strip every server-secret answer key: the hint text (paid reveal only),
  // quiz answers, the numeric target, and each sequence step's answer. The UI
  // still gets choices / tolerance / radius / step prompts so it can render.
  // `media` (creator-authored image/video/YouTube attachments) carries no secret —
  // it stays in `...rest` and is passed through to the participant unchanged. It is
  // validated + canonicalized server-side at write time (normalizeTaskMedia), so no
  // sanitization is needed here. Listed in the e2e ALLOWED_TASK_KEYS allowlist.
  //
  // `orderItems` is destructured OUT of `...rest` on purpose: its authored ORDER
  // is the answer key (change: quiz-ordering), so it may only re-enter the payload
  // as a seeded shuffle below — never via passthrough.
  //
  // `surveyChoices` (change: survey-tasks) is DELIBERATELY left in `...rest` and
  // passed through: a survey has no right answer, so the options are not a secret —
  // the participant needs them to render the choice buttons. Listed in the e2e
  // ALLOWED_TASK_KEYS allowlist.
  const { smart, hint, answers, numericAnswer, steps, orderItems, ...rest } = task;

  // Ordering quiz: with a seed, emit a deterministic per-team shuffle (stable
  // across reloads/polls, so it can't be diffed to recover the order); without
  // one, strip the field entirely — fail closed, never leak the authored order.
  const shuffledOrderItems =
    Array.isArray(orderItems) && orderItems.length > 0 && opts?.shuffleSeed
      ? seededShuffle(orderItems, opts.shuffleSeed)
      : undefined;

  // Hidden-location (treasure-hunt) tasks: reaching this point means the task is
  // either not hidden at all, or hidden AND the server has confirmed arrival
  // (`opts.revealed`). Everything BEFORE arrival is handled by the sealed-stub
  // early return at the top of this function — coordinates never leave the server
  // while the spot is still secret.
  //
  // Product decision (wave D, user): AFTER arrival the coordinates ARE released,
  // so the map can pin the spot and a player who wanders off can navigate back.
  // The `locationHidden` flag is kept so the client still tells the treasure-hunt
  // story (clue box, "you found it" chrome) rather than silently turning into an
  // ordinary pin.
  const hidden = !!rest.hideLocation;

  return {
    ...rest,
    ...(shuffledOrderItems ? { orderItems: shuffledOrderItems } : {}),
    ...(hidden ? { locationHidden: true as const } : {}),
    hasHint: !!hint && hint.trim().length > 0,
    hintPenalty: task.hintPenalty ?? 25,
    steps: steps?.map((s) => ({ id: s.id, prompt: s.prompt })),
    smart: smart
      ? {
          enabled: smart.enabled,
          verificationType: smart.verificationType,
          longInstructions: smart.longInstructions,
          longInstructionsHe: smart.longInstructionsHe,
          extraInfo: smart.extraInfo,
          mediaUrl: smart.mediaUrl,
          imageUrl: smart.imageUrl,
          codeInputLabel: smart.codeInputLabel,
          hasCode: smart.hasCode,
          // A hidden station's injected coordinates + radius ride along with the
          // top-level ones: withheld entirely while sealed (the early return
          // emits no `smart` at all), released once the team has arrived.
          geofenceRadiusMeters: smart.geofenceRadiusMeters,
          stationCoords: smart.stationCoords,
          timeLimitSeconds: smart.timeLimitSeconds,
          autoApprove: smart.autoApprove,
          // audio-tasks: which capture widget the client must render (photo vs
          // audio recorder). Not a secret — the client needs it.
          captureKind: smart.captureKind,
          attemptLimit: smart.attemptLimit,
          // secretCode intentionally omitted
        }
      : undefined,
  };
}
