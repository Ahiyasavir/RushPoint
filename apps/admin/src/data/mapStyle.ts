// MapLibre style resolver. Prefers MapTiler's topographic "outdoor" style (free
// tier, no credit card) when a key is configured; otherwise falls back to a
// keyless OpenTopoMap raster style so the map is NEVER blank — both show terrain.
import type { StyleSpecification } from 'maplibre-gl';

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

/** Keyless topographic fallback (OpenTopoMap raster — CC-BY-SA, OSM data). */
const OPENTOPO_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    opentopo: {
      type: 'raster',
      tiles: [
        'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      maxzoom: 17,
      attribution:
        '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · © OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'opentopo', type: 'raster', source: 'opentopo' }],
};

/** Returns the MapTiler outdoor style URL, or the keyless OpenTopoMap fallback. */
export function getMapStyle(): string | StyleSpecification {
  if (MAPTILER_KEY) {
    return `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${MAPTILER_KEY}`;
  }
  return OPENTOPO_STYLE;
}
