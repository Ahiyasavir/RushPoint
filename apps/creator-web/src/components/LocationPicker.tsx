// Map-based location picker for the Builder (§13ב — "מיקום על מפה").
// Search a place by name/address, OR click anywhere to place the task; drag the
// marker to fine-tune. Numeric lat/lng stay available alongside for precision.
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { resolveMapStyle, isValidCoord, type MapMode } from '@rushpoint/shared';
import MapModeToggle from './MapModeToggle';
import { Input } from './ui';

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;
if (!KEY && import.meta.env.PROD) {
  console.warn(
    '[LocationPicker] VITE_MAPTILER_KEY is not set. ' +
    'The public Nominatim geocoder is used as a fallback. ' +
    'This violates the Nominatim Usage Policy and must not be used in production. ' +
    'Set VITE_MAPTILER_KEY in apps/creator-web/.env',
  );
}
// Sensible default view when a task has no coordinates yet (central Israel).
const DEFAULT_CENTER: [number, number] = [35.21, 31.77];

interface GeoResult { label: string; lat: number; lng: number }

// Geocode a free-text place/address. Uses MapTiler when a key is configured,
// else falls back to keyless Nominatim (OSM) — mirroring the tile strategy.
// Biased to Israel since that's the launch market; still returns global hits.
async function geocode(query: string): Promise<GeoResult[]> {
  const q = query.trim();
  if (!q) return [];
  if (KEY) {
    const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json`
      + `?key=${KEY}&language=he&country=il&limit=5`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('geocode failed');
    const j = await r.json();
    return (j.features ?? [])
      .filter((f: { center?: number[] }) => Array.isArray(f.center) && f.center.length === 2)
      .map((f: { place_name?: string; text?: string; center: number[] }) => ({
        label: f.place_name ?? f.text ?? q, lng: f.center[0], lat: f.center[1],
      }));
  }
  // Keyless fallback: Nominatim (OpenStreetMap). CORS-enabled; IL-biased.
  const url = `https://nominatim.openstreetmap.org/search`
    + `?format=jsonv2&q=${encodeURIComponent(q)}&limit=5&accept-language=he&countrycodes=il`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('geocode failed');
  const j = (await r.json()) as { display_name: string; lat: string; lon: string }[];
  return j.map((it) => ({ label: it.display_name, lat: parseFloat(it.lat), lng: parseFloat(it.lon) }));
}

export default function LocationPicker({
  lat, lng, onChange, className = '',
}: {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const [mode, setMode] = useState<MapMode>('topo');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Place-search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  useEffect(() => { setActiveIndex(-1); }, [results]);

  const hasCoord = isValidCoord(lat, lng) && (lat !== 0 || lng !== 0);

  useEffect(() => {
    if (!ref.current || map.current) return;
    map.current = new maplibregl.Map({
      container: ref.current,
      style: resolveMapStyle(KEY) as maplibregl.StyleSpecification | string,
      center: hasCoord ? [lng, lat] : DEFAULT_CENTER,
      zoom: hasCoord ? 14 : 8,
      attributionControl: { compact: true },
    });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    const place = (lngLat: maplibregl.LngLat) => {
      setMarker(lngLat.lat, lngLat.lng);
      onChangeRef.current(round(lngLat.lat), round(lngLat.lng));
    };
    map.current.on('click', (e) => place(e.lngLat));

    if (hasCoord) setMarker(lat, lng);
    return () => { map.current?.remove(); map.current = null; marker.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch tile style on mode change (the draggable marker persists).
  useEffect(() => {
    map.current?.setStyle(resolveMapStyle(KEY, mode) as maplibregl.StyleSpecification | string);
  }, [mode]);

  // Reflect external numeric edits onto the marker/center.
  useEffect(() => {
    if (!map.current) return;
    if (hasCoord) {
      setMarker(lat, lng);
      map.current.easeTo({ center: [lng, lat], duration: 300 });
    } else {
      marker.current?.remove();
      marker.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  function setMarker(la: number, ln: number) {
    if (!map.current) return;
    if (!marker.current) {
      marker.current = new maplibregl.Marker({ color: '#22c55e', draggable: true });
      marker.current.on('dragend', () => {
        const p = marker.current!.getLngLat();
        onChangeRef.current(round(p.lat), round(p.lng));
      });
    }
    marker.current.setLngLat([ln, la]).addTo(map.current);
  }

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true); setSearchErr(''); setResults([]);
    try {
      const r = await geocode(query);
      if (r.length === 0) setSearchErr('לא נמצאו תוצאות. נסו ניסוח אחר.');
      setResults(r);
    } catch {
      setSearchErr('החיפוש נכשל. נסו שוב או הציבו ידנית על המפה.');
    } finally {
      setSearching(false);
    }
  }

  function choose(r: GeoResult) {
    setResults([]); setQuery(r.label);
    setMarker(r.lat, r.lng);
    onChangeRef.current(round(r.lat), round(r.lng));
    map.current?.flyTo({ center: [r.lng, r.lat], zoom: 15, duration: 600 });
  }

  return (
    <div className="relative">
      {/* Place search */}
      <div className="relative mb-2">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSearchErr(''); }}
            onKeyDown={(e) => {
              if (results.length && e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
              else if (results.length && e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); if (activeIndex >= 0 && results[activeIndex]) choose(results[activeIndex]); else void runSearch(); }
              else if (e.key === 'Escape') { setResults([]); setActiveIndex(-1); }
            }}
            dir="auto"
            placeholder="🔍 חפשו כתובת או מקום…"
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={searching || !query.trim()}
            className="px-4 rounded-lg bg-rp-fire text-white text-sm font-medium disabled:opacity-40 shrink-0"
          >
            {searching ? '…' : 'חיפוש'}
          </button>
        </div>
        {searchErr && <p className="text-rp-alert text-xs mt-1">{searchErr}</p>}
        {results.length > 0 && (
          <ul role="listbox" className="absolute z-20 mt-1 w-full bg-app-raised border border-glass-border rounded-lg overflow-hidden shadow-lg max-h-56 overflow-y-auto">
            {results.map((r, i) => (
              <li key={i} role="option" aria-selected={i === activeIndex}>
                <button
                  type="button"
                  onClick={() => choose(r)}
                  onMouseEnter={() => setActiveIndex(i)}
                  dir="auto"
                  className={`w-full text-start px-3 py-2 text-sm text-zinc-700 hover:bg-rp-fire/10 transition-colors ${i === activeIndex ? 'bg-rp-fire/10' : ''}`}
                >
                  📍 {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div ref={ref} className={`rounded-lg overflow-hidden border border-glass-border ${className}`} />
      {!KEY && import.meta.env.DEV && (
        <div className="absolute top-2 inset-x-2 z-10 bg-amber-100 border border-amber-400 text-amber-800 text-xs px-3 py-1.5 rounded-lg">
          ⚠️ No MapTiler key — using public geocoder. Not suitable for production.
        </div>
      )}
      <MapModeToggle mode={mode} onChange={setMode} />
      {!hasCoord && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center pointer-events-none pb-3">
          <span className="bg-app-bg/80 text-zinc-300 text-xs px-3 py-1.5 rounded-full">
            חפשו מקום למעלה, או לחצו על המפה לקיבוע
          </span>
        </div>
      )}
    </div>
  );
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
