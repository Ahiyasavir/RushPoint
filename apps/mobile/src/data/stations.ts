// Mobile mission map — a static topographic image (MapTiler "outdoor" style)
// showing the Motza → Gan HaKipod route with the station markers. Geography comes
// from @rushpoint/shared (single source of truth). Rendered in a plain <Image>,
// so it works identically on web + native with no GL dependency.
import { ROUTE_PATH, STATION_GEO, fitRouteView } from '@rushpoint/shared';

/**
 * Builds a MapTiler Static Maps API URL: topographic "outdoor" style, framed at a
 * KNOWN center+zoom (via fitRouteView) so a live GPS dot can be projected on top
 * accurately, with the route drawn as a line and a marker per station. Rendered in
 * an <Image>, so it works on web + native with no GL dependency.
 *
 * NOTE: pass the SAME width/height here and to projectToPixel so the overlay dot
 * lines up with the image frame.
 *
 * MapTiler free tier: 100k tiles/month, no credit card. Without a key the caller
 * shows a friendly placeholder instead (see app/map.tsx), so a missing/invalid
 * key can never crash the screen.
 */
export function buildStaticMapUrl(key: string, width = 640, height = 420): string {
  const v = fitRouteView(width, height);
  const center = `${v.centerLng.toFixed(5)},${v.centerLat.toFixed(5)},${v.zoom.toFixed(2)}`;
  const stroke = encodeURIComponent('#00c389'); // route line colour (encoded '#')
  const pathCoords = ROUTE_PATH.map((p) => `${p.lng},${p.lat}`).join('|');
  const path = `stroke:${stroke}|width:4|fill:none|${pathCoords}`;
  const markers = STATION_GEO.map((s) => `${s.lng},${s.lat}`).join('|');
  const dims = `${Math.round(width)}x${Math.round(height)}@2x`;
  return (
    `https://api.maptiler.com/maps/outdoor-v2/static/${center}/${dims}.png` +
    `?path=${path}&markers=${markers}&key=${key}`
  );
}
