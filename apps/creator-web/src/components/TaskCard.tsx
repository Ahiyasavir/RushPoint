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

export default function TaskCard({ task, active, onClick }: { task: Task; active?: boolean; onClick: () => void }) {
  const b = useT().builder;
  const color = TYPE_FAMILY_COLOR[task.type];
  const mode = normalizeTriggerMode(task);
  const typeLabel: Record<TaskType, string> = {
    field: b.typeField, self_report: b.typeSelfReport, smart_station: b.typeStation, photo: b.typePhoto,
    quiz: b.typeQuiz, numeric: b.typeNumeric, geofence: b.typeGeofence, sequence: b.typeSequence,
  };
  const previewLabels: PreviewLabels = {
    quizChoices: b.prevQuizChoices, quizTyped: b.prevQuizTyped, quizNone: b.prevQuizNone,
    stationCode: b.prevStationCode, stationNone: b.prevStationNone,
    photoAuto: b.prevPhotoAuto, photoStaff: b.prevPhotoStaff,
    numericAnswer: b.prevNumericAnswer, numericNone: b.prevNumericNone,
    geofence: b.prevGeofence, sequence: b.prevSequence, field: b.prevField, selfReport: b.prevSelfReport,
  };
  return (
    <button
      onClick={onClick}
      style={{ borderInlineStartColor: color }}
      className={`w-full text-start rounded-xl border border-[--rp-border] border-s-[4px] bg-[--surface-1] px-4 py-3
        flex flex-col gap-2 transition-colors hover:bg-[--surface-2]
        ${active ? 'ring-2 ring-rp-fire/60' : ''}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded shrink-0" style={{ background: `${color}22`, color }}>
          {typeLabel[task.type]}
        </span>
        <span className="text-sm font-semibold text-[--ink-1] truncate" dir="auto">{task.title || b.untitledTask}</span>
        <BuilderIcon name={TRIGGER_ICON_NAME[mode]} className="w-4 h-4 ms-auto shrink-0 text-[--ink-3]" />
      </div>
      <div className="flex items-center gap-3 min-w-0 text-xs text-[--ink-3]">
        <span className="truncate flex-1" dir="auto">{taskPreviewLine(task, previewLabels)}</span>
        <DifficultyDots difficulty={task.difficulty} />
        <span className="shrink-0 tabular-nums" title={b.estimatedMinutesTitle}>⏱ {task.estimatedMinutes}m</span>
        <span className="shrink-0 tabular-nums" title={b.pointsTitle}>★ {task.pointValue}</span>
      </div>
    </button>
  );
}
