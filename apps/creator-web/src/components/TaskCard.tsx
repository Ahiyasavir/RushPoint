// Scannable full-width task card for the v2.1 Builder canvas (change:
// v2.1-builder-shell-redesign). Replaces the cramped 132×96 TaskTile chip: a
// creator can read a whole stage's structure (type, difficulty, time, points,
// location mode, and a computed 1-line interaction preview) without opening a
// panel. Pure presentation — all logic comes from lib/taskCardPreview.
import type { HTMLAttributes } from 'react';
import type { Task, TaskType } from '@rushpoint/shared';
import { normalizeTriggerMode } from '@rushpoint/shared';
import { isTaskHidden } from '@rushpoint/shared';
import { taskPreviewLine, TYPE_FAMILY_COLOR, type PreviewLabels } from '../lib/taskCardPreview';
import { OverflowMenu } from './OverflowMenu';
import { GROUP_STYLES } from '../lib/groupStyles';
import { useT } from './LanguageContext';
import { BuilderIcon, TRIGGER_ICON_NAME } from './builderIcons';

// The exclusive-group palette now lives in a pure, React-free lib so it can be
// unit-tested directly. Re-exported here so existing importers (BuilderPage,
// ExclusiveGroupsModal) keep importing it from '../components/TaskCard'.
export { GROUP_STYLES } from '../lib/groupStyles';

/** Membership in the owning stage's EFFECTIVE exclusive groups, precomputed by
 *  BuilderPage. Undefined = ungrouped or in an inert group ⇒ no badge, no ring. */
export interface TaskGroupBadge { index: number; letter: string; size: number }

/** Filled/empty difficulty dots (1..10 compressed to 5 dots). */
function DifficultyDots({ difficulty }: { difficulty: number }) {
  const b = useT().builder;
  const filled = Math.round(Math.min(10, Math.max(1, difficulty)) / 2);
  return (
    <span className="inline-flex gap-0.5" title={b.difficultyOutOfTen(difficulty)} aria-label={b.difficultyAriaLabel(difficulty)}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={`w-2 h-2 rounded-full ${i < filled ? 'bg-rp-fire' : 'bg-[--rp-border]'}`} />
      ))}
    </span>
  );
}

/** A stage this card can be moved into (the non-drag / touch fallback). */
export interface MoveTarget { id: string; label: string }

