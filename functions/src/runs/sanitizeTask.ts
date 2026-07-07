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
import { seededShuffle } from '@rushpoint/shared';

export function sanitizeTaskForParticipant(
  task: Task,
  // quiz-ordering: the caller (getMyTeamState) passes a per-team, per-task seed
  // (`${teamId}:${taskId}`) so ordering items reach the client deterministically
  // SHUFFLED — never in the authored (answer-key) order. No seed ⇒ fail closed.
  opts?: { shuffleSeed?: string },
) {
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
  const { smart, hint, answers, numericAnswer, steps, orderItems, ...rest } = task;

  // Ordering quiz: with a seed, emit a deterministic per-team shuffle (stable
  // across reloads/polls, so it can't be diffed to recover the order); without
  // one, strip the field entirely — fail closed, never leak the authored order.
  const shuffledOrderItems =
    Array.isArray(orderItems) && orderItems.length > 0 && opts?.shuffleSeed
      ? seededShuffle(orderItems, opts.shuffleSeed)
      : undefined;

  // Hidden-location (treasure-hunt) tasks keep their coordinates + radius SERVER-
  // SIDE only — the participant is guided by `locationClue` and discovers the spot
  // by arriving (server-validated GPS in completeTask). So when `hideLocation`,
  // remove the top-level coordinates + exact radius and flag `locationHidden` so
  // the client suppresses the map pin and renders the clue UI. The visible-task
  // path is unchanged.
  const hidden = !!rest.hideLocation;
  if (hidden) {
    delete (rest as { coordinates?: unknown }).coordinates;
    delete (rest as { geofenceRadiusMeters?: unknown }).geofenceRadiusMeters;
  }

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
          // For a hidden task, the station's injected coordinates + exact radius
          // are also withheld so the spot can't be triangulated.
          geofenceRadiusMeters: hidden ? undefined : smart.geofenceRadiusMeters,
          stationCoords: hidden ? undefined : smart.stationCoords,
          timeLimitSeconds: smart.timeLimitSeconds,
          autoApprove: smart.autoApprove,
          attemptLimit: smart.attemptLimit,
          // secretCode intentionally omitted
        }
      : undefined,
  };
}
