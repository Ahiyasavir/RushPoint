// Map-based location picker for the Builder (§13ב — "מיקום על מפה").
// Search a place by name/address, OR click anywhere to place the task; drag the
// marker to fine-tune. Numeric lat/lng stay available alongside for precision.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import maplibregl from 'maplibre-gl';
import { ensureRtlTextPlugin } from '../lib/mapRtl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { resolveMapStyle, type MapMode, DEFAULT_MAP_MODE } from '@rushpoint/shared';
import { resolveInitialView, isPlacedCoord, type LatLng } from '../lib/mapAnchor';
import { geocodePlaces, type GeoResult } from '../lib/geocode';
import MapModeToggle from './MapModeToggle';
import { Input } from './ui';
import { useT } from './LanguageContext';

// Hebrew labels must not render backwards on the satellite style. See lib/mapRtl.
ensureRtlTextPlugin(maplibregl);

// Optional MapTiler key. When absent we run fully free + keyless: OpenTopoMap
// tiles (via resolveMapStyle) + the OpenStreetMap Nominatim geocoder. That is the
// supported default for self-run games, so we don't nag about a missing key.
const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

// Search itself lives in lib/geocode.ts — including WHY the geocoder is chosen
// independently of the tile key (MapTiler's Hebrew address coverage lost a real
// Jerusalem street to four wrong towns).

