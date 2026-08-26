// Task library browser (§4/§10) — opened from the Builder to pull a public task
// into the stage being edited. Picking a task reconstructs it as a fresh Task
// (new id) and bumps the source's copyCount.
import { useEffect, useState } from 'react';
import type { PublicTask, Task } from '@rushpoint/shared';
import { searchTaskLibrary, incrementTaskCopyCount } from '../services/calls';
import { Button, Card, Input, Spinner, TagChips } from './ui';
import { dialog } from './dialog';
import { useT } from './LanguageContext';
import GalleryTaskDetailModal from './GalleryTaskDetailModal';
import { useModalDismiss } from '../hooks/useModalDismiss';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

// Copying a library task brings its APPROXIMATE area, never the author's exact
// pin (change: task-library-map-view). The copy path was the second door onto the
// same secret: `coordinates` used to be the exact authored point, so "copy a task"
// was a way to read it — including for a hidden-location task whose location is
// the puzzle. A copied mission is being re-sited anyway, and an unplaced one flows
// through the Builder's normal "needs placement" path.
function toTask(pt: PublicTask): Task {
  return {
    id: uuid(),
    title: pt.title,
    description: pt.description,
    type: pt.type,
    // `Task.coordinates` is required, so an absent area falls back to the SAME
    // (0,0) placeholder `blankTask()` uses — the Builder's established "not placed
    // yet" value, which its placement validation already rejects.
    coordinates: pt.approxLocation ?? { lat: 0, lng: 0 },
    difficulty: pt.difficulty,
    estimatedMinutes: pt.estimatedMinutes,
    pointValue: pt.pointValue,
    // 1, not 3: a copied task's real capacity is a property of the ORIGINAL
    // creator's venue, which does not travel with the copy. 1 is the safe
    // assumption until the new creator says otherwise — matches
    // TASK_FIELD_DEFAULTS / blankTask() (lib/taskOptInGroups.ts, lib/wizardLogic.ts).
    maxConcurrentTeams: 1,
    tags: pt.tags ?? [],
  };
}

export default function TaskLibrary({ onInsert, onClose }: {
  onInsert: (task: Task) => void;
  onClose: () => void;
}) {
  const t = useT();
  const b = t.builder;
  const gl = t.gallery;
  // Localized task-type labels so the library never shows raw English enum values
  // (e.g. "smart_station") in a Hebrew UI — mirrors the Gallery/Dashboard cards.
  const TASK_TYPE_LABEL: Record<string, string> = {
    field: b.typeField, self_report: b.typeSelfReport, smart_station: b.typeStation,
    photo: b.typePhoto, quiz: b.typeQuiz, numeric: b.typeNumeric,
    geofence: b.typeGeofence, sequence: b.typeSequence, survey: b.typeSurvey,
  };
  const [q, setQ] = useState('');
  const [tasks, setTasks] = useState<PublicTask[] | null>(null);
  // The mission a creator pressed to READ before committing it to a stage
  // (change: gallery-mission-detail). No fetch: searchTaskLibrary already returned
  // the whole sanitized document, so this is the row's own payload.
  const [detail, setDetail] = useState<PublicTask | null>(null);
  // Escape closes the library — but only while the mission-detail modal below is
  // NOT open, or one press would close both (see useModalDismiss on nesting).
  useModalDismiss(onClose, undefined, detail === null);

  async function run() {
    setTasks(null);
    try {
      const { tasks } = await searchTaskLibrary({ query: q });
      setTasks(tasks);
    } catch (e) {
      // Don't strand the modal on a spinner if the search fails.
      await dialog.alert(e instanceof Error ? e.message : gl.searchFailed);
      setTasks([]);
    }
  }
  useEffect(() => { void run(); /* eslint-disable-next-line */ }, []);

  function pick(pt: PublicTask) {
    onInsert(toTask(pt));
    incrementTaskCopyCount({ publicTaskId: pt.id }).catch(() => undefined);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Card className="w-full max-w-2xl p-5 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{b.libraryTitle}</h3>
          <button className="text-[--ink-2] hover:text-[--ink-1] text-sm" aria-label={b.closePanel} title={b.closePanel} onClick={onClose}>✕</button>
        </div>
        <div className="flex gap-2 mb-4">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={b.librarySearchPlaceholder}
            onKeyDown={(e) => e.key === 'Enter' && run()} />
          <Button onClick={run}>{b.librarySearchBtn}</Button>
        </div>

        <div className="overflow-y-auto space-y-2">
          {!tasks ? <Spinner label={b.libraryLoading} /> : tasks.length === 0 ? (
            <p className="text-center text-[--ink-2] py-10 text-sm">{b.libraryEmpty}</p>
          ) : tasks.map((t) => (
            // A row is a role="button" div, not a <button>: it contains the insert
            // control, and nested interactive content inside a <button> is invalid
            // HTML and unreachable by keyboard in Safari. Enter/Space are wired by
            // hand to keep button semantics.
            <div key={t.id} role="button" tabIndex={0}
              aria-label={t.title}
              onClick={() => setDetail(t)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail(t); }
              }}
              className="flex items-center gap-3 border border-glass-border rounded-lg p-3 cursor-pointer
                transition-colors hover:bg-[--surface-2]
                focus:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[--ink-1] truncate">{t.title}</div>
                <div className="text-xs text-[--ink-2] truncate">{t.description}</div>
                <div className="flex gap-2 text-[11px] text-[--ink-3] mt-0.5">
                  <span>{TASK_TYPE_LABEL[t.type] ?? t.type}</span>·<span>{gl.metaDiff(t.difficulty)}</span>·<span>{gl.metaPts(t.pointValue)}</span>·<span>{gl.metaCopies(t.copyCount)}</span>
                  {t.sourceGameTitle && <span className="truncate">{b.libraryFrom(t.sourceGameTitle)}</span>}
                </div>
                {/* Tags (change: game-task-tags): this component already read
                    `pt.tags` — but only to COPY it into the new task at toTask()
                    above. Nothing ever showed them to the creator choosing. */}
                <TagChips tags={t.tags} max={4} more={gl.moreTags} className="mt-1" />
              </div>
              {/* The one-tap insert path is preserved for creators who already
                  know the mission, so pressing it must not also open the detail. */}
              <Button variant="subtle" onClick={(e) => { e.stopPropagation(); pick(t); }}>{b.libraryInsert}</Button>
            </div>
          ))}
        </div>
      </Card>

      {detail && (
        <GalleryTaskDetailModal
          task={detail}
          onClose={() => setDetail(null)}
          onUse={() => pick(detail)}
        />
      )}
    </div>
  );
}
