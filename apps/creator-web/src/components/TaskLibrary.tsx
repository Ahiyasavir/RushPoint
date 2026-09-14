// Task library browser (§4/§10) — opened from the Builder to pull a mission into
// the stage being edited.
//
// Two kinds of row, one list (change: mission-bank-in-library):
//   • a PUBLISHED mission (`publicTasks`, via searchTaskLibrary) — picking it
//     reconstructs a fresh Task from the sanitized document and bumps copyCount;
//   • a BANK mission (the hand-authored pool the smart composer draws from, live
//     through loadMissionBank so an admin edit shows up without a redeploy) —
//     picking it runs the entry's own `build()`, which is the full authored
//     mission, verification and capacity included. There is no document to bump.
// `lib/libraryBankRows.ts` owns the projection, the de-duplication and the merge.
import { useEffect, useRef, useState } from 'react';
import type { Task } from '@rushpoint/shared';
import { searchTaskLibrary, incrementTaskCopyCount } from '../services/calls';
import { Button, Card, Input, Spinner, TagChips } from './ui';
import { dialog } from './dialog';
import { useT, useLanguage } from './LanguageContext';
import GalleryTaskDetailModal from './GalleryTaskDetailModal';
import { useModalDismiss } from '../hooks/useModalDismiss';
// Extracted so the third field-default seeder in this app can be tested against
// the other two (see lib/libraryTask.ts for why that matters).
import { libraryTaskToTask } from '../lib/libraryTask';
import { loadMissionBank } from '../lib/missionBank';
import type { TaskBankEntry } from '../taskBank';
import { bankRowsFor, mergeLibraryRows, type LibraryRow } from '../lib/libraryBankRows';
import { TAP_TARGET } from '../lib/interaction';

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
  const { lang } = useLanguage();
  const [q, setQ] = useState('');
  const [tasks, setTasks] = useState<LibraryRow[] | null>(null);
  // The bank entries behind whatever bank rows are on screen. Held so `pick` can
  // run the ORIGINAL `build()` rather than rebuilding a mission from the row it
  // rendered — the row is a deliberately lossy projection (no answer key, no
  // verification, no capacity), so reconstructing from it would hand the creator
  // a hollowed-out copy of the mission they chose.
  const bankEntries = useRef<Map<string, TaskBankEntry>>(new Map());
  // The mission a creator pressed to READ before committing it to a stage
  // (change: gallery-mission-detail). No fetch: the row already carries the whole
  // sanitized payload, whether it came from the callable or from the bank.
  const [detail, setDetail] = useState<LibraryRow | null>(null);
  // Escape closes the library — but only while the mission-detail modal below is
  // NOT open, or one press would close both (see useModalDismiss on nesting).
  useModalDismiss(onClose, undefined, detail === null);

  async function run() {
    setTasks(null);
    // Both sources at once: the bank load is usually a memo hit and never throws
    // (it falls back to the authored bank), so it must not sit behind the search.
    const [published, entries] = await Promise.all([
      searchTaskLibrary({ query: q }).then((r) => r.tasks).catch(async (e) => {
        // Don't strand the modal on a spinner if the search fails — and don't let
        // it empty the library either: the bank is local and still perfectly good.
        await dialog.alert(e instanceof Error ? e.message : gl.searchFailed);
        return [] as LibraryRow[];
      }),
      loadMissionBank(),
    ]);
    bankEntries.current = new Map(entries.map((e) => [e.key, e]));
    setTasks(mergeLibraryRows(published as LibraryRow[], bankRowsFor(entries, lang), q));
  }
  useEffect(() => { void run(); /* eslint-disable-next-line */ }, []);

  function pick(pt: LibraryRow) {
    if (pt.bankKey) {
      const entry = bankEntries.current.get(pt.bankKey);
      // A bank row whose entry has gone (an admin deleted it between the load and
      // the tap) inserts nothing rather than a placeholder the creator would have
      // to notice and undo.
      if (entry) onInsert(entry.build());
      onClose();
      return;
    }
    onInsert(libraryTaskToTask(pt));
    incrementTaskCopyCount({ publicTaskId: pt.id }).catch(() => undefined);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Card className="w-full max-w-2xl p-5 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{b.libraryTitle}</h3>
          <button className={`${TAP_TARGET} -me-2 shrink-0 rounded-lg text-[--ink-2] hover:text-[--ink-1] hover:bg-[--surface-2] text-sm`}
            aria-label={b.closePanel} title={b.closePanel} onClick={onClose}>✕</button>
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
                <div className="flex items-center gap-2 min-w-0">
                  <div className="text-sm font-medium text-[--ink-1] truncate" dir="auto">{t.title}</div>
                  {/* Says where the mission came from, because the meta line below
                      cannot: a bank mission has no author, no source game and no
                      copy count, and an unexplained row with none of those reads
                      as a broken record rather than as curated content. */}
                  {t.bankKey && (
                    <span title={gl.bankRowBadgeHelp}
                      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold
                        bg-rp-fire/10 text-rp-fire border border-rp-fire/25">
                      {gl.bankRowBadge}
                    </span>
                  )}
                </div>
                <div className="text-xs text-[--ink-2] truncate" dir="auto">{t.description}</div>
                <div className="flex gap-2 text-[13px] text-[--ink-3] mt-0.5">
                  <span>{TASK_TYPE_LABEL[t.type] ?? t.type}</span>·<span>{gl.metaDiff(t.difficulty)}</span>·<span>{gl.metaPts(t.pointValue)}</span>
                  {/* Copies and the source game are facts about a PUBLISHED
                      mission. On a bank row they would both be blank-or-zero, and
                      "0 copies" reads as "nobody wanted this" rather than "this
                      has never been in the gallery". */}
                  {!t.bankKey && <>·<span>{gl.metaCopies(t.copyCount)}</span></>}
                  {!t.bankKey && t.sourceGameTitle && <span className="truncate">{b.libraryFrom(t.sourceGameTitle)}</span>}
                </div>
                {/* Tags (change: game-task-tags): this component already read
                    `pt.tags` — but only to COPY it into the new task at libraryTaskToTask()
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