export default function LocationPicker({
  lat, lng, onChange, className = '', fill = false, cornerControl, anchors,
  cooperativeGestures = false,
}: {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  className?: string;
  fill?: boolean;
  /**
   * Where the SURROUNDING game is already placed (change: location-picker-game-anchor)
   * — every mission of it that carries real coordinates. Used only to choose the
   * view this map OPENS on when the edited mission has no pin of its own, so a
   * creator adding their second mission lands on the first one's neighbourhood
   * instead of on a zoom-8 view of the whole country. Never a constraint on where
   * a pin may be dropped, and read once at construction: see lib/mapAnchor.
   */
  anchors?: readonly (LatLng | null | undefined)[];
  /**
   * Rendered at the map's bottom-END corner, in the SAME coordinate space as
   * MapModeToggle (change: builder-ux-round-2). A caller cannot position this
   * itself: this component puts a place-SEARCH row above the tiles, and the
   * caller's own wrapper also holds the coordinates field below them — so anything
   * the caller anchors lands on the search button or on the coordinates input, both
   * of which happened. Only in here does "the corner of the map" mean the map.
   */
  cornerControl?: ReactNode;
  /**
   * Let a plain wheel scroll pass THROUGH to the page (change:
   * quick-setup-one-card).
   *
   * A map inside a scrolling panel eats the wheel: the creator scrolls to bring
   * the rest of the map into view, the pointer is over the map, and the map zooms
   * instead — so the panel never moves and the map ends up at a zoom nobody asked
   * for. Their words: scrolling to see the whole map is "super uncomfortable".
   * MapLibre's own answer is `cooperativeGestures`: wheel zooms only with
   * ctrl/⌘ held, touch pans only with two fingers, and it draws its own hint when
   * a gesture is refused.
   *
   * OFF by default, and deliberately off for the enlarged map: there the map IS
   * the page, nothing is behind it to scroll, and making a full-screen map demand
   * a modifier key to zoom would be the same mistake in the other direction.
   */
  cooperativeGestures?: boolean;
}) {
  const b = useT().builder;
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const [mode, setMode] = useState<MapMode>(DEFAULT_MAP_MODE);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Place-search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  useEffect(() => { setActiveIndex(-1); }, [results]);

  const hasCoord = isPlacedCoord({ lat, lng });
  // The anchors as of MOUNT. Deliberately not reactive: the Builder autosaves ~1.5s
  // after every edit, so this array changes while the creator is aiming, and a
  // camera that re-fitted itself mid-aim would be worse than the bug being fixed.
  const anchorsAtMount = useRef(anchors);

  useEffect(() => {
    if (!ref.current || map.current) return;
    // Decided ONCE, here, and handed to the constructor rather than applied as a
    // post-load fitBounds — which would paint the default view for a frame and
    // then jump. The container is laid out by now, so its shorter side is the
    // honest viewport for the "~100m" promise (lib/mapAnchor.neighbourhoodZoom);
    // an unmeasurable container falls back inside that helper.
    const box = ref.current.getBoundingClientRect();
    const view = resolveInitialView({
      self: hasCoord ? { lat, lng } : null,
      anchors: anchorsAtMount.current,
      viewportPx: Math.min(box.width, box.height),
    });
    map.current = new maplibregl.Map({
      container: ref.current,
      style: resolveMapStyle(KEY) as maplibregl.StyleSpecification | string,
      ...(view.kind === 'point'
        ? { center: view.center, zoom: view.zoom }
        : {
            bounds: view.bounds as maplibregl.LngLatBoundsLike,
            fitBoundsOptions: { maxZoom: view.maxZoom, padding: view.padding },
          }),
      attributionControl: { compact: true },
      cooperativeGestures,
    });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    const place = (lngLat: maplibregl.LngLat) => {
      setMarker(lngLat.lat, lngLat.lng);
      onChangeRef.current(round(lngLat.lat), round(lngLat.lng));
    };
    map.current.on('click', (e) => place(e.lngLat));

    if (hasCoord) setMarker(lat, lng);

    // In fill mode the container is sized by flexbox; keep the GL canvas in sync
    // with the container (panel width animation, viewport changes) via ResizeObserver.
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && ref.current) {
      ro = new ResizeObserver(() => map.current?.resize());
      ro.observe(ref.current);
    }
    return () => { ro?.disconnect(); map.current?.remove(); map.current = null; marker.current = null; };
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
      // Bias to what the creator is looking at: the pin if the task has one, else
      // wherever the map is centred. "הכותל המערבי" returns three Be'er Sheva
      // streets before the actual Kotel without it. Since the anchored view centres
      // an unplaced mission on the rest of the game, this bias now inherits the
      // game's neighbourhood too, instead of biasing to the middle of the country.
      const c = map.current?.getCenter();
      const bias = hasCoord ? { lat, lng } : c ? { lat: c.lat, lng: c.lng } : undefined;
      const r = await geocodePlaces(query, { key: KEY, bias });
      if (r.length === 0) setSearchErr(b.searchNoResults);
      setResults(r);
    } catch {
      setSearchErr(b.searchFailed);
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
    <div className={fill ? 'relative flex-1 min-h-0 flex flex-col' : 'relative'}>
      {/* Place search */}
      <div className={`relative mb-2 ${fill ? 'shrink-0' : ''}`}>
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
            placeholder={b.searchPlaceholder}
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={searching || !query.trim()}
            className="px-4 rounded-lg bg-rp-fire text-white text-sm font-medium disabled:opacity-40 shrink-0"
          >
            {searching ? '…' : b.searchBtn}
          </button>
        </div>
        {searchErr && <p className="text-ink-alert text-xs mt-1">{searchErr}</p>}
        {/* Result rows use the app's --ink/--surface tokens, NOT `text-zinc-700`.
            creator-web REVERSES the zinc scale (tailwind.config.js) so that class
            resolves to #d6d3d1 — pale grey on the beige `app-raised` panel, about
            1.2:1 contrast. The list was legible when this theme was dark, and after
            the light theme landed it read as a disabled control, which is most of
            why search felt unusable. Rows are also 44px-tall tap targets now. */}
        {results.length > 0 && (
          <ul role="listbox" className="absolute z-20 mt-1 w-full bg-[--surface-1] border border-[--rp-border] rounded-lg overflow-hidden shadow-lg max-h-64 overflow-y-auto">
            {results.map((r, i) => (
              <li key={`${r.lat},${r.lng},${i}`} role="option" aria-selected={i === activeIndex}>
                <button
                  type="button"
                  onClick={() => choose(r)}
                  onMouseEnter={() => setActiveIndex(i)}
                  dir="auto"
                  className={`w-full text-start px-3 py-2.5 min-h-[44px] border-b border-[--rp-border] last:border-b-0 transition-colors ${i === activeIndex ? 'bg-rp-fire/10' : 'hover:bg-[--surface-2]'}`}
                >
                  <span className="block text-sm text-[--ink-1] font-medium">📍 {r.label}</span>
                  {r.detail && <span className="block text-[13px] text-[--ink-3] mt-0.5">{r.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div ref={ref} className={fill
        ? 'flex-1 min-h-0 rounded-lg overflow-hidden border border-glass-border'
        : `rounded-lg overflow-hidden border border-glass-border ${className}`} />
      <MapModeToggle mode={mode} onChange={setMode} />
      {cornerControl && <div className="absolute bottom-2 end-2 z-10">{cornerControl}</div>}
      {!hasCoord && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center pointer-events-none pb-3">
          <span className="bg-app-bg/80 text-zinc-300 text-xs px-3 py-1.5 rounded-full">
            {b.mapHint}
          </span>
        </div>
      )}
    </div>
  );
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
