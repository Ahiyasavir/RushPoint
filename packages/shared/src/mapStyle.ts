// ─── Map style resolver (shared by creator-web + play-web) ────────────────────
//
// RushPoint is a *field race*, so every map leans topographic/outdoor. When a
// MapTiler key is configured we use their vector "outdoor" style; otherwise we
// fall back to a keyless raster style (OpenTopoMap) so maps render with zero
// setup. Returns a value maplibre-gl's `style` option accepts directly (a style
// URL string, or an inline StyleSpecification object) — no maplibre import here,
// so this stays usable from any layer.

// Minimal structural type — matches maplibre's StyleSpecification shape we use.
export interface RasterMapStyle {
  version: 8;
  sources: Record<string, unknown>;
  layers: Array<Record<string, unknown>>;
  glyphs?: string;
}

const OPENTOPO_TILES = [
  'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
  'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
  'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
];

/** Keyless raster fallback — OpenTopoMap (free, no card, attribution required). */
export function keylessTopoStyle(): RasterMapStyle {
  return {
    version: 8,
    sources: {
      opentopo: {
        type: 'raster',
        tiles: OPENTOPO_TILES,
        tileSize: 256,
        maxzoom: 17,
        attribution:
          '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)',
      },
    },
    layers: [{ id: 'opentopo', type: 'raster', source: 'opentopo' }],
  };
}

/**
 * Resolve the map style for a maplibre `Map`.
 * @param maptilerKey optional MapTiler key (Vite: import.meta.env.VITE_MAPTILER_KEY)
 * @param variant MapTiler map id to use when keyed (default 'outdoor')
 */
export function resolveMapStyle(
  maptilerKey?: string,
  variant: 'outdoor' | 'streets-v2' | 'hybrid' = 'outdoor',
): string | RasterMapStyle {
  if (maptilerKey && maptilerKey.trim()) {
    return `https://api.maptiler.com/maps/${variant}/style.json?key=${maptilerKey.trim()}`;
  }
  return keylessTopoStyle();
}
