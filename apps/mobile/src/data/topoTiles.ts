// Keyless topographic basemap for the mobile mission map.
//
// MapTiler's Static Maps API needs a valid key; when it's missing or invalid the
// screen showed MapTiler's "Invalid Key" image. OpenTopoMap serves keyless
// raster tiles (CC-BY-SA, OSM data) — the same fallback the admin map uses. We
// compose a grid of those 256px tiles into the map viewport ourselves so the
// mobile map renders with NO key and NO GL dependency (plain <Image>s).
//
// Alignment: we use the SAME 512px tile convention as @rushpoint/shared's
// fitRouteView / projectToPixel (TILE_SIZE = 512), so station markers and the
// GPS dot — which use projectToPixel — line up exactly over these tiles.
import type { MapView } from '@rushpoint/shared';

const OSM_TILE = 256;       // OpenTopoMap native tile size
const PROJ_TILE = 512;      // must match @rushpoint/shared TILE_SIZE
const MAX_Z = 17;           // OpenTopoMap max zoom

// Web-Mercator world coordinates in [0,1] (re-implemented; geo.ts keeps these private).
function worldX(lng: number): number {
  return (lng + 180) / 360;
}
function worldY(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

export interface TopoTile {
  key: string;
  url: string;
  left: number;
  top: number;
  size: number;
}

/**
 * Compute the OpenTopoMap tiles that cover a width×height viewport framed at
 * `view` (center + fractional zoom from fitRouteView). Returns absolutely-
 * positioned tile descriptors to render as <Image>s inside a clipped container.
 */
export function buildTopoTiles(width: number, height: number, view: MapView): TopoTile[] {
  const scale = PROJ_TILE * Math.pow(2, view.zoom); // world width in px at this view
  // Integer OSM zoom whose 256px tiles render closest to native size here.
  // 512px@z ≡ 256px@(z+1) in scale, so Zt ≈ view.zoom + 1.
  const Zt = Math.max(1, Math.min(MAX_Z, Math.round(view.zoom + 1)));
  const n = Math.pow(2, Zt);
  const tilePx = scale / n; // on-screen size of one tile

  // Top-left of the viewport in world pixels (same `scale` coordinate system).
  const originX = worldX(view.centerLng) * scale - width / 2;
  const originY = worldY(view.centerLat) * scale - height / 2;

  const minTX = Math.floor(originX / tilePx);
  const maxTX = Math.floor((originX + width) / tilePx);
  const minTY = Math.floor(originY / tilePx);
  const maxTY = Math.floor((originY + height) / tilePx);

  const tiles: TopoTile[] = [];
  for (let ty = minTY; ty <= maxTY; ty++) {
    if (ty < 0 || ty >= n) continue; // no vertical wrap
    for (let tx = minTX; tx <= maxTX; tx++) {
      const wx = ((tx % n) + n) % n; // horizontal wrap
      const sub = 'abc'[Math.abs(wx + ty) % 3];
      tiles.push({
        key: `${Zt}/${tx}/${ty}`,
        url: `https://${sub}.tile.opentopomap.org/${Zt}/${wx}/${ty}.png`,
        left: tx * tilePx - originX,
        top: ty * tilePx - originY,
        size: tilePx,
      });
    }
  }
  return tiles;
}

export { OSM_TILE };
