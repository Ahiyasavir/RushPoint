// Topo ⇄ Satellite switch overlaid on a map, so creators can place and review
// task locations against real imagery. Sits in the map's bottom-left corner
// (inside the frame) so it never collides with the search row above it.
import type { MapMode } from '@rushpoint/shared';
import { useT } from './LanguageContext';

export default function MapModeToggle({ mode, onChange }: {
  mode: MapMode;
  onChange: (m: MapMode) => void;
}) {
  const b = useT().builder;
  return (
    <div className="absolute bottom-2 start-2 z-10 flex bg-app-card/90 backdrop-blur rounded-lg p-0.5 border border-glass-border shadow-soft">
      {(['topo', 'satellite'] as MapMode[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`px-2.5 py-1 rounded-md text-[13px] font-medium transition ${
            mode === m ? 'bg-neon-green text-black' : 'text-zinc-500'
          }`}
        >
          {m === 'topo' ? b.mapTopo : b.mapSatellite}
        </button>
      ))}
    </div>
  );
}
