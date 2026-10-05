// "Where should this team go back to?" (change: send-team-back).
//
// Ahiya, 2026-09-25: "I have no button at all to send a team back, make sure there is one."
// The picker lists the team's reached stages and their missions, marked done / skipped / now /
// not yet, and offers exactly what `returnTeamTo` accepts (lib/sendBackTargets.ts). Choosing a
// target hands it back to the console, which previews it with the server's dry run and confirms.
// Same overlay shape as ShareLinkDialog: a real <button> backdrop, a labelled dialog, Esc closes.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useT } from './LanguageContext';
import { TAP_TARGET } from '../lib/interaction';
import type { SendBackStage } from '../lib/sendBackTargets';

export type SendBackChoice = { kind: 'task'; taskId: string; title: string } | { kind: 'stage'; stageId: string; title: string };

export default function SendBackPicker({ teamName, stages, onPick, onClose }: {
  teamName: string;
  stages: SendBackStage[];
  onPick: (choice: SendBackChoice) => void;
  onClose: () => void;
}) {
  const t = useT();
  const p = t.runConsole.sendBackPicker;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const statusLabel = { done: p.statusDone, skipped: p.statusSkipped, current: p.statusCurrent, open: p.statusOpen } as const;
  const statusTone = {
    done: 'text-ink-go', skipped: 'text-ink-amber', current: 'text-[--ink-2]', open: 'text-[--ink-4]',
  } as const;
  const anything = stages.some((s) => s.stageSelectable || s.missions.some((m) => m.selectable));

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
      <button type="button" aria-label={p.cancel} onClick={onClose} className="absolute inset-0 w-full h-full cursor-default" />
      <div
        className="relative bg-app-card border border-glass-border rounded-2xl w-full max-w-lg p-5 my-8"
        role="dialog"
        aria-modal="true"
        aria-label={p.title({ team: teamName })}
        data-testid="send-back-picker"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 dir="auto" className="font-semibold">{p.title({ team: teamName })}</h3>
            <p className="text-xs text-[--ink-3] mt-1">{p.intro}</p>
          </div>
          <button
            onClick={onClose}
            aria-label={p.cancel}
            title={p.cancel}
            className={`${TAP_TARGET} -me-2 shrink-0 rounded-lg text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2] text-lg leading-none`}
          >
            ✕
          </button>
        </div>

        {!anything && <p className="text-sm text-[--ink-3] py-4">{p.nothingYet}</p>}

        <div className="space-y-4">
          {stages.map((s) => (
            <section key={s.stageId} className="rounded-xl border border-[--rp-border] p-3">
              {s.stageSelectable ? (
                <button
                  type="button"
                  onClick={() => onPick({ kind: 'stage', stageId: s.stageId, title: s.title })}
                  className="w-full min-h-[44px] rounded-lg px-3 text-start text-sm font-semibold text-[--ink-1] bg-[--surface-2] hover:bg-rp-fire/10"
                  data-testid={`send-back-stage-${s.stageId}`}
                >
                  <span dir="auto">{p.wholeStage({ stage: s.title })}</span>
                </button>
              ) : (
                <p dir="auto" className="px-1 text-sm font-semibold text-[--ink-2]">{s.title}</p>
              )}
              <ul className="mt-2 space-y-1">
                {s.missions.map((m) => (
                  <li key={m.taskId}>
                    {m.selectable ? (
                      <button
                        type="button"
                        onClick={() => onPick({ kind: 'task', taskId: m.taskId, title: m.title })}
                        className="w-full min-h-[44px] flex items-center justify-between gap-3 rounded-lg px-3 text-start text-sm hover:bg-[--surface-2]"
                        data-testid={`send-back-task-${m.taskId}`}
                      >
                        <span dir="auto" className="text-[--ink-1]">{m.title}</span>
                        <span className={`text-xs font-medium ${statusTone[m.status]}`}>{statusLabel[m.status]}</span>
                      </button>
                    ) : (
                      // Not a choice: shown so the organizer sees the whole stage, and NOT a
                      // disabled button (a dead control explains nothing).
                      <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span dir="auto" className="text-[--ink-3]">{m.title}</span>
                        <span className={`text-xs ${statusTone[m.status]}`}>{statusLabel[m.status]}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
