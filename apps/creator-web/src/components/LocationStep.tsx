// Lazy map step for a located task (change: v2.1-builder-shell-redesign,
// performance guardrails). The heavy MapLibre engine + LocationPicker chunk are
// fetched ONLY when this step mounts — i.e. when a radius/exact task editor is
// open in the slide-in context panel. When the panel closes the panel unmounts,
// LocationPicker's effect cleanup runs map.remove(), and the WebGL context is
// fully destroyed — so the map never sits idle holding a GL context.
//
// `fill` makes the map grow to fill the available height (the wizard's step 1 is a
// flex column), so it is as large as the panel allows and never forces a scroll.
import { Suspense, useState, type ReactNode } from 'react';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { Input, Label } from './ui';
import { useT } from './LanguageContext';

/**
 * ONE field for the pair, not two boxes side by side (change: builder-ux-round-2).
 *
 * Latitude and longitude are never useful apart — a half-entered pair is not a
 * place — and every source a creator copies from (Google Maps, Waze, a WhatsApp
 * pin) hands them over as a single "31.7767, 35.2345" string. Two separate inputs
 * forced that string to be split by hand into two boxes, which is work the parser
 * can do. Any separator runs: comma, space, or both.
 *
 * A LOCAL text buffer while typing, and the props while not: without it, echoing
 * the parsed props back on every keystroke fights the caret the moment an
 * intermediate value ("31.", "31.7767,") is not yet a valid pair. It resyncs on
 * blur, so the field can never end up showing something the task does not hold.
 */
function CoordinatePairField({ coordinates, onChange, label, hint }: {
  coordinates: { lat: number; lng: number };
  onChange: (lat: number, lng: number) => void;
  label: string;
  hint: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const fromTask = coordinates.lat || coordinates.lng ? `${coordinates.lat}, ${coordinates.lng}` : '';

  return (
    <div>
      <Label>{label}</Label>
      <Input
        value={draft ?? fromTask}
        placeholder={hint}
        inputMode="decimal"
        dir="ltr"
        // A coordinate pair is ~22 characters; a full-width box just made the row
        // look like it needed the space, and left nothing beside it.
        className="max-w-[18rem]"
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const parts = raw.split(/[,\s]+/).filter((p) => p !== '').map(Number);
          // Committed only as a COMPLETE, finite pair. A partial or malformed entry
          // simply does not move the pin — it never writes a half coordinate, and
          // never a NaN, which would put the task on the {0,0} sentinel by accident.
          if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
            onChange(parts[0], parts[1]);
          }
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

const LocationPicker = lazyWithRetry('locationPicker', () => import('./LocationPicker'));

function MapSkeleton({ label, className }: { label: string; className: string }) {
  return (
    <div className={`${className} rounded-lg border border-[--rp-border] bg-[--surface-2] animate-pulse flex items-center justify-center gap-2 text-xs text-[--ink-3]`}>
      <span>🗺</span> {label}
    </div>
  );
}

export default function LocationStep({ coordinates, onChange, mapClassName = 'h-44', fill = false, cornerControl }: {
  coordinates: { lat: number; lng: number };
  onChange: (lat: number, lng: number) => void;
  mapClassName?: string;
  fill?: boolean;
  /** Passed straight through to the map's bottom-end corner. See LocationPicker. */
  cornerControl?: ReactNode;
}) {
  const b = useT().builder;

  const latLngFields = (
    <CoordinatePairField coordinates={coordinates} onChange={onChange}
      label={b.coordsLabel} hint={b.coordsHint} />
  );

  if (fill) {
    // Pure flexbox column (no height:100% hops) so the map container truly fills
    // instead of collapsing. Manual lat/lng collapse into a details so they don't
    // steal space from the map (most creators place the pin by search/click/drag).
    return (
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        <div className="flex-1 min-h-0 flex flex-col">
          <Suspense fallback={<MapSkeleton label={b.loadingMap} className="flex-1 min-h-0" />}>
            <LocationPicker lat={coordinates.lat} lng={coordinates.lng} onChange={onChange} fill
              cornerControl={cornerControl} />
          </Suspense>
        </div>
        <details className="shrink-0 text-xs">
          <summary className="cursor-pointer select-none text-[--ink-3]">{b.coordsLabel}</summary>
          <div className="mt-1.5">{latLngFields}</div>
        </details>
      </div>
    );
  }

  return (
    <>
      <Suspense fallback={<MapSkeleton label={b.loadingMap} className={mapClassName} />}>
        <LocationPicker lat={coordinates.lat} lng={coordinates.lng} onChange={onChange} className={mapClassName} />
      </Suspense>
      {latLngFields}
    </>
  );
}
