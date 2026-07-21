// Left-rail stage navigator for the Builder shell (change:
// v2.1-builder-shell-redesign). Lists every stage with a mini PacingBar so the
// creator sees the whole game's shape at a glance, selects which stage the centre
// canvas shows, and reorders stages by native HTML5 drag-and-drop.
import { useState } from 'react';
import type { DragEvent } from 'react';
import type { Stage } from '@rushpoint/shared';
import PacingBar from './PacingBar';
import { useT } from './LanguageContext';
import { TASK_DND_MIME } from '../lib/reorder';

/** True when the in-flight drag is a Builder TASK (not a stage reorder). */
function isTaskDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(TASK_DND_MIME);
}

export default function StageRail({ stages, activeStageId, onSelect, onMove, onAdd, onTaskDrop }: {
  stages: Stage[];
  activeStageId: string | null;
  onSelect: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onAdd: () => void;
  /** A task dragged out of the canvas was dropped on this stage (wave-a task 7).
   *  Each rail entry doubles as a cross-stage drop target — it is always visible,
   *  so the move never depends on scrolling a windowed canvas mid-drag. */
  onTaskDrop?: (payload: { fromStageId: string; taskId: string }, toStageId: string) => void;
}) {
  const b = useT().builder;
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [taskOverId, setTaskOverId] = useState<string | null>(null);

  function handleTaskDrop(e: DragEvent, toStageId: string) {
    setTaskOverId(null);
    let parsed: { stageId?: string; taskId?: string };
    try {
      parsed = JSON.parse(e.dataTransfer.getData(TASK_DND_MIME) || '{}');
    } catch {
      return;
    }
    if (!parsed.stageId || !parsed.taskId) return;
    onTaskDrop?.({ fromStageId: parsed.stageId, taskId: parsed.taskId }, toStageId);
  }

  return (
    <aside className="w-52 shrink-0 space-y-2 h-full overflow-y-auto pe-0.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[--ink-3]">{b.stagesHeader}</span>
        <span className="text-[10px] text-[--ink-4]">{stages.length}</span>
      </div>
      {stages.map((s, idx) => {
        const active = s.id === activeStageId;
        return (
          <div
            key={s.id}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragEnd={() => setDragIdx(null)}
            onDragOver={(e) => {
              if (onTaskDrop && isTaskDrag(e)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setTaskOverId(s.id);
                return;
              }
              if (dragIdx !== null) e.preventDefault();
            }}
            onDragLeave={() => setTaskOverId((cur) => (cur === s.id ? null : cur))}
            onDrop={(e) => {
              if (onTaskDrop && isTaskDrag(e)) { e.preventDefault(); handleTaskDrop(e, s.id); return; }
              if (dragIdx !== null) onMove(dragIdx, idx);
              setDragIdx(null);
            }}
            onClick={() => onSelect(s.id)}
            className={`cursor-pointer rounded-xl border p-2.5 transition-colors ${
              active ? 'border-rp-fire bg-rp-fire/10' : 'border-[--rp-border] hover:bg-[--surface-2]'
            } ${dragIdx !== null && dragIdx !== idx ? 'outline-dashed outline-1 outline-rp-fire/40' : ''
            } ${taskOverId === s.id ? 'outline-dashed outline-2 outline-rp-fire' : ''}`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className="cursor-grab active:cursor-grabbing select-none text-[--ink-3]">⠿</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[--ink-3]">{b.stageLabel(idx + 1)}{s.isFinal ? ` · ${b.finalTag}` : ''}</span>
            </div>
            <div className="text-sm font-medium text-[--ink-1] truncate" dir="auto">{s.title || b.untitledStage}</div>
            <div className="mt-1.5"><PacingBar tasks={s.tasks} /></div>
            <div className="text-[10px] text-[--ink-3] mt-1">{b.taskCount(s.tasks.length)}</div>
          </div>
        );
      })}
      <button
        onClick={onAdd}
        className="w-full rounded-xl border border-dashed border-[--rp-border] text-[--ink-3] text-sm py-2 hover:border-rp-fire/60 hover:text-rp-fire transition-colors"
      >
        ＋ {b.addStage}
      </button>
    </aside>
  );
}
