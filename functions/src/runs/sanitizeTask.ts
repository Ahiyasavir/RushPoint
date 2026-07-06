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

export function sanitizeTaskForParticipant(task: Task) {
  // Strip every server-secret answer key: the hint text (paid reveal only),
  // quiz answers, the numeric target, and each sequence step's answer. The UI
  // still gets choices / tolerance / radius / step prompts so it can render.
  // `media` (creator-authored image/video/YouTube attachments) carries no secret —
  // it stays in `...rest` and is passed through to the participant unchanged. It is
  // validated + canonicalized server-side at write time (normalizeTaskMedia), so no
  // sanitization is needed here. Listed in the e2e ALLOWED_TASK_KEYS allowlist.
  const { smart, hint, answers, numericAnswer, steps, ...rest } = task;

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
