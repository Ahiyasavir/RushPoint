// ─── Map style resolver (shared by creator-web + play-web) ────────────────────
//
// RushPoint is a *field race*, so maps lean topographic/outdoor — but users can
// flip to satellite to see exactly where everything is on the ground. When a
// MapTiler key is configured we use their vector styles ("outdoor" / "hybrid");
// otherwise we fall back to keyless raster styles (OpenTopoMap / Esri World
// Imagery) so maps render with zero setup. Returns a value maplibre-gl's `style`
// option accepts directly (a style URL string, or an inline StyleSpecification
// object) — no maplibre import here, so this stays usable from any layer.

export type MapMode = 'topo' | 'satellite';

/**
 * The mode a map OPENS in (change: maps-open-on-satellite).
 *
 * Satellite, because the creator's first question at a map is "is this the right
 * spot on the ground?" — a courtyard, an entrance, which side of a building — and
 * imagery answers that where a topographic rendering cannot. Declared here because
 * it was `useState<MapMode>('topo')` written out at six separate call sites across
 * two apps, which is a default in name only: changing it meant finding all six.
 *
 * Safe without a MapTiler key: `resolveMapStyle` falls back to keyless Esri World
 * Imagery, so satellite is not a configuration-dependent default.
 *
 * NOTE the RTL consequence, already handled but easy to undo: the satellite style
 * labels places with their LOCAL name, so Hebrew renders backwards unless
 * `ensureRtlTextPlugin` has run. Every map component calls it at module scope —
 * making this the default means that call is now on the FIRST paint of every map,
 * not only after someone flips the toggle.
 */
export const DEFAULT_MAP_MODE: MapMode = 'satellite';

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

// Esri World Imagery — free, keyless satellite tiles ({z}/{y}/{x} order).
const ESRI_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
// Transparent labels/roads overlay so place names stay legible over imagery.
const ESRI_REFERENCE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

/** Keyless topographic raster fallback — OpenTopoMap (CC-BY-SA). */
export function keylessTopoStyle(): RasterMapStyle {
  return {
    version: 8,
    sources: {
      opentopo: {
        type: 'raster',
        tiles: OPENTOPO_TILES,
        tileSize: 256,
        maxzoom: 17,
        attribution: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)',
      },
    },
    layers: [{ id: 'opentopo', type: 'raster', source: 'opentopo' }],
  };
}

/** Keyless satellite raster fallback — Esri World Imagery + place labels. */
export function keylessSatelliteStyle(): RasterMapStyle {
  return {
    version: 8,
    sources: {
      esri: {
        type: 'raster',
        tiles: [ESRI_IMAGERY],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
      },
      esriRef: { type: 'raster', tiles: [ESRI_REFERENCE], tileSize: 256, maxzoom: 19 },
    },
    layers: [
      { id: 'esri', type: 'raster', source: 'esri' },
      { id: 'esriRef', type: 'raster', source: 'esriRef' },
    ],
  };
}

/**
 * Resolve the map style for a maplibre `Map`.
 * @param maptilerKey optional MapTiler key (Vite: import.meta.env.VITE_MAPTILER_KEY)
 * @param mode 'topo' (default) or 'satellite'
 */
export function resolveMapStyle(
  maptilerKey?: string,
  mode: MapMode = 'topo',
): string | RasterMapStyle {
  if (maptilerKey && maptilerKey.trim()) {
    const variant = mode === 'satellite' ? 'hybrid' : 'outdoor';
    return `https://api.maptiler.com/maps/${variant}/style.json?key=${maptilerKey.trim()}`;
  }
  return mode === 'satellite' ? keylessSatelliteStyle() : keylessTopoStyle();
}
