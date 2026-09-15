// Pure decisions for the video-mission recorder (change: video-submission-task).
// Framework-free and side-effect-free so scripts/test-video-capture.ts can run it
// without a component test runner. The clip-length RANGE itself lives in
// @rushpoint/shared's videoDuration.ts — this is only what the widget adds on top.

// ─── The capture profile (change: video-capture-profile) ─────────────────────
//
// WHAT WAS WRONG. The bitrate below was pinned and the RESOLUTION was not constrained
// at all — `getUserMedia` asked only for `facingMode`. So the browser captured at the
// camera's own default (1080p on essentially every modern phone, higher on many) and
// encoded that at a flat 2 Mbps. The worst of both worlds:
//
//   • 2 Mbps is UNDER-provisioned for 1080p. The bit budget was spread over four times
//     the pixels of 720p, so a clip came back blocky at exactly the bitrate that looks
//     clean on a smaller frame. The player filmed something and got mush.
//   • Encoding 1080p is expensive, and browser MediaRecorder on Android commonly
//     encodes VP8/VP9 in SOFTWARE. That is the hot phone, the dropped frames, and the
//     pause between "stop" and "here is your clip" — the part that reads as "not
//     smooth".
//   • And the file was large regardless, because size is bitrate x duration however
//     the bits were spent. Every one of those megabytes crosses a field connection
//     twice: once up, and once down to whoever reviews it.
//
// Asking for a 720p frame fixes all three at once: fewer pixels to encode (cooler,
// faster), the same bits spread over a quarter of the area (sharper), and a lower
// bitrate is then enough (smaller).
//
// `ideal`, NEVER `exact`. An `exact` constraint a camera cannot meet throws
// OverconstrainedError and the player gets NO camera — a harder failure than the one
// being fixed. Every line here is a preference; a device that ignores it still records.
export const CAPTURE_VIDEO_CONSTRAINTS = {
  // The rear camera is what a field mission is filmed with.
  facingMode: { ideal: 'environment' as const },
  width: { ideal: 1280 },
  height: { ideal: 720 },
  // 30fps, not 60: a field clip gains nothing from cinematic motion, and 60fps doubles
  // the encoder's work for bits that are then taken out of image quality.
  frameRate: { ideal: 30 },
};

// MediaRecorder's default video bitrate is browser-chosen and can be several times
// this. Left unpinned, a ceiling-length clip could land well past the server's
// MAX_PARTICIPANT_VIDEO_BYTES — the player records for a full minute and is refused
// only at upload. Pinning it is what makes that cap derivable arithmetic.
//
// 1.5 Mbps at 720p30 is a visibly BETTER picture than 2 Mbps at 1080p while being 25%
// smaller. The arithmetic is no longer a comment that cannot fail — see
// `predictedClipBytes`, asserted against the real cap by scripts/test-video-capture.ts.
export const VIDEO_BITS_PER_SECOND = 1_500_000;
export const AUDIO_BITS_PER_SECOND = 96_000;

/** Mirrors MAX_PARTICIPANT_VIDEO_BYTES in functions/uploadRoute.js. */
export const MAX_PARTICIPANT_VIDEO_BYTES = 20 * 1024 * 1024;

/**
 * Roughly how many bytes a clip of this length will weigh.
 *
 * Exists so "does a ceiling-length clip still fit under the upload cap?" is a question
 * a TEST can ask, rather than arithmetic in a comment that no longer matches the
 * constants beside it. Total: a garbage duration yields 0 rather than NaN, because
 * this feeds an estimate and never a refusal.
 */
export function predictedClipBytes(seconds: number): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return 0;
  return (VIDEO_BITS_PER_SECOND + AUDIO_BITS_PER_SECOND) * seconds / 8;
}

// Extension → content type, used ONLY when a picked File carries an empty `type`
// (some Android pickers). Every value must be one the server accepts, or the
// fallback becomes a dead end with extra steps: the upload succeeds and the
// submission is then refused on content-type.
// Keys mirror VIDEO_CONTENT_TYPES in @rushpoint/shared.
const VIDEO_EXT_TYPES: Record<string, string> = {
  webm: 'video/webm',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
};

export function videoTypeFromName(name: string): string {
  const ext = String(name ?? '').toLowerCase().split('.').pop() ?? '';
  return VIDEO_EXT_TYPES[ext] ?? 'video/mp4';
}

/**
 * What a clip's length means for the submit button.
 *
 *   'ok'        - at or above the mission's minimum.
 *   'short'     - under it, but close enough to send anyway (warn, do not block).
 *   'too-short' - so far under that it cannot be what the mission asked for.
 *
 * WHY 'short' EXISTS. The minimum used to be a hard wall, so a clip a second or two
 * under it could not be sent at all and the only route forward was to record the
 * whole thing again from zero. Reported as exactly that: refusing a clip "even when
 * it is short by just a little" is infuriating, and it punishes the player for the
 * recorder's own rounding rather than for anything they did.
 *
 * A minimum is guidance about what makes a good answer, not a correctness rule the
 * server checks - nothing downstream reads seconds at all. So it now warns down to
 * half the asked length and blocks only below that, where the clip really cannot be
 * the thing that was requested.
 */
export const CLIP_SHORT_FRACTION = 0.5;

export type ClipVerdict = 'ok' | 'short' | 'too-short';

/**
 * Grade a TRUSTED duration against a valid minimum. Both callers have already
 * rejected garbage input and decided to fail open on it, so this only ever sees
 * finite positive numbers.
 */
function gradeClip(seconds: number, minSeconds: number): ClipVerdict {
  // Half a second of slack: the tick counter and the container's own duration never
  // agree to the millisecond, and rounding against the player would refuse a clip
  // they were told was long enough.
  if (seconds + 0.5 >= minSeconds) return 'ok';
  return seconds + 0.5 >= minSeconds * CLIP_SHORT_FRACTION ? 'short' : 'too-short';
}

/**
 * Whether a clip picked from the device's own camera app is long enough.
 *
 * FAILS OPEN by construction: a `<video>` element reports `Infinity` or `NaN` for
 * containers whose metadata it cannot read, and that is not evidence of a short
 * clip. Refusing on an unreadable duration would block a participant for their
 * phone's file format — the server bounds bytes, never seconds, so nothing
 * downstream depends on this being strict.
 */
export function pickedClipVerdict(
  durationSeconds: number | undefined,
  minSeconds: number,
): ClipVerdict {
  if (typeof minSeconds !== 'number' || !Number.isFinite(minSeconds) || minSeconds <= 0) return 'ok';
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return 'ok';
  return gradeClip(durationSeconds, minSeconds);
}

/**
 * Whether a clip the recorder itself timed is under the mission's minimum.
 *
 * Unlike pickedClipVerdict this input IS trustworthy — the widget counted the
 * seconds it was recording — so it may be strict. It exists so the minimum gates
 * the SUBMIT button and nothing else: gating the STOP button (the shape this
 * replaced) trapped a player inside a live recording they were not allowed to
 * end, which is the one thing a recorder must never do.
 *
 * Total by the same contract as everything else on the participant hot path: a
 * missing or garbage elapsed value is not evidence of a short clip.
 */
export function recordedClipVerdict(
  elapsedSeconds: number | undefined,
  minSeconds: number,
): ClipVerdict {
  if (typeof minSeconds !== 'number' || !Number.isFinite(minSeconds) || minSeconds <= 0) return 'ok';
  if (typeof elapsedSeconds !== 'number' || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return 'ok';
  return gradeClip(elapsedSeconds, minSeconds);
}
