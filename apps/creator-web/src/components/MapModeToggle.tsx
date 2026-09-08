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
        // `aria-pressed` is the state, not the colour: a two-button segmented
        // control that says which half is selected only by a fill announces
        // nothing to a screen reader and conveys the selection by colour alone.
        // The 36px height is TAP_CLUSTER's rule (these two are adjacent), up from
        // a ~28px row that sat over a draggable map.
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          className={`px-3 min-h-9 inline-flex items-center justify-center rounded-md text-[13px] font-medium transition ${
            mode === m ? 'bg-neon-green text-black' : 'text-[--ink-2] hover:text-[--ink-1]'
          }`}
        >
          {m === 'topo' ? b.mapTopo : b.mapSatellite}
        </button>
      ))}
    </div>
  );
}
