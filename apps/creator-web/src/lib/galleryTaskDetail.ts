// Gallery mission detail view model (change: gallery-mission-detail).
//
// The mission library rendered a CARD and nothing else: a two-line clamp of the
// description, no estimated minutes, no author, no publish date, and no way to
// read a mission before inserting it into a stage. Pressing a mission now opens a
// detail view, and THIS module is that view.
//
// Why a value and not markup: creator-web has no component test runner, so the
// only way to prove "the detail never shows an answer key" is to make the detail a
// plain object produced by a pure function and assert on it
// (scripts/test-gallery-task-detail.ts). The renderer holds no field knowledge; it
// walks `rows` and maps each `key` to an i18n label.
//
// ── THE SECRECY MECHANISM: COPY OUT, NEVER STRIP OUT ─────────────────────────
// Every field below is read by NAME onto a freshly constructed object. Nothing is
// spread from the input. A strip-list (`const { hint, ...rest } = task`) is
// correct only for the secrets someone remembered, and silently leaks the next
// field `PublicTask` grows. Copy-out leaks nothing by construction: forgetting a
// field costs a MISSING row, which is visible, not a LEAKED row, which is not.
//
// `SECRET_TASK_FIELD_NAMES` is therefore documentation for the test sweep, not the
// mechanism. Do not turn it into a filter.
import { isPlottablePublicTask, isCoarsePublicPoint } from '@rushpoint/shared';

/** Server-secret names the detail must never carry. Swept by the test suite. */
export const SECRET_TASK_FIELD_NAMES = [
  'answers',
  'numericAnswer',
  'numericTolerance',
  'steps',
  'hint',
  'hintPenalty',
  'secretCode',
  'smart',
  'choices',
  'surveyChoices',
  // Not an "answer key", but the same class of exposure: the EXACT authored point
  // (deprecated, stripped by searchTaskLibrary). Only `approxLocation` is public.
  'coordinates',
] as const;

/** Task type as the detail reports it. Anything unrecognized becomes `unknown`. */
export type GalleryTaskTypeKey =
  | 'field' | 'self_report' | 'smart_station' | 'photo' | 'quiz'
  | 'numeric' | 'geofence' | 'sequence' | 'survey' | 'unknown';

const KNOWN_TYPES: readonly string[] = [
  'field', 'self_report', 'smart_station', 'photo', 'quiz',
  'numeric', 'geofence', 'sequence', 'survey',
];

export type GalleryDetailRowKey =
  | 'type' | 'difficulty' | 'estimatedMinutes' | 'points'
  | 'copies' | 'likes' | 'source' | 'author' | 'published';

/**
 * The canonical row order. Exported so the test can assert the whole shape at once
 * instead of a hand-copied list that drifts from the implementation.
 */
export const GALLERY_DETAIL_ROW_ORDER: readonly GalleryDetailRowKey[] = [
  'type', 'difficulty', 'estimatedMinutes', 'points',
  'copies', 'likes', 'source', 'author', 'published',
];

export interface GalleryDetailRow {
  key: GalleryDetailRowKey;
  /** Already normalized: never NaN, never negative, never a blank string. */
  value: string | number;
}

export interface GalleryTaskDetail {
  id: string;
  title: string;
  /** null when the author wrote none, so the view can say so instead of gapping. */
  description: string | null;
  typeKey: GalleryTaskTypeKey;
  rows: GalleryDetailRow[];
  tags: string[];
  /**
   * The published `approxLocation`. For an ordinary task this is now the EXACT
   * authored point (change: gallery-precise-task-location) — the gallery shows
   * WHERE A CREATOR PUT A TASK, an authored point of interest, not a person's
   * location. A `hideLocation` task is the one exception: its point is coarsened to
   * a ~1 km cell because the doc is world-readable and the exact spot is a puzzle.
   */
  area: { lat: number; lng: number } | null;
  areaState: 'area' | 'no-area';
  /**
   * True when `area` is a COARSE ~1 km cell rather than an exact point — i.e. a
   * hidden-location (or legacy pre-backfill) pin. The view draws the "approximate
   * area" disclosure and cell square only when this is set; an exact pin gets a
   * plain precise marker and no approximate copy. Derived structurally from the
   * stored coordinate via `isCoarsePublicPoint`, never from a separate flag.
   */
  areaApproximate: boolean;
}

