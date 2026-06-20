// Topo ⇄ Satellite switch overlaid on a map. Lets participants see the exact
// ground layout when they need to pinpoint a location.
import type { MapMode } from '@rushpoint/shared';

export default function MapModeToggle({ mode, onChange }: {
  mode: MapMode;
  onChange: (m: MapMode) => void;
}) {
  return (
    <div className="absolute top-2 left-2 z-10 flex bg-app-card/90 backdrop-blur rounded-lg p-0.5 shadow-soft border border-glass-border">
      {(['topo', 'satellite'] as MapMode[]).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize transition ${
            mode === m ? 'bg-accent text-white' : 'text-zinc-500'
          }`}
        >
          {m === 'topo' ? 'Map' : 'Satellite'}
        </button>
      ))}
    </div>
  );
}