export default function TaskCard({
  task, active, onClick, dragging, moveTargets, onMoveToStage,
  onDuplicate, onToggleHidden, onDelete, group, handleProps,
}: {
  task: Task;
  active?: boolean;
  onClick: () => void;
  /** True while this card is the drag source — dimmed, but kept in the DOM so
   *  the virtualizer's ResizeObserver never measures a 0-height row. */
  dragging?: boolean;
  /** Other stages, for the "move to stage" fallback. Empty/undefined hides it. */
  moveTargets?: MoveTarget[];
  onMoveToStage?: (stageId: string) => void;
  /**
   * The rest of the ⋯ menu (change: mission-card-actions). Each is optional and a
   * missing one simply drops its row, so the menu never offers an action this card
   * cannot perform — `onDelete` is withheld for the last mission of a stage, and
   * `moveTargets` is empty in a one-stage game.
   */
  onDuplicate?: () => void;
  /** Bench this mission, or bring it back. See shared/hiddenTask. */
  onToggleHidden?: () => void;
  onDelete?: () => void;
  /** Exclusive-group membership, for the badge + ring (change: builder-dnd-groups). */
  group?: TaskGroupBadge;
  /** dnd-kit sortable listeners/attributes (plus its activator `ref`), spread on
   *  the ⠿ handle ONLY, so a tap on the card body still opens the panel instead
   *  of starting a drag. */
  handleProps?: HTMLAttributes<HTMLElement> & { ref?: (el: HTMLElement | null) => void };
}) {
  const b = useT().builder;
  const hidden = isTaskHidden(task);
  const style = group ? GROUP_STYLES[group.index % GROUP_STYLES.length] : null;
  const color = TYPE_FAMILY_COLOR[task.type];
  const mode = normalizeTriggerMode(task);
  const typeLabel: Record<TaskType, string> = {
    field: b.typeField, self_report: b.typeSelfReport, smart_station: b.typeStation, photo: b.typePhoto,
    quiz: b.typeQuiz, numeric: b.typeNumeric, geofence: b.typeGeofence, sequence: b.typeSequence,
    survey: b.typeSurvey,
  };
  const previewLabels: PreviewLabels = {
    quizChoices: b.prevQuizChoices, quizTyped: b.prevQuizTyped, quizNone: b.prevQuizNone,
    stationCode: b.prevStationCode, stationNone: b.prevStationNone,
    photoAuto: b.prevPhotoAuto, photoStaff: b.prevPhotoStaff,
    numericAnswer: b.prevNumericAnswer, numericNone: b.prevNumericNone,
    geofence: b.prevGeofence, sequence: b.prevSequence, field: b.prevField, selfReport: b.prevSelfReport,
    surveyChoices: b.prevSurveyChoices, surveyText: b.prevSurveyText,
  };
  // Root is a role="button" div rather than a real <button>: the overflow menu
  // below is an interactive control, and nested interactive content inside a
  // <button> is invalid HTML (and unreachable by keyboard in Safari).
  // Enter/Space are wired manually to preserve button semantics.
  return (
    <div
      role="button"
      tabIndex={0}
      // Without an explicit name the card's accessible name is computed from its
      // contents, which starts with the ⠿ handle's drag instruction — so a screen
      // reader announced the card AS the handle. Name it after the task instead.
      aria-label={task.title || b.untitledTask}
      onClick={onClick}
      onKeyDown={(e) => {
        // Only when the CARD itself is focused. Space is also dnd-kit's lift/drop
        // key on the ⠿ handle, and swallowing it here (or stopping its bubble in
        // the handle) would either open the editor mid-drag or break the drop.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      }}
      // Calm colour treatment (docs/wave-l/task-card-colour-refine.md): no more
      // full-height saturated type slab; type is a small dot in the pill below.
      // An ungrouped card is a clean neutral panel; a grouped card gets a slim
      // leading accent + the letter badge (colourblind-safe). One ring system
      // (the brand fire selection ring), no competing group ring.
      className={`group/card w-full text-start rounded-xl border border-[--rp-border] bg-[--surface-1] px-4 py-3
        flex flex-col gap-2 transition-colors hover:bg-[--surface-2] cursor-pointer
        focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60
        ${active ? 'ring-2 ring-rp-fire/60' : ''} ${dragging ? 'opacity-40' : ''}
        ${style ? `border-s-[3px] ${style.accent}` : ''}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          {...handleProps}
          title={b.dragTaskHandle}
          aria-label={b.dragTaskHandle}
          onClick={(e) => e.stopPropagation()}
          // 44px touch target (the glyph's own box was 12x24 — unhittable on a
          // phone). The negative margin lets the enlarged box grow into the
          // card's padding instead of the flow, so the row's other content does
          // not shift. It is split per axis on purpose: -mx-2 matches this row's
          // gap-2 exactly, so the box stops flush against the type chip instead
          // of overlapping it, while -my-2.5 keeps the row at its original 24px.
          className="shrink-0 select-none text-[--ink-3] cursor-grab active:cursor-grabbing touch-none
            flex items-center justify-center w-11 h-11 -mx-2 -my-2.5 rounded
            focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60"
        >⠿</span>
        {/* Type chip: a small filled dot carries the family hue (the only saturated
            pixel); the label stays neutral + legible, so the grid reads calm. */}
        <span className="inline-flex items-center gap-1.5 shrink-0 text-[12px] font-semibold uppercase tracking-wide
          px-2 py-0.5 rounded bg-[--surface-2] text-[--ink-2] border border-[--rp-border]">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} aria-hidden="true" />
          {typeLabel[task.type]}
        </span>
        {/* Exclusive-group badge: letter + border + colour, so hue is never the
            only cue. Fixed 18px square ⇒ no change to the card's height. */}
        {group && style && (
          <span
            title={b.exclusiveBadgeAria(group.letter, group.size)}
            aria-label={b.exclusiveBadgeAria(group.letter, group.size)}
            className={`shrink-0 inline-flex items-center justify-center w-[18px] h-[18px] rounded border
              text-[12px] font-bold leading-none ${style.badge}`}
          >{group.letter}</span>
        )}
        <span className="text-sm font-semibold text-[--ink-1] truncate" dir="auto">{task.title || b.untitledTask}</span>
        {/* BENCHED (change: mission-card-actions). Said in words, not by a dimmed
            card: "this one is faded" is indistinguishable from "this one is
            disabled" or from a rendering glitch, and the whole promise of the
            action is that the mission is still HERE. The card stays fully legible
            and carries a label that names its state. */}
        {hidden && (
          <span className="shrink-0 rounded-full border border-[--rp-border] bg-[--surface-2] px-2 py-0.5 text-[12px] font-medium text-[--ink-2]">
            {b.taskHiddenBadge}
          </span>
        )}
        <BuilderIcon name={TRIGGER_ICON_NAME[mode]} className="w-4 h-4 ms-auto shrink-0 text-[--ink-3]" />
        {/* Everything a creator can do to one mission WITHOUT opening it
            (change: mission-card-actions): duplicate it, move it to another stage,
            bench it, delete it.

            It was a native `<select>` offering "move to stage" and nothing else —
            chosen because a browser-rendered popup cannot be clipped by the canvas
            scroller. `OverflowMenu` clears that bar too (it portals to the body and
            positions itself against the viewport), so the menu can now be a real
            menu: four actions, each named, with the destructive one last and
            styled as such. */}
        {/* The card body opens the editor and the ⠿ handle starts a drag; the menu
            must do neither. That is stopped inside OverflowMenu, on its own trigger
            button — a `<span onClick>` wrapper here would be a clickable
            non-interactive element, which the creator a11y scan counts and is right
            to. */}
        {(onDuplicate || onToggleHidden || onDelete || (onMoveToStage && moveTargets && moveTargets.length > 0)) && (
          <span className="shrink-0 opacity-60 transition-opacity group-hover/card:opacity-100 focus-within:opacity-100">
            <OverflowMenu
              label="⋯" // i18n-ignore universal overflow glyph, named by ariaLabel
              ariaLabel={b.taskActionsMenu}
              triggerClassName="w-8 h-8 justify-center rounded border border-[--rp-border] bg-[--surface-2] text-[--ink-3] text-[13px] leading-none px-0"
            >
              {onDuplicate && (
                <button role="menuitem" onClick={onDuplicate}
                  className="w-full text-start px-3 py-2.5 text-[13px] text-[--ink-1] rounded-lg hover:bg-[--surface-2] transition-colors">
                  {b.duplicateTask}
                </button>
              )}
              {onToggleHidden && (
                <button role="menuitem" onClick={onToggleHidden}
                  className="w-full text-start px-3 py-2.5 text-[13px] text-[--ink-1] rounded-lg hover:bg-[--surface-2] transition-colors">
                  {hidden ? b.unhideTask : b.hideTask}
                  <span className="block text-[12px] text-[--ink-3] leading-snug">
                    {hidden ? b.unhideTaskHelp : b.hideTaskHelp}
                  </span>
                </button>
              )}
              {onMoveToStage && moveTargets && moveTargets.length > 0 && (
                <>
                  {/* The stages themselves ARE the rows — the creator asked for
                      "move to…" to open the stage list, and a submenu here would
                      be a second popup inside a portal for a list this short. */}
                  <p className="px-3 pt-2 pb-1 text-[12px] font-semibold text-[--ink-3]">{b.moveTaskTo}</p>
                  {moveTargets.map((s) => (
                    <button key={s.id} role="menuitem" onClick={() => onMoveToStage(s.id)}
                      className="w-full text-start px-3 py-2.5 text-[13px] text-[--ink-1] rounded-lg hover:bg-[--surface-2] transition-colors truncate"
                      dir="auto">
                      {s.label}
                    </button>
                  ))}
                </>
              )}
              {onDelete && (
                <button role="menuitem" onClick={onDelete}
                  className="w-full text-start px-3 py-2.5 text-[13px] text-ink-alert rounded-lg hover:bg-rp-alert/10 transition-colors">
                  {b.deleteTask}
                </button>
              )}
            </OverflowMenu>
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 min-w-0 text-xs text-[--ink-3]">
        <span className="truncate flex-1" dir="auto">{taskPreviewLine(task, previewLabels)}</span>
        <DifficultyDots difficulty={task.difficulty} />
        <span className="shrink-0 tabular-nums" title={b.estimatedMinutesTitle}>⏱ {task.estimatedMinutes}m</span>
        <span className="shrink-0 tabular-nums" title={b.pointsTitle}>★ {task.pointValue}</span>
      </div>
    </div>
  );
}
