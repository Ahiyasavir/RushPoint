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
import { closestCenter, useDroppable } from '@dnd-kit/core';
import type { CollisionDetection } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import PacingBar from './PacingBar';
import { useT } from './LanguageContext';

/** Rail id namespace — a stage is both a sortable ITEM (its own id) and a task
 *  drop TARGET (this prefixed id), so the two never collide in one context. */
export const STAGE_DROP_PREFIX = 'stage-drop:';

// ── R1: type-aware collision resolution ─────────────────────────────────────
// A rail entry registers TWO droppables on the SAME DOM node — the stage
// SORTABLE ('stage', bare id) and, layered on top, the task DROP target
// ('stage-drop', prefixed id). They share one rect / one centre, so plain
// `closestCenter` sees a zero-distance TIE and breaks it by droppable
// registration order. That silently no-ops one of the two gestures: a task
// dropped on a rail entry resolves to the bare stage id (so the
// `stage-drop:` branch in onDragEnd is skipped and the move is lost), OR a
// stage reorder resolves to the prefixed id (so `findIndex` returns -1 and the
// reorder is lost). Only one gesture can "win" per registration order.
//
// The fix makes collision resolution depend on WHAT is being dragged: filter
// the candidate droppables to the ones the active drag may legally land on,
// then delegate to closestCenter. `isValidDropTarget` is the pure, unit-tested
// core (scripts/test-builder-dnd.ts).
export type BuilderDragType = 'task' | 'stage';
export type BuilderDropType = 'task' | 'stage' | 'stage-drop';

/** Whether a drag of `activeType` may resolve onto a droppable of
 *  `candidateType`. Pure — the whole R1 fix hinges on this table. */
export function isValidDropTarget(
  activeType: BuilderDragType,
  candidateType: BuilderDropType | undefined,
): boolean {
  // A STAGE reorders only among the bare stage sortables. The co-located
  // 'stage-drop' target (and any task) is off-limits, so a reorder can never
  // resolve to a prefixed id and no-op.
  if (activeType === 'stage') return candidateType === 'stage';
  // A TASK lands on another task (reorder / cross-stage insert) or on a rail
  // entry's 'stage-drop' target (append to that stage) — never on the bare
  // stage sortable, which would make the primary cross-stage move no-op.
  return candidateType === 'task' || candidateType === 'stage-drop';
}

/** DndContext `collisionDetection`: keep only the droppables the active drag may
 *  legally hit, then run closestCenter over that subset. Removes the spatial tie
 *  between the two co-located rail droppables. */
export const railAwareCollisionDetection: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type as BuilderDragType | undefined;
  if (activeType !== 'task' && activeType !== 'stage') return closestCenter(args);
  const droppableContainers = args.droppableContainers.filter((c) =>
    isValidDropTarget(activeType, c.data.current?.type as BuilderDropType | undefined));
  return closestCenter({ ...args, droppableContainers });
};

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
      className={`cursor-pointer rounded-xl border p-2.5 transition-colors w-40 shrink-0 sm:w-auto sm:shrink ${
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
    // Phone: a full-width, horizontally-scrolling strip that sits above the
    // canvas. Desktop (≥sm): the classic vertical side rail.
    <aside className="w-full sm:w-52 shrink-0 sm:h-full sm:space-y-2 sm:overflow-y-auto pe-0.5">
      <div className="flex items-center justify-between px-1 mb-1 sm:mb-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[--ink-3]">{b.stagesHeader}</span>
        <span className="text-[10px] text-[--ink-4]">{stages.length}</span>
      </div>
      <div className="flex sm:flex-col items-stretch gap-2 overflow-x-auto sm:overflow-visible pb-1 sm:pb-0">
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
          className="shrink-0 w-32 sm:w-full rounded-xl border border-dashed border-[--rp-border] text-[--ink-3] text-sm px-3 py-2 whitespace-nowrap hover:border-rp-fire/60 hover:text-rp-fire transition-colors"
        >
          ＋ {b.addStage}
        </button>
      </div>
    </aside>
  );
}
