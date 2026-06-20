// Topo ⇄ Satellite switch overlaid on a map, so creators can place and review
// task locations against real imagery.
import type { MapMode } from '@rushpoint/shared';

export default function MapModeToggle({ mode, onChange }: {
  mode: MapMode;
  onChange: (m: MapMode) => void;
}) {
  return (
    <div className="absolute top-2 left-2 z-10 flex bg-app-card/90 backdrop-blur rounded-lg p-0.5 border border-glass-border shadow-soft">
      {(['topo', 'satellite'] as MapMode[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize transition ${
            mode === m ? 'bg-neon-green text-black' : 'text-zinc-500'
          }`}
        >
          {m === 'topo' ? 'Map' : 'Satellite'}
        </button>
      ))}
    </div>
  );
}
