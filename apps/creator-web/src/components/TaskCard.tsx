// Scannable full-width task card for the v2.1 Builder canvas (change:
// v2.1-builder-shell-redesign). Replaces the cramped 132×96 TaskTile chip: a
// creator can read a whole stage's structure (type, difficulty, time, points,
// location mode, and a computed 1-line interaction preview) without opening a
// panel. Pure presentation — all logic comes from lib/taskCardPreview.
import type { Task, TaskType } from '@rushpoint/shared';
import { normalizeTriggerMode } from '@rushpoint/shared';
import { taskPreviewLine, TYPE_FAMILY_COLOR, type PreviewLabels } from '../lib/taskCardPreview';
import { useT } from './LanguageContext';
import { BuilderIcon, TRIGGER_ICON_NAME } from './builderIcons';

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

export default function TaskCard({ task, active, onClick, dragging, moveTargets, onMoveToStage }: {
  task: Task;
  active?: boolean;
  onClick: () => void;
  /** True while this card is the drag source — dimmed, but kept in the DOM so
   *  the virtualizer's ResizeObserver never measures a 0-height row. */
  dragging?: boolean;
  /** Other stages, for the "move to stage" fallback. Empty/undefined hides it. */
  moveTargets?: MoveTarget[];
  onMoveToStage?: (stageId: string) => void;
}) {
  const b = useT().builder;
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
  // Root is a role="button" div rather than a real <button>: the "move to stage"
  // <select> below is an interactive control, and nested interactive content
  // inside a <button> is invalid HTML (and unreachable by keyboard in Safari).
  // Enter/Space are wired manually to preserve button semantics.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      }}
      style={{ borderInlineStartColor: color }}
      className={`w-full text-start rounded-xl border border-[--rp-border] border-s-[4px] bg-[--surface-1] px-4 py-3
        flex flex-col gap-2 transition-colors hover:bg-[--surface-2] cursor-pointer
        focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60
        ${active ? 'ring-2 ring-rp-fire/60' : ''} ${dragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span aria-hidden title={b.dragTaskHandle} className="shrink-0 select-none text-[--ink-3] cursor-grab active:cursor-grabbing">⠿</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded shrink-0" style={{ background: `${color}22`, color }}>
          {typeLabel[task.type]}
        </span>
        <span className="text-sm font-semibold text-[--ink-1] truncate" dir="auto">{task.title || b.untitledTask}</span>
        <BuilderIcon name={TRIGGER_ICON_NAME[mode]} className="w-4 h-4 ms-auto shrink-0 text-[--ink-3]" />
        {/* Non-drag fallback (tablets / keyboard): move this task to another
            stage without dragging. Stops propagation so it never opens the panel. */}
        {onMoveToStage && moveTargets && moveTargets.length > 0 && (
          <select
            value=""
            aria-label={b.moveTaskTo}
            title={b.moveTaskTo}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            // The card wrapper is `draggable`; without this a mousedown on the
            // select can start a drag instead of opening the dropdown.
            draggable={false}
            onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onChange={(e) => {
              const id = e.target.value;
              e.target.value = '';
              if (id) onMoveToStage(id);
            }}
            className="shrink-0 max-w-[8rem] rounded border border-[--rp-border] bg-[--surface-2] text-[--ink-3] text-[10px] px-1 py-0.5"
          >
            <option value="">{b.moveTaskTo}</option>
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
