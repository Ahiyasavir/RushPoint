// The video-mission duration contract (change: video-submission-task).
//
// ONE module read by three call sites — the Builder's inline validation, the
// server's updateGame/importGameFile guards, and the participant recorder — so the
// range a creator authors, the range the server accepts and the range the recorder
// enforces cannot drift apart. Same shape as requiredTaskCountProblem /
// maxCompletableTasks: one ceiling function, never two copies.
//
// The two exports differ on purpose:
//   resolveVideoDuration  runs on the participant hot path ⇒ total, clamping, never
//                         throws. A stored value that is inverted or garbage must
//                         still produce a recorder the player can use.
//   videoDurationProblem  runs at authoring time ⇒ strict. A bad range is refused
//                         where the creator can still fix it.

export interface VideoDurationLimits {
  /** Smallest non-zero minimum, and smallest maximum, a creator may author. */
  floorSeconds: number;
  /** Largest maximum the platform allows. Sizes MAX_PARTICIPANT_VIDEO_BYTES. */
  ceilingSeconds: number;
  defaultMinSeconds: number;
  defaultMaxSeconds: number;
  /** A minimum this far below the maximum or closer is unrecordable in practice. */
  minSpreadSeconds: number;
}

// ⚠ ceilingSeconds is load-bearing beyond this file: MAX_PARTICIPANT_VIDEO_BYTES in
// functions/uploadRoute.js is sized for a clip of exactly this length. Raising it
// without re-sizing that cap ships an upload path that refuses missions the Builder
// happily authored.
export const VIDEO_DURATION_LIMITS: VideoDurationLimits = {
  floorSeconds: 5,
  ceilingSeconds: 60,
  defaultMinSeconds: 0,
  defaultMaxSeconds: 40,
  minSpreadSeconds: 5,
};

export interface VideoDurationRange {
  /** 0 means "no minimum". */
  minSeconds: number;
  maxSeconds: number;
}

/** The subset of SmartStationConfig this module reads. */
export interface VideoDurationSource {
  videoMinSeconds?: number;
  videoMaxSeconds?: number;
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * The effective range a client should enforce. Total: any input shape resolves to a
 * usable range rather than throwing or returning something a recorder can't honour.
 */
export function resolveVideoDuration(smart: VideoDurationSource | undefined | null): VideoDurationRange {
  const L = VIDEO_DURATION_LIMITS;
  const source = (smart && typeof smart === 'object') ? smart : {};

  const rawMax = finiteOrUndefined(source.videoMaxSeconds);
  const maxSeconds = rawMax === undefined
    ? L.defaultMaxSeconds
    : clamp(Math.round(rawMax), L.floorSeconds, L.ceilingSeconds);

  const rawMin = finiteOrUndefined(source.videoMinSeconds);
  let minSeconds: number;
  if (rawMin === undefined || rawMin <= 0) {
    minSeconds = L.defaultMinSeconds;
  } else {
    // A nonzero minimum below the floor is a nonsensical authoring value (a
    // 1-second "minimum" gates nothing), so it snaps up rather than through.
    minSeconds = clamp(Math.round(rawMin), L.floorSeconds, L.ceilingSeconds);
  }

  // An unreachable minimum is dropped, never resolved by raising the max. A player
  // can always satisfy "no minimum"; a minimum they cannot reach leaves the submit
  // button permanently dead with nothing they can do about it.
  if (minSeconds >= maxSeconds) minSeconds = 0;

  return { minSeconds, maxSeconds };
}

/**
 * The authoring verdict for a creator-supplied pair. `null` = acceptable.
 * Absent values fall back to the platform defaults, so an untouched task passes.
 */
export function videoDurationProblem(min: unknown, max: unknown): string | null {
  const L = VIDEO_DURATION_LIMITS;

  const minAbsent = min === undefined || min === null;
  const maxAbsent = max === undefined || max === null;

  if (!minAbsent && finiteOrUndefined(min) === undefined) {
    return `minimum clip length must be a number of seconds`;
  }
  if (!maxAbsent && finiteOrUndefined(max) === undefined) {
    return `maximum clip length must be a number of seconds`;
  }

  const minSeconds = minAbsent ? L.defaultMinSeconds : (min as number);
  const maxSeconds = maxAbsent ? L.defaultMaxSeconds : (max as number);

  if (maxSeconds < L.floorSeconds || maxSeconds > L.ceilingSeconds) {
    return `maximum clip length must be between ${L.floorSeconds} and ${L.ceilingSeconds} seconds (got ${maxSeconds})`;
  }
  if (minSeconds < 0 || minSeconds > L.ceilingSeconds) {
    return `minimum clip length must be between 0 and ${L.ceilingSeconds} seconds (got ${minSeconds})`;
  }
  if (minSeconds > 0 && minSeconds < L.floorSeconds) {
    return `a minimum clip length must be at least ${L.floorSeconds} seconds (got ${minSeconds}) — use 0 for no minimum`;
  }
  if (minSeconds >= maxSeconds) {
    return `minimum clip length (${minSeconds}s) must be shorter than the maximum (${maxSeconds}s)`;
  }
  if (minSeconds > 0 && maxSeconds - minSeconds < L.minSpreadSeconds) {
    return `leave at least ${L.minSpreadSeconds} seconds between the minimum (${minSeconds}s) and maximum (${maxSeconds}s)`;
  }
  return null;
}
