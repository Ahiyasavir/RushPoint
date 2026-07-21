// Virtualized centre canvas for the Builder shell (change:
// v2.1-builder-shell-redesign). Renders the active stage's tasks as scannable
// TaskCards, windowed via @tanstack/react-virtual so a 100+ task stage stays at
// 60 FPS (only the visible rows mount). Falls back to a simple list for tiny
// stages where virtualization overhead isn't worth it.
//
// Wave A task 7 adds native HTML5 drag & drop:
//   • within the stage — drag a card onto another card to reorder;
//   • across stages   — the drag payload is published on TASK_DND_MIME so the
//     StageRail entries can accept it (see StageRail.onTaskDrop);
//   • a touch/keyboard fallback lives on the card itself (TaskCard.moveTargets).
// The windowed branch gets edge auto-scroll so a long stage stays reachable
// mid-drag without releasing the pointer.
import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Task } from '@rushpoint/shared';
import TaskCard, { type MoveTarget } from './TaskCard';
import { TASK_DND_MIME } from '../lib/reorder';

const ROW = 64; // estimated card height + gap (measured precisely at runtime)
const EDGE = 48; // px from the top/bottom edge that triggers auto-scroll
const STEP = 16; // px nudged per dragover event while in the edge zone

export default function TaskCanvas({
  tasks, activeTaskId, onSelect, stageId, onReorder, moveTargets, onMoveToStage,
}: {
  tasks: Task[];
  activeTaskId?: string;
  onSelect: (taskId: string) => void;
  /** Owning stage id — travels in the drag payload so a cross-stage drop knows
   *  where the task came from. */
  stageId: string;
  /** Reorder within this stage: move the task at `from` to index `to`. */
  onReorder: (from: number, to: number) => void;
  /** Other stages, offered as the non-drag "move to stage" fallback. */
  moveTargets?: MoveTarget[];
  onMoveToStage?: (taskId: string, toStageId: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const rv = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW,
    overscan: 6,
  });

  // Drag props shared by the grid and the windowed branch. `idx` is always the
  // TRUE array index (in the windowed branch that is `vi.index`, not a
  // window-relative offset) so a drop can never be off by a window.
  function dragProps(idx: number) {
    return {
      draggable: true,
      onDragStart: (e: DragEvent<HTMLDivElement>) => {
        setDragIdx(idx);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(TASK_DND_MIME, JSON.stringify({ stageId, taskId: tasks[idx].id }));
        // Firefox refuses to start a drag without a text/plain payload.
        e.dataTransfer.setData('text/plain', tasks[idx].id);
      },
      onDragEnd: () => setDragIdx(null),
      onDragOver: (e: DragEvent<HTMLDivElement>) => {
        if (dragIdx === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      },
      onDrop: (e: DragEvent<HTMLDivElement>) => {
        if (dragIdx === null) return;
        e.preventDefault();
        e.stopPropagation();
        if (dragIdx !== idx) onReorder(dragIdx, idx);
        setDragIdx(null);
      },
      className: dragIdx !== null && dragIdx !== idx
        ? 'rounded-xl outline-dashed outline-1 outline-rp-fire/40'
        : '',
    };
  }

  // Keep a long (windowed) stage reachable mid-drag: nudge the scroll container
  // while the pointer hovers its top/bottom edge. react-virtual reads scroll
  // offset from this same element, so newly revealed rows mount as drop targets.
  function onContainerDragOver(e: DragEvent<HTMLDivElement>) {
    if (dragIdx === null) return;
    const el = parentRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (e.clientY < r.top + EDGE) el.scrollTop -= STEP;
    else if (e.clientY > r.bottom - EDGE) el.scrollTop += STEP;
  }

  const card = (t: Task) => (
    <TaskCard
      task={t}
      active={t.id === activeTaskId}
      dragging={dragIdx !== null && tasks[dragIdx]?.id === t.id}
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
  return (
    <div ref={parentRef} onDragOver={onContainerDragOver} className="h-full overflow-y-auto -mx-1 px-1">
      {small ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 content-start">
          {tasks.map((t, i) => (
            <div key={t.id} {...dragProps(i)}>{card(t)}</div>
          ))}
        </div>
      ) : (
        <div style={{ height: rv.getTotalSize(), position: 'relative', width: '100%' }}>
          {rv.getVirtualItems().map((vi) => {
            const t = tasks[vi.index];
            const dp = dragProps(vi.index);
            return (
              <div
                key={t.id}
                ref={rv.measureElement}
                data-index={vi.index}
                {...dp}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)`, paddingBottom: 8 }}
              >
                {card(t)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
