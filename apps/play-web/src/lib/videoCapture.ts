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
// 64 kbps (was 96): Opus is near fullband for speech from ~24 kbps, and 64 to 96 kbps is the
// stereo MUSIC range (video-upload-speed D1). The picture is unchanged; only overhead goes.
export const AUDIO_BITS_PER_SECOND = 64_000;

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

// ─── Weak-link profile (change: media-upload-reliability, D9; video-upload-speed D1) ──
//
// Every byte recorded crosses the field connection before the mission counts, and on a weak link
// the upload IS the wait. Owner decision (video-upload-speed task 0.2): the picture drops ONLY on a
// weak network, in two tiers:
//   light   (540p, 1.0 Mbps) on `3g`, `saveData`, or a measured uplink under WEAK_UPLINK_BPS
//   lighter (360p, 600 kbps) on `2g`/`slow-2g`, or a measured uplink under VERY_WEAK_UPLINK_BPS
// `effectiveType` describes the DOWNLOAD side and does not exist on iOS at all, so a fresh sample
// of this phone's own uplink to our server (the caller passes it only while it is fresh) decides
// when present. `saveData` is the player's own request and always wins. `ideal` only, the same rule
// as above; anything unrecognised means the default profile, never a refusal.
export interface ConnectionHint {
  saveData?: unknown;
  effectiveType?: unknown;
}

export type CaptureTier = 'default' | 'light' | 'lighter';

export interface CaptureProfile {
  video: {
    facingMode: { ideal: 'environment' | 'user' };
    width: { ideal: number };
    height: { ideal: number };
    frameRate: { ideal: number };
  };
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
  light: boolean;
  tier: CaptureTier;
}

export const LIGHT_VIDEO_BITS_PER_SECOND = 1_000_000;
export const LIGHTER_VIDEO_BITS_PER_SECOND = 600_000;
export const LIGHT_AUDIO_BITS_PER_SECOND = 48_000;
/** Measured uplink, bytes per second. 150 KB/s moves a 60 s 720p clip in about 80 s. */
export const WEAK_UPLINK_BPS = 150_000;
export const VERY_WEAK_UPLINK_BPS = 50_000;

function tierFor(connection: ConnectionHint | null | undefined, measuredUplinkBps: unknown): CaptureTier {
  if (connection?.saveData === true) {
    return typeof measuredUplinkBps === 'number' && Number.isFinite(measuredUplinkBps)
      && measuredUplinkBps > 0 && measuredUplinkBps < VERY_WEAK_UPLINK_BPS ? 'lighter' : 'light';
  }
  if (typeof measuredUplinkBps === 'number' && Number.isFinite(measuredUplinkBps) && measuredUplinkBps > 0) {
    if (measuredUplinkBps < VERY_WEAK_UPLINK_BPS) return 'lighter';
    if (measuredUplinkBps < WEAK_UPLINK_BPS) return 'light';
    return 'default';
  }
  const et = connection?.effectiveType;
  if (et === 'slow-2g' || et === '2g') return 'lighter';
  if (et === '3g') return 'light';
  return 'default';
}

export function captureProfileFor(
  connection: ConnectionHint | null | undefined,
  measuredUplinkBps?: number | null,
): CaptureProfile {
  const tier = tierFor(connection, measuredUplinkBps);
  if (tier === 'default') {
    return {
      video: { ...CAPTURE_VIDEO_CONSTRAINTS },
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      light: false,
      tier,
    };
  }
  const lighter = tier === 'lighter';
  return {
    video: {
      ...CAPTURE_VIDEO_CONSTRAINTS,
      width: { ideal: lighter ? 640 : 960 },
      height: { ideal: lighter ? 360 : 540 },
    },
    videoBitsPerSecond: lighter ? LIGHTER_VIDEO_BITS_PER_SECOND : LIGHT_VIDEO_BITS_PER_SECOND,
    audioBitsPerSecond: LIGHT_AUDIO_BITS_PER_SECOND,
    light: true,
    tier,
  };
}

/**
 * Bytes for a clip recorded with THIS profile (video-upload-speed D1): the ETA must predict with
 * the profile actually recording, not the default. Total, like predictedClipBytes.
 */
export function predictedClipBytesFor(seconds: number, profile: Pick<CaptureProfile, 'videoBitsPerSecond' | 'audioBitsPerSecond'> | null | undefined): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return 0;
  const v = profile && Number.isFinite(profile.videoBitsPerSecond) && profile.videoBitsPerSecond > 0 ? profile.videoBitsPerSecond : VIDEO_BITS_PER_SECOND;
  const a = profile && Number.isFinite(profile.audioBitsPerSecond) && profile.audioBitsPerSecond >= 0 ? profile.audioBitsPerSecond : AUDIO_BITS_PER_SECOND;
  return (v + a) * seconds / 8;
}

// ─── A camera that never answers (change: media-upload-reliability, D5) ──────
//
// Some Android WebViews leave `getUserMedia` pending forever: no stream, no error. The widget
// sat on "opening the camera" with its fallback (the native camera input) unreachable. Race it
// against a deadline; on timeout reject with `camera/timeout` so the caller shows the fallback,
// and if the stream turns up LATER, stop it so the camera light does not stay on behind the
// player's back.
export const CAMERA_OPEN_DEADLINE_MS = 12_000;

export function withCameraDeadline<T>(
  opening: Promise<T>,
  ms: number,
  stopLate: (stream: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(Object.assign(new Error('camera did not open'), { code: 'camera/timeout' }));
    }, ms);
    opening.then(
      (stream) => {
        if (expired) {
          try { stopLate(stream); } catch { /* best effort */ }
          return;
        }
        clearTimeout(timer);
        resolve(stream);
      },
      (err) => {
        if (expired) return;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
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
