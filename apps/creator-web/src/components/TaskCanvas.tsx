// Virtualized centre canvas for the Builder shell (change:
// v2.1-builder-shell-redesign). Renders the active stage's tasks as scannable
// TaskCards, windowed via @tanstack/react-virtual so a 100+ task stage stays at
// 60 FPS (only the visible rows mount). Falls back to a simple list for tiny
// stages where virtualization overhead isn't worth it.
//
// Wave D replaces the wave A native HTML5 drag & drop with dnd-kit
// (change: builder-dnd-groups). The DndContext itself lives in BuilderPage
// (one context spans the rail AND the canvas, so a task can be dragged onto
// another stage); this file only declares the sortable items:
//   • within the stage — drag a card over another card to reorder;
//   • across stages   — drop on a StageRail entry, which is a droppable in the
//     same context and is always visible regardless of canvas scroll;
//   • keyboard        — Tab to the ⠿ handle, Space to lift, arrows, Space to drop;
//   • a ⋯ menu on the card is the non-drag fallback (TaskCard.moveTargets).
// dnd-kit was chosen over @hello-pangea/dnd specifically because it never
// reparents or clones the real DOM node, which is what lets it coexist with
// @tanstack/react-virtual. Its built-in autoScroll replaces the hand-rolled
// edge-scroll the native implementation needed.
import { useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { SortableContext, useSortable, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '@rushpoint/shared';
import TaskCard, { type MoveTarget, type TaskGroupBadge } from './TaskCard';

const ROW = 64; // estimated card height + gap (measured precisely at runtime)

/** One sortable row. `useSortable` must be called from a component, and the
 *  listeners go on the ⠿ handle only so a tap on the body still opens the panel. */
function SortableTask({ task, stageId, style: outerStyle, measureRef, index, children }: {
  task: Task;
  stageId: string;
  /** Positioning from the virtualizer. It uses `top` (never `transform`) so the
   *  transform slot stays free for dnd-kit's drag translation. */
  style?: CSSProperties;
  measureRef?: (el: HTMLElement | null) => void;
  index?: number;
  children: (args: { handleProps: Record<string, unknown>; dragging: boolean }) => ReactNode;
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({
    id: task.id,
    data: { type: 'task', stageId, taskId: task.id },
  });
  return (
    <div
      ref={(el) => { setNodeRef(el); measureRef?.(el); }}
      data-index={index}
      style={{ ...outerStyle, transform: CSS.Translate.toString(transform), transition }}
    >
      {/* `ref: setActivatorNodeRef` is load-bearing, not decoration: without it
          dnd-kit treats the whole card as the activator and the KeyboardSensor
          starts its coordinates from the tiny ⠿ rect, so the first ArrowDown
          undershoots the next row and appears to do nothing. */}
      {children({ handleProps: { ...attributes, ...listeners, ref: setActivatorNodeRef }, dragging: isDragging })}
    </div>
  );
}

export default function TaskCanvas({
  tasks, activeTaskId, onSelect, stageId, moveTargets, onMoveToStage, groupOf,
}: {
  tasks: Task[];
  activeTaskId?: string;
  onSelect: (taskId: string) => void;
  /** Owning stage id — travels in the drag payload so a cross-stage drop knows
   *  where the task came from. */
  stageId: string;
  /** Other stages, offered as the non-drag "move to stage" fallback. */
  moveTargets?: MoveTarget[];
  onMoveToStage?: (taskId: string, toStageId: string) => void;
  /** Exclusive-group membership per task, precomputed by BuilderPage from the
   *  shared `effectiveExclusiveGroups`, so the badge shows exactly what the
   *  server enforces (including "a 1-member group does nothing"). */
  groupOf?: (taskId: string) => TaskGroupBadge | undefined;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rv = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW,
    overscan: 6,
  });

  const card = (t: Task, dragging: boolean, handleProps: Record<string, unknown>) => (
    <TaskCard
      task={t}
      active={t.id === activeTaskId}
      dragging={dragging}
      group={groupOf?.(t.id)}
      handleProps={handleProps}
      moveTargets={moveTargets}
      onMoveToStage={onMoveToStage ? (toStageId) => onMoveToStage(t.id, toStageId) : undefined}
      onClick={() => onSelect(t.id)}
    />
  );

  // The canvas fills its parent's height and is the ONLY scroll container in the
  // Builder centre column (the parent no longer scrolls — no nested double
  // scrollbar). Small stages (≤24 tasks): a roomy 2-column grid, no windowing.
  // Large stages: the same scroll box, windowed via react-virtual.
  const small = tasks.length <= 24;
  // SortableContext always gets the FULL id list, never the windowed slice: it
  // only needs the ordering, and `useSortable` registers just the mounted rows.
  const itemIds = tasks.map((t) => t.id);
  return (
    <div ref={parentRef} className="h-full overflow-y-auto -mx-1 px-1">
      <SortableContext items={itemIds} strategy={small ? rectSortingStrategy : verticalListSortingStrategy}>
        {small ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 content-start">
            {tasks.map((t) => (
              <SortableTask key={t.id} task={t} stageId={stageId}>
                {({ handleProps, dragging }) => card(t, dragging, handleProps)}
              </SortableTask>
            ))}
          </div>
        ) : (
          <div style={{ height: rv.getTotalSize(), position: 'relative', width: '100%' }}>
            {rv.getVirtualItems().map((vi) => {
              const t = tasks[vi.index];
              return (
                <SortableTask
                  key={t.id}
                  task={t}
                  stageId={stageId}
                  index={vi.index}
                  measureRef={rv.measureElement}
                  style={{ position: 'absolute', top: vi.start, left: 0, width: '100%', paddingBottom: 8 }}
                >
                  {({ handleProps, dragging }) => card(t, dragging, handleProps)}
                </SortableTask>
              );
            })}
          </div>
        )}
      </SortableContext>
    </div>
  );
}
