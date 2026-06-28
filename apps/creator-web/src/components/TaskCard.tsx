// Scannable full-width task card for the v2.1 Builder canvas (change:
// v2.1-builder-shell-redesign). Replaces the cramped 132×96 TaskTile chip: a
// creator can read a whole stage's structure (type, difficulty, time, points,
// location mode, and a computed 1-line interaction preview) without opening a
// panel. Pure presentation — all logic comes from lib/taskCardPreview.
import type { Task, TaskType } from '@rushpoint/shared';
import { normalizeTriggerMode } from '@rushpoint/shared';
import { taskPreviewLine, TYPE_FAMILY_COLOR, type PreviewLabels } from '../lib/taskCardPreview';
import { useT } from './LanguageContext';

const TRIGGER_ICON: Record<string, string> = {
  radius: '📍', exact: '🎯', instant: '⚡', locationless: '🌐',
};

/** Filled/empty difficulty dots (1..10 compressed to 5 dots). */
function DifficultyDots({ difficulty }: { difficulty: number }) {
  const filled = Math.round(Math.min(10, Math.max(1, difficulty)) / 2);
  return (
    <span className="inline-flex gap-0.5" title={`Difficulty ${difficulty}/10`} aria-label={`Difficulty ${difficulty} of 10`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < filled ? 'bg-rp-fire' : 'bg-[--rp-border]'}`} />
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
      className={`w-full text-start rounded-xl border border-[--rp-border] border-s-[3px] bg-[--surface-1] px-4 py-3
        flex items-center gap-3 transition-colors hover:bg-[--surface-2]
        ${active ? 'ring-2 ring-rp-fire/60' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: `${color}22`, color }}>
            {typeLabel[task.type]}
          </span>
          <span className="text-sm font-semibold text-[--ink-1] truncate" dir="auto">{task.title || b.untitledTask}</span>
        </div>
        <div className="text-xs text-[--ink-3] truncate mt-0.5" dir="auto">{taskPreviewLine(task, previewLabels)}</div>
      </div>
      <div className="shrink-0 flex items-center gap-3 text-[11px] text-[--ink-3]">
        <DifficultyDots difficulty={task.difficulty} />
        <span title="Estimated minutes">⏱ {task.estimatedMinutes}m</span>
        <span title="Points">★ {task.pointValue}</span>
        <span title={`Trigger: ${mode}`}>{TRIGGER_ICON[mode] ?? '📍'}</span>
      </div>
    </button>
  );
}
