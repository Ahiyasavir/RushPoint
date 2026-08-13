// Gallery GAME detail view model (change: gallery-game-card-preview).
//
// The gallery's GAME cards rendered a title, a clamped description and a meta row
// and nothing else: a creator judging a public game could not read its full
// description, its mode, its length or its coarse location before copying it into
// their own account. Pressing a game card now opens a read-only detail, and THIS
// module is that view — the parallel of `lib/galleryTaskDetail.ts`, which does the
// same for MISSIONS. (That file, and its modal, stay untouched; a game is a
// different shape with a different secrecy contract.)
//
// Why a value and not markup: creator-web has no component test runner, so the
// only way to PROVE the detail never surfaces a game's exact coordinates is to
// make the detail a plain object produced by a pure function and assert on it
// (scripts/test-gallery-game-detail.ts). The renderer holds no field knowledge.
//
// ── THE SECRECY MECHANISM: COPY OUT, NEVER SPREAD ────────────────────────────
// `PublicGame.approxLocation` is `GeoPoint & { label? }` — it CARRIES `lat`/`lng`
// alongside the human `label`. A detail view is, by construction, "show me
// everything", so a naive `...game.approxLocation` would ship the exact point into
// a world-readable-derived surface. Every field below is read by NAME onto a
// freshly constructed object; nothing is spread. We copy ONLY `approxLocation.label`
// and never its coordinates. A field this module does not name is dropped by
// construction, so an unknown future `PublicGame` field cannot ride along.
//
// `SECRET_GAME_FIELD_NAMES` is documentation for the test sweep, not the mechanism.
// Do not turn it into a filter.

/** Coordinate-bearing names the game detail must never carry. Swept by the test. */
export const SECRET_GAME_FIELD_NAMES = ['coordinates', 'lat', 'lng'] as const;

/** Game mode as the detail reports it. Anything unrecognized becomes ''. */
export type GalleryGameModeKey = 'individual' | 'team' | '';

/** GPS requirement as the detail reports it. Anything unrecognized becomes null. */
export type GalleryGameRequirementKey = 'gps' | 'anywhere' | null;

export interface GalleryGameDetail {
  id: string;
  title: string;
  /** null when the author wrote none, so the view can say so instead of gapping. */
  description: string | null;
  mode: GalleryGameModeKey;
  stageCount: number;
  taskCount: number;
  estimatedTotalMinutes: number;
  playCount: number;
  requirement: GalleryGameRequirementKey;
  /** ONLY the coarse human label — never the exact `approxLocation` coordinates. */
  locationLabel: string | null;
  tags: string[];
  /**
   * Whether this game offers a no-signup instant run (change:
   * gallery-missions-quick-play). Gates whether the quick-play button renders at
   * all, so it is STRICTLY boolean: a truthy string on a malformed public doc must
   * not be able to advertise a run that does not exist.
   */
  allowInstantPlay: boolean;
}

/** One row of the game's mission list. Deliberately small — a preview, not a copy. */
export interface GalleryGameMission {
  id: string;
  title: string;
  /** Normalized task type; anything unrecognized becomes 'unknown'. */
  type: string;
  /** null when unauthored, so the view can omit rather than print a fake 0. */
  estimatedMinutes: number | null;
}

// ─── Normalizers ──────────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s === '' ? null : s;
}

/** A count shown even at zero. Never negative, never NaN, always an integer. */
function countOf(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return n < 0 ? 0 : Math.floor(n);
}

function modeOf(v: unknown): GalleryGameModeKey {
  return v === 'individual' || v === 'team' ? v : '';
}

function requirementOf(v: unknown): GalleryGameRequirementKey {
  return v === 'gps' || v === 'anywhere' ? v : null;
}

// ─── The view model ───────────────────────────────────────────────────────────

/**
 * Build the detail shown when a creator presses a public GAME card.
 *
 * Accepts `unknown` and never throws: it runs on a `searchGallery` response inside
 * a modal, and a throw there blanks the whole Gallery behind the ErrorBoundary. A
 * garbage input yields a blank-titled detail, not an exception. Nothing is fetched
 * on open — the whole sanitized `PublicGame` is already held by the caller.
 */
export function buildGalleryGameDetail(input: unknown): GalleryGameDetail {
  const g = asRecord(input);
  // Read ONLY the label out of approxLocation. Never spread it — it carries lat/lng.
  const approx = asRecord(g.approxLocation);

  return {
    id: text(g.id) ?? '',
    title: text(g.title) ?? '',
    description: text(g.description),
    mode: modeOf(g.mode),
    stageCount: countOf(g.stageCount),
    taskCount: countOf(g.taskCount),
    estimatedTotalMinutes: countOf(g.estimatedTotalMinutes),
    playCount: countOf(g.playCount),
    requirement: requirementOf(g.requirement),
    locationLabel: text(approx.label),
    tags: Array.isArray(g.tags)
      ? g.tags.map((x) => text(x)).filter((x): x is string => x !== null)
      : [],
    // `=== true`, not a truthy coercion: this gates a button that starts a real run.
    allowInstantPlay: g.allowInstantPlay === true,
  };
}

// ─── Mission list (change: gallery-missions-quick-play) ───────────────────────
// The modal used to show COUNTS only — "12 missions" with no way to see what any of
// them were, which is what creators meant by "the preview didn't work, I saw
// nothing". Every task is already published individually to
// publicTasks/{gameId}_{taskId} carrying `sourceGameId`, and publicTasks is
// world-readable, so the rows come from a single-field equality query (no composite
// index) — no new callable, no new backend, no widening of what is public.
//
// SAME COPY-OUT DISCIPLINE as the rest of this module: four fields are read BY NAME
// onto a fresh object and nothing is spread, so a `publicTasks` doc that still
// carries a legacy answer key cannot leak it into a public preview. Forgetting a
// field costs a missing row value (visible); spreading one would cost a silent leak.

/** Task types a mission row may report. Anything else degrades to 'unknown'. */
const KNOWN_MISSION_TYPES: readonly string[] = [
  'field', 'self_report', 'smart_station', 'photo', 'quiz',
  'numeric', 'geofence', 'sequence', 'survey',
];

/**
 * Build the mission rows for a public game's detail view.
 *
 * Accepts `unknown` and NEVER throws: the input is world-readable data rendered
 * inside a modal, and a throw there blanks the whole Gallery behind the
 * ErrorBoundary. A non-array yields `[]`; a garbage element yields a blank row
 * rather than an exception.
 *
 * Order is the caller's (the query's), not re-sorted here — `publicTasks` docs carry
 * no reliable cross-stage ordering, and inventing one would misrepresent the route.
 */
export function buildGalleryGameMissions(input: unknown): GalleryGameMission[] {
  if (!Array.isArray(input)) return [];
  return input.map((raw) => {
    const t = asRecord(raw);
    const type = typeof t.type === 'string' && KNOWN_MISSION_TYPES.includes(t.type)
      ? t.type
      : 'unknown';
    const minutes = typeof t.estimatedMinutes === 'number' && Number.isFinite(t.estimatedMinutes)
      && t.estimatedMinutes > 0
      ? Math.floor(t.estimatedMinutes)
      : null;
    return {
      id: text(t.id) ?? '',
      title: text(t.title) ?? '',
      type,
      estimatedMinutes: minutes,
    };
  });
}
