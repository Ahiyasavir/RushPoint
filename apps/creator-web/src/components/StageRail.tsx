// Left-rail stage navigator for the Builder shell (change:
// v2.1-builder-shell-redesign). Lists every stage with a mini PacingBar so the
// creator sees the whole game's shape at a glance, selects which stage the centre
// canvas shows, and reorders stages by native HTML5 drag-and-drop.
import { useState } from 'react';
import type { Stage } from '@rushpoint/shared';
import PacingBar from './PacingBar';

export default function StageRail({ stages, activeStageId, onSelect, onMove, onAdd }: {
  stages: Stage[];
  activeStageId: string | null;
  onSelect: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onAdd: () => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  return (
    <aside className="w-56 shrink-0 space-y-2">
      {stages.map((s, idx) => {
        const active = s.id === activeStageId;
        return (
          <div
            key={s.id}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragEnd={() => setDragIdx(null)}
            onDragOver={(e) => { if (dragIdx !== null) e.preventDefault(); }}
            onDrop={() => { if (dragIdx !== null) onMove(dragIdx, idx); setDragIdx(null); }}
            onClick={() => onSelect(s.id)}
            className={`cursor-pointer rounded-xl border p-2.5 transition-colors ${
              active ? 'border-rp-fire bg-rp-fire/10' : 'border-[--rp-border] hover:bg-[--surface-2]'
            } ${dragIdx !== null && dragIdx !== idx ? 'outline-dashed outline-1 outline-rp-fire/40' : ''}`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className="cursor-grab active:cursor-grabbing select-none text-[--ink-3]">⠿</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[--ink-3]">Stage {idx + 1}{s.isFinal ? ' · final' : ''}</span>
            </div>
            <div className="text-sm font-medium text-[--ink-1] truncate">{s.title || 'Untitled stage'}</div>
            <div className="mt-1.5"><PacingBar tasks={s.tasks} /></div>
            <div className="text-[10px] text-[--ink-3] mt-1">{s.tasks.length} task{s.tasks.length === 1 ? '' : 's'}</div>
          </div>
        );
      })}
      <button
        onClick={onAdd}
        className="w-full rounded-xl border border-dashed border-[--rp-border] text-[--ink-3] text-sm py-2 hover:border-rp-fire/60 hover:text-rp-fire transition-colors"
      >
        ＋ Add stage
      </button>
    </aside>
  );
}
