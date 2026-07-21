// Scannable full-width task card for the v2.1 Builder canvas (change:
// v2.1-builder-shell-redesign). Replaces the cramped 132×96 TaskTile chip: a
// creator can read a whole stage's structure (type, difficulty, time, points,
// location mode, and a computed 1-line interaction preview) without opening a
// panel. Pure presentation — all logic comes from lib/taskCardPreview.
import type { HTMLAttributes } from 'react';
import type { Task, TaskType } from '@rushpoint/shared';
import { normalizeTriggerMode } from '@rushpoint/shared';
import { taskPreviewLine, TYPE_FAMILY_COLOR, type PreviewLabels } from '../lib/taskCardPreview';
import { useT } from './LanguageContext';
import { BuilderIcon, TRIGGER_ICON_NAME } from './builderIcons';

/**
 * Palette for mutually exclusive task groups (change: builder-dnd-groups).
 *
 * ⚠ These MUST stay literal, complete class strings. Tailwind scans source text,
 * so a computed `bg-${hue}-500/20` would be purged out of the bundle and the
 * badge would render colourless. Index into this array, never build the string.
 *
 * Colour is never the ONLY carrier: every badge also shows the group LETTER and
 * a border, and every group is named in text in the strip and the modal, so the
 * surface is colourblind safe for everyone with no mode switch (creator-web has
 * no colourblind flag). Past 6 groups the colour repeats but the letter does not.
 */
export const GROUP_STYLES = [
  { badge: 'bg-cyan-500/20 text-cyan-200 border-cyan-400', ring: 'ring-cyan-400/70' },
  { badge: 'bg-amber-500/20 text-amber-200 border-amber-400', ring: 'ring-amber-400/70' },
  { badge: 'bg-violet-500/20 text-violet-200 border-violet-400', ring: 'ring-violet-400/70' },
  { badge: 'bg-emerald-500/20 text-emerald-200 border-emerald-400', ring: 'ring-emerald-400/70' },
  { badge: 'bg-pink-500/20 text-pink-200 border-pink-400', ring: 'ring-pink-400/70' },
  { badge: 'bg-orange-500/20 text-orange-200 border-orange-400', ring: 'ring-orange-400/70' },
] as const;

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

export default function TaskCard({ task, active, onClick, dragging, moveTargets, onMoveToStage, group, handleProps }: {
  task: Task;
  active?: boolean;
  onClick: () => void;
  /** True while this card is the drag source — dimmed, but kept in the DOM so
   *  the virtualizer's ResizeObserver never measures a 0-height row. */
  dragging?: boolean;
  /** Other stages, for the "move to stage" fallback. Empty/undefined hides it. */
  moveTargets?: MoveTarget[];
  onMoveToStage?: (stageId: string) => void;
  /** Exclusive-group membership, for the badge + ring (change: builder-dnd-groups). */
  group?: TaskGroupBadge;
  /** dnd-kit sortable listeners/attributes (plus its activator `ref`), spread on
   *  the ⠿ handle ONLY, so a tap on the card body still opens the panel instead
   *  of starting a drag. */
  handleProps?: HTMLAttributes<HTMLElement> & { ref?: (el: HTMLElement | null) => void };
}) {
  const b = useT().builder;
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
      style={{ borderInlineStartColor: color }}
      className={`group/card w-full text-start rounded-xl border border-[--rp-border] border-s-[4px] bg-[--surface-1] px-4 py-3
        flex flex-col gap-2 transition-colors hover:bg-[--surface-2] cursor-pointer
        focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60
        ${active ? 'ring-2 ring-rp-fire/60' : ''} ${dragging ? 'opacity-40' : ''}
        ${style && !active ? `ring-1 ring-inset ${style.ring}` : ''}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          {...handleProps}
          title={b.dragTaskHandle}
          aria-label={b.dragTaskHandle}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 select-none text-[--ink-3] cursor-grab active:cursor-grabbing touch-none
            focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60 rounded"
        >⠿</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded shrink-0" style={{ background: `${color}22`, color }}>
          {typeLabel[task.type]}
        </span>
        {/* Exclusive-group badge: letter + border + colour, so hue is never the
            only cue. Fixed 18px square ⇒ no change to the card's height. */}
        {group && style && (
          <span
            title={b.exclusiveBadgeAria(group.letter, group.size)}
            aria-label={b.exclusiveBadgeAria(group.letter, group.size)}
            className={`shrink-0 inline-flex items-center justify-center w-[18px] h-[18px] rounded border
              text-[10px] font-bold leading-none ${style.badge}`}
          >{group.letter}</span>
        )}
        <span className="text-sm font-semibold text-[--ink-1] truncate" dir="auto">{task.title || b.untitledTask}</span>
        <BuilderIcon name={TRIGGER_ICON_NAME[mode]} className="w-4 h-4 ms-auto shrink-0 text-[--ink-3]" />
        {/* Non-drag fallback (screen readers / keyboard / tablets): move this task
            to another stage without dragging. Lives behind a ⋯ menu that is
            revealed on hover or focus, so it costs no width on the card face. */}
        {onMoveToStage && moveTargets && moveTargets.length > 0 && (
          <select
            value=""
            aria-label={b.moveTaskTo}
            title={b.moveTaskTo}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const id = e.target.value;
              e.target.value = '';
              if (id) onMoveToStage(id);
            }}
            // A NATIVE select on purpose: its popup is rendered by the browser, so
            // it can never be clipped by the canvas scroll container, it is a real
            // listbox for screen readers, and it becomes the OS picker on a tablet.
            // Collapsed it is just a ⋯ glyph, so it costs ~2rem instead of the 8rem
            // the labelled version ate; opacity reveals it on hover or focus while
            // the reserved width keeps the row from shifting.
            className="shrink-0 w-8 appearance-none text-center cursor-pointer rounded border border-[--rp-border]
              bg-[--surface-2] text-[--ink-3] text-[11px] leading-none px-0 py-0.5 opacity-0
              transition-opacity group-hover/card:opacity-100 focus:opacity-100 focus-visible:opacity-100"
          >
            <option value="">⋯</option>
            {moveTargets.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
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
