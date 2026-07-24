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
  };
}
