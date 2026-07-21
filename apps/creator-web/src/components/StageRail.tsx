// Left-rail stage navigator for the Builder shell (change:
// v2.1-builder-shell-redesign). Lists every stage with a mini PacingBar so the
// creator sees the whole game's shape at a glance, and selects which stage the
// centre canvas shows.
//
// Wave D (change: builder-dnd-groups) moves both of its drag jobs into the ONE
// DndContext that BuilderPage owns:
//   • the stage order is a SortableContext over stage ids;
//   • every entry is ALSO a droppable, so a task dragged out of the canvas can
//     be dropped on it. The rail is always visible whatever the canvas is
//     scrolled to, which is what makes a cross-stage move work in the windowed
//     branch, and being a real droppable makes it keyboard reachable too.
// A drag is disambiguated by `active.data.current.type` ('task' | 'stage'), so
// the old TASK_DND_MIME dataTransfer sniffing is gone.
import type { Stage } from '@rushpoint/shared';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import PacingBar from './PacingBar';
import { useT } from './LanguageContext';

/** Rail id namespace — a stage is both a sortable ITEM (its own id) and a task
 *  drop TARGET (this prefixed id), so the two never collide in one context. */
export const STAGE_DROP_PREFIX = 'stage-drop:';

function RailEntry({ stage, index, active, onSelect, taskDragging }: {
  stage: Stage; index: number; active: boolean; onSelect: () => void;
  /** True while a TASK (not a stage) is in flight — highlights the rail as a
   *  landing zone and suppresses the stage-reorder outline. */
  taskDragging: boolean;
}) {
  const b = useT().builder;
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({
    id: stage.id,
    data: { type: 'stage', stageId: stage.id },
  });
  const drop = useDroppable({
    id: `${STAGE_DROP_PREFIX}${stage.id}`,
    data: { type: 'stage-drop', stageId: stage.id },
  });
  const taskOver = taskDragging && drop.isOver;
  return (
    <div
      ref={(el) => { setNodeRef(el); drop.setNodeRef(el); }}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onClick={onSelect}
      className={`cursor-pointer rounded-xl border p-2.5 transition-colors ${
        active ? 'border-rp-fire bg-rp-fire/10' : 'border-[--rp-border] hover:bg-[--surface-2]'
      } ${isDragging ? 'opacity-40' : ''} ${taskOver ? 'outline-dashed outline-2 outline-rp-fire' : ''}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span
          {...attributes}
          {...listeners}
          // Registers the ⠿ as the ACTIVATOR (see TaskCanvas) so the keyboard
          // sensor measures from the stage card, not from the handle glyph.
          ref={setActivatorNodeRef}
          title={b.dragStageHandle}
          aria-label={b.dragStageHandle}
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab active:cursor-grabbing select-none text-[--ink-3] touch-none rounded
            focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
        >⠿</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[--ink-3]">{b.stageLabel(index + 1)}{stage.isFinal ? ` · ${b.finalTag}` : ''}</span>
      </div>
      <div className="text-sm font-medium text-[--ink-1] truncate" dir="auto">{stage.title || b.untitledStage}</div>
      <div className="mt-1.5"><PacingBar tasks={stage.tasks} /></div>
      <div className="text-[10px] text-[--ink-3] mt-1">{b.taskCount(stage.tasks.length)}</div>
    </div>
  );
}

export default function StageRail({ stages, activeStageId, onSelect, onAdd, taskDragging = false }: {
  stages: Stage[];
  activeStageId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  /** True while a task drag is in flight (BuilderPage owns the DndContext state). */
  taskDragging?: boolean;
}) {
  const b = useT().builder;
  return (
    <aside className="w-52 shrink-0 space-y-2 h-full overflow-y-auto pe-0.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[--ink-3]">{b.stagesHeader}</span>
        <span className="text-[10px] text-[--ink-4]">{stages.length}</span>
      </div>
      <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        {stages.map((s, idx) => (
          <RailEntry
            key={s.id}
            stage={s}
            index={idx}
            active={s.id === activeStageId}
            onSelect={() => onSelect(s.id)}
            taskDragging={taskDragging}
          />
        ))}
      </SortableContext>
      <button
        onClick={onAdd}
        className="w-full rounded-xl border border-dashed border-[--rp-border] text-[--ink-3] text-sm py-2 hover:border-rp-fire/60 hover:text-rp-fire transition-colors"
      >
        ＋ {b.addStage}
      </button>
    </aside>
  );
}
