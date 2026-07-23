// Lazy map step for a located task (change: v2.1-builder-shell-redesign,
// performance guardrails). The heavy MapLibre engine + LocationPicker chunk are
// fetched ONLY when this step mounts — i.e. when a radius/exact task editor is
// open in the slide-in context panel. When the panel closes the panel unmounts,
// LocationPicker's effect cleanup runs map.remove(), and the WebGL context is
// fully destroyed — so the map never sits idle holding a GL context.
//
// `fill` makes the map grow to fill the available height (the wizard's step 1 is a
// flex column), so it is as large as the panel allows and never forces a scroll.
import { Suspense } from 'react';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { Input, Label } from './ui';
import { useT } from './LanguageContext';

const LocationPicker = lazyWithRetry('locationPicker', () => import('./LocationPicker'));

function MapSkeleton({ label, className }: { label: string; className: string }) {
  return (
    <div className={`${className} rounded-lg border border-[--rp-border] bg-[--surface-2] animate-pulse flex items-center justify-center gap-2 text-xs text-[--ink-3]`}>
      <span>🗺</span> {label}
    </div>
  );
}

export default function LocationStep({ coordinates, onChange, mapClassName = 'h-44', fill = false }: {
  coordinates: { lat: number; lng: number };
  onChange: (lat: number, lng: number) => void;
  mapClassName?: string;
  fill?: boolean;
}) {
  const b = useT().builder;

  const latLngFields = (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label>{b.latLabel}</Label>
        <Input type="number" value={coordinates.lat || ''}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0, coordinates.lng)} />
      </div>
      <div>
        <Label>{b.lngLabel}</Label>
        <Input type="number" value={coordinates.lng || ''}
          onChange={(e) => onChange(coordinates.lat, parseFloat(e.target.value) || 0)} />
      </div>
    </div>
  );

  if (fill) {
    // Pure flexbox column (no height:100% hops) so the map container truly fills
    // instead of collapsing. Manual lat/lng collapse into a details so they don't
    // steal space from the map (most creators place the pin by search/click/drag).
    return (
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        <div className="flex-1 min-h-0 flex flex-col">
          <Suspense fallback={<MapSkeleton label={b.loadingMap} className="flex-1 min-h-0" />}>
            <LocationPicker lat={coordinates.lat} lng={coordinates.lng} onChange={onChange} fill />
          </Suspense>
        </div>
        <details className="shrink-0 text-xs">
          <summary className="cursor-pointer select-none text-[--ink-3]">{b.latLabel} / {b.lngLabel}</summary>
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
