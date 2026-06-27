// Lazy map step for a located task (change: v2.1-builder-shell-redesign,
// performance guardrails). The heavy MapLibre engine + LocationPicker chunk are
// fetched ONLY when this step mounts — i.e. when a radius/exact task editor is
// open in the slide-in context panel. When the panel closes the panel unmounts,
// LocationPicker's effect cleanup runs map.remove(), and the WebGL context is
// fully destroyed — so the map never sits idle holding a GL context.
import { Suspense, lazy } from 'react';
import { Input, Label } from './ui';

const LocationPicker = lazy(() => import('./LocationPicker'));

function MapSkeleton() {
  return (
    <div className="h-44 rounded-lg border border-[--rp-border] bg-[--surface-2] animate-pulse flex items-center justify-center gap-2 text-xs text-[--ink-3]">
      <span>🗺</span> Loading map…
    </div>
  );
}

export default function LocationStep({ coordinates, onChange }: {
  coordinates: { lat: number; lng: number };
  onChange: (lat: number, lng: number) => void;
}) {
  return (
    <>
      <Suspense fallback={<MapSkeleton />}>
        <LocationPicker lat={coordinates.lat} lng={coordinates.lng} onChange={onChange} className="h-44" />
      </Suspense>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Lat</Label>
          <Input type="number" value={coordinates.lat || ''}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0, coordinates.lng)} />
        </div>
        <div>
          <Label>Lng</Label>
          <Input type="number" value={coordinates.lng || ''}
            onChange={(e) => onChange(coordinates.lat, parseFloat(e.target.value) || 0)} />
        </div>
      </div>
    </>
  );
}
