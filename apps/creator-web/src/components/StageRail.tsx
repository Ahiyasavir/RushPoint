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
import { useIsMobile } from '../hooks/useMediaQuery';

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

function RailEntry({ stage, index, active, onSelect, taskDragging, compact }: {
  stage: Stage; index: number; active: boolean; onSelect: () => void;
  /** True while a TASK (not a stage) is in flight — highlights the rail as a
   *  landing zone and suppresses the stage-reorder outline. */
  taskDragging: boolean;
  /** Phone width: one line per stage instead of a card (see StageRail). */
  compact?: boolean;
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

  // Shared by both shapes: identity, drag affordance, drop target, selection.
  const shellClass = `cursor-pointer rounded-xl border transition-colors shrink-0 ${
    active ? 'border-rp-fire bg-rp-fire/10' : 'border-[--rp-border] hover:bg-[--surface-2]'
  } ${isDragging ? 'opacity-40' : ''} ${taskOver ? 'outline-dashed outline-2 outline-rp-fire' : ''}`;

  // The handle is the sortable ACTIVATOR and must keep a real touch target at
  // both sizes; on the compact pill it grows into the row's own padding via the
  // negative margins rather than making the pill 44px+ tall.
  const handle = (
    <span
      {...attributes}
      {...listeners}
      ref={setActivatorNodeRef}
      title={b.dragStageHandle}
      aria-label={b.dragStageHandle}
      onClick={(e) => e.stopPropagation()}
      className={`cursor-grab active:cursor-grabbing select-none text-[--ink-3] touch-none rounded
        flex items-center justify-center w-11 h-11 focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60
        ${compact ? '-my-3 -ms-2 -me-1' : '-mx-1.5 -my-2.5'}`}
    >⠿</span>
  );

  // ── Phone: ONE line (change: builder-mobile-simplification) ───────────────
  // The card shape spends ~110px per stage on a pacing bar 40px wide and a task
  // count the pill can carry inline, and the strip then costs ~150px of an 844px
  // screen before the creator sees a single mission. Everything that identifies
  // the stage survives — number, finale tag, title, task count — and the pacing
  // bar, which is a shape-of-the-whole-game reading, stays on the desktop rail
  // where there is room to compare stages side by side.
  if (compact) {
    return (
      <div
        ref={(el) => { setNodeRef(el); drop.setNodeRef(el); }}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        onClick={onSelect}
        className={`${shellClass} max-w-[60vw] px-2.5 py-2 flex items-center gap-1.5`}
      >
        {handle}
        <span className="text-[12px] font-semibold text-[--ink-3] tabular-nums shrink-0">
          {b.stageLabel(index + 1)}{stage.isFinal ? ` · ${b.finalTag}` : ''}
        </span>
        <span className="text-sm font-medium text-[--ink-1] truncate" dir="auto">{stage.title || b.untitledStage}</span>
        <span className="text-[12px] text-[--ink-3] shrink-0 tabular-nums">{stage.tasks.length}</span>
      </div>
    );
  }

  return (
    <div
      ref={(el) => { setNodeRef(el); drop.setNodeRef(el); }}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onClick={onSelect}
      className={`${shellClass} p-2.5 w-40 sm:w-auto sm:shrink`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {/* Registers the ⠿ as the ACTIVATOR (see TaskCanvas) so the keyboard
            sensor measures from the stage card, not from the handle glyph.
            44px touch target; see the matching note in TaskCard. */}
        {handle}
        <span className="text-[12px] font-semibold uppercase tracking-wide text-[--ink-3]">{b.stageLabel(index + 1)}{stage.isFinal ? ` · ${b.finalTag}` : ''}</span>
      </div>
      <div className="text-sm font-medium text-[--ink-1] truncate" dir="auto">{stage.title || b.untitledStage}</div>
      <div className="mt-1.5"><PacingBar tasks={stage.tasks} /></div>
      <div className="text-[12px] text-[--ink-3] mt-1">{b.taskCount(stage.tasks.length)}</div>
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
  const compact = useIsMobile();
  return (
    // Phone: ONE horizontally-scrolling line of stage pills above the canvas.
    // Desktop (≥sm): the classic vertical side rail of cards.
    <aside data-tour="builder-stages" className="w-full sm:w-52 shrink-0 sm:h-full sm:space-y-2 sm:overflow-y-auto pe-0.5">
      {/* The "STAGES · 5" caption is desktop only (change:
          builder-mobile-simplification). A numbered strip of stages does not need
          a heading telling the creator it is a list of stages, and on a phone that
          line was ~20px of the budget the canvas needed. */}
      {!compact && (
        <div className="flex items-center justify-between px-1 mb-1 sm:mb-0">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-[--ink-3]">{b.stagesHeader}</span>
          <span className="text-[12px] text-[--ink-4]">{stages.length}</span>
        </div>
      )}
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
              compact={compact}
            />
          ))}
        </SortableContext>
        <button
          onClick={onAdd}
          aria-label={b.addStage}
          className={`shrink-0 rounded-xl border border-dashed border-[--rp-border] text-[--ink-3] whitespace-nowrap hover:border-rp-fire/60 hover:text-ink-fire transition-colors ${
            compact ? 'w-11 text-base' : 'w-32 sm:w-full text-sm px-3 py-2'}`}
        >
          {compact ? '＋' : <>＋ {b.addStage}</>}
        </button>
      </div>
    </aside>
  );
}
