// Pure decisions for the video-mission recorder (change: video-submission-task).
// Framework-free and side-effect-free so scripts/test-video-capture.ts can run it
// without a component test runner. The clip-length RANGE itself lives in
// @rushpoint/shared's videoDuration.ts — this is only what the widget adds on top.

// MediaRecorder's default video bitrate is browser-chosen and can be several times
// this. Left unpinned, a ceiling-length clip could land well past the server's
// MAX_PARTICIPANT_VIDEO_BYTES — the player records for a full minute and is refused
// only at upload. Pinning it here is what makes that cap derivable arithmetic:
// (2_000_000 + 96_000) bits/s x 60s / 8 ≈ 15.7MB against a 20MB cap.
export const VIDEO_BITS_PER_SECOND = 2_000_000;
export const AUDIO_BITS_PER_SECOND = 96_000;

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
): 'ok' | 'too-short' {
  if (typeof minSeconds !== 'number' || !Number.isFinite(minSeconds) || minSeconds <= 0) return 'ok';
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return 'ok';
  return durationSeconds + 0.5 < minSeconds ? 'too-short' : 'ok';
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
): 'ok' | 'too-short' {
  if (typeof minSeconds !== 'number' || !Number.isFinite(minSeconds) || minSeconds <= 0) return 'ok';
  if (typeof elapsedSeconds !== 'number' || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return 'ok';
  // Half a second of slack: the tick counter and the container's own duration
  // never agree to the millisecond, and rounding against the player would refuse
  // a clip they were told was long enough.
  return elapsedSeconds + 0.5 < minSeconds ? 'too-short' : 'ok';
}