// ─── Normalizers ──────────────────────────────────────────────────────────────
// Each one answers "may this reach the DOM?" and returns null when it may not, so
// the row builder's suppression rule is a single `!= null` check.

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s === '' ? null : s;
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 1..10, matching the Builder card's DifficultyDots range. */
function difficultyOf(v: unknown): number | null {
  const n = finite(v);
  return n === null ? null : Math.min(10, Math.max(1, Math.round(n)));
}

/** A count that is shown even at zero (copies). Never negative, never NaN. */
function countOf(v: unknown): number {
  const n = finite(v);
  return n === null || n < 0 ? 0 : Math.floor(n);
}

/** A count that is only worth a row when it is positive (likes). */
function positiveCountOf(v: unknown): number | null {
  const n = countOf(v);
  return n > 0 ? n : null;
}

/**
 * Publish date as `YYYY-MM-DD`, normalized HERE and not in the renderer: a
 * `toLocaleDateString` in a component is untestable and renders differently per
 * machine. A date is a fact, not copy.
 */
function calendarDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

export function galleryTaskTypeKey(v: unknown): GalleryTaskTypeKey {
  return typeof v === 'string' && KNOWN_TYPES.includes(v) ? (v as GalleryTaskTypeKey) : 'unknown';
}

// ─── The view model ───────────────────────────────────────────────────────────

/**
 * Build the detail shown when a creator presses a public mission.
 *
 * Accepts `unknown` and never throws: it runs on a callable response inside a
 * modal, and a throw there blanks the whole Gallery behind the ErrorBoundary. A
 * garbage input yields a blank-titled `unknown`-type detail, not an exception.
 */
export function buildGalleryTaskDetail(input: unknown): GalleryTaskDetail {
  const t = asRecord(input);

  const rows: GalleryDetailRow[] = [];
  const push = (key: GalleryDetailRowKey, value: string | number | null) => {
    if (value !== null) rows.push({ key, value });
  };

  const typeKey = galleryTaskTypeKey(t.type);
  push('type', typeKey);
  push('difficulty', difficultyOf(t.difficulty));
  // An estimate of zero or less is not an estimate; it would also read as a
  // finished mission. Suppress rather than print a misleading "0 min".
  const minutes = finite(t.estimatedMinutes);
  push('estimatedMinutes', minutes !== null && minutes > 0 ? minutes : null);
  const points = finite(t.pointValue);
  push('points', points === null ? null : Math.max(0, Math.round(points)));
  // Copies is never suppressed: "0 copies" is a real signal about a mission.
  push('copies', countOf(t.copyCount));
  push('likes', positiveCountOf(t.likeCount));
  push('source', text(t.sourceGameTitle));
  push('author', text(t.ownerDisplayName));
  push('published', calendarDate(t.createdAt));

  // LOCATION. Routed through the shared reader's predicate, the SAME one the
  // library map filters its markers with, so the detail can never claim an area
  // the map refuses to plot (or vice versa). We read ONLY `approxLocation`: for an
  // ordinary task it is now the exact authored point, and for a hideLocation task
  // the coarse ~1 km cell — both published by `publicTaskLocation`. There is
  // deliberately NO fallback to the deprecated exact `coordinates`.
  const plottable = isPlottablePublicTask(t as { approxLocation?: { lat?: unknown; lng?: unknown } });
  const approx = asRecord(t.approxLocation);
  const area = plottable ? { lat: approx.lat as number, lng: approx.lng as number } : null;
  // A point is "approximate" exactly when it already sits on the public grid — a
  // hidden-location (or legacy pre-backfill) pin. An exact authored point is
  // off-grid, so the view can draw the honest affordance without a stored flag.
  const areaApproximate = area !== null && isCoarsePublicPoint(area);

  return {
    id: text(t.id) ?? '',
    title: text(t.title) ?? '',
    description: text(t.description),
    typeKey,
    rows,
    tags: Array.isArray(t.tags)
      ? t.tags.map((x) => text(x)).filter((x): x is string => x !== null)
      : [],
    area,
    areaState: area ? 'area' : 'no-area',
    areaApproximate,
  };
}
