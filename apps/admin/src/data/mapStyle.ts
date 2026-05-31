// MapLibre style resolver. Two variants:
//   • 'outdoor'   — topographic terrain (MapTiler outdoor-v2, keyless OpenTopoMap fallback)
//   • 'satellite' — aerial/hybrid imagery (MapTiler hybrid, keyless ESRI World Imagery fallback)
// Both fall back to a keyless raster so the map is NEVER blank.
import type { StyleSpecification } from 'maplibre-gl';

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

export type MapVariant = 'outdoor' | 'satellite';

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

/** Keyless satellite fallback (Esri World Imagery raster). */
const ESRI_SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    esri: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [{ id: 'esri', type: 'raster', source: 'esri' }],
};

/** Returns the MapLibre style for the requested variant (MapTiler when keyed). */
export function getMapStyle(variant: MapVariant = 'outdoor'): string | StyleSpecification {
  if (MAPTILER_KEY) {
    return variant === 'satellite'
      ? `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}`
      : `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${MAPTILER_KEY}`;
  }
  return variant === 'satellite' ? ESRI_SATELLITE_STYLE : OPENTOPO_STYLE;
}
