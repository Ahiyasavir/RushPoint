// Movement heatmap for the Run Console (change: movement-heatmap): renders the
// post-run foot-traffic density (getRunHeatmap cells) as a MapLibre heatmap layer.
// Read-only, one static style. Lazy-loaded so MapLibre stays out of the initial bundle.
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { resolveMapStyle, type HeatmapCell } from '@rushpoint/shared';

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

function toGeoJSON(cells: HeatmapCell[]) {
  return {
    type: 'FeatureCollection' as const,
    features: cells.map((c) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] },
      properties: { weight: c.weight },
    })),
  };
}

export default function HeatmapMap({ cells, className = '' }: { cells: HeatmapCell[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!ref.current || map.current) return;
    const m = new maplibregl.Map({
      container: ref.current,
      style: resolveMapStyle(KEY) as maplibregl.StyleSpecification | string,
      center: [35.21, 31.77],
      zoom: 6,
      attributionControl: { compact: true },
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      m.addSource('heat', { type: 'geojson', data: toGeoJSON(cells) });
      const maxWeight = Math.max(1, ...cells.map((c) => c.weight));
      m.addLayer({
        id: 'heat',
        type: 'heatmap',
        source: 'heat',
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0, maxWeight, 1],
          'heatmap-intensity': 1.2,
          'heatmap-radius': 24,
          'heatmap-opacity': 0.75,
        },
      });
      fit(m, cells);
    });
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-feed the source + refit whenever the cells change (after the initial load).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const src = m.getSource('heat') as maplibregl.GeoJSONSource | undefined;
    if (src) { src.setData(toGeoJSON(cells)); fit(m, cells); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cells)]);

  return <div ref={ref} className={`rounded-xl overflow-hidden border border-glass-border ${className}`} />;
}

function fit(m: maplibregl.Map, cells: HeatmapCell[]) {
  if (cells.length === 0) return;
  const pts = cells.map((c) => [c.lng, c.lat] as [number, number]);
  if (pts.length === 1) { m.easeTo({ center: pts[0], zoom: 14 }); return; }
  const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
  pts.forEach((p) => b.extend(p));
  m.fitBounds(b, { padding: 50, maxZoom: 16, duration: 400 });
}
