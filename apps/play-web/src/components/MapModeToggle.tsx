// Topo ⇄ Satellite switch overlaid on a map. Lets participants see the exact
// ground layout when they need to pinpoint a location.
import type { MapMode } from '@rushpoint/shared';
import { useT } from '../i18nContext';

export default function MapModeToggle({ mode, onChange }: {
  mode: MapMode;
  onChange: (m: MapMode) => void;
}) {
  const { t } = useT();
  const label = (m: MapMode) => (m === 'topo' ? t.play.mapView : t.play.satelliteView);
  return (
    <div className="absolute top-2 left-2 z-10 flex bg-app-card/90 backdrop-blur rounded-lg p-0.5 shadow-soft border border-glass-border">
      {(['topo', 'satellite'] as MapMode[]).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          role="switch"
          aria-checked={mode === m}
          aria-label={label(m)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
            mode === m ? 'bg-accent text-white' : 'text-zinc-500'
          }`}
        >
          {label(m)}
        </button>
      ))}
    </div>
  );
}
