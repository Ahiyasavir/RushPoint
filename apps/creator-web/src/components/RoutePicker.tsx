// "Send this team to a mission" (change: route-team-to-mission).
//
// Field report 2026-09-27: pick ANY mission, see EXACTLY what stands in the way, confirm that list
// (and only that list is waived, for this team, this once), and choose "now" or "after the current
// mission". The data is pure (lib/routePicker.ts, the same blockers the server recomputes); this only
// renders it. Same overlay shape as SendBackPicker.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from './LanguageContext';
import { Button } from './ui';
import { TAP_TARGET } from '../lib/interaction';
import type { RouteMission, RouteStage } from '../lib/routePicker';
import type { WaivableKind } from '@rushpoint/shared';

export default function RoutePicker({ teamName, stages, teamBusy, onRoute, onClose }: {
  teamName: string;
  stages: RouteStage[];
  /** The team holds a mission now: offer "now" and "after this mission". */
  teamBusy: boolean;
  onRoute: (taskId: string, accept: WaivableKind[], when: 'now' | 'after') => void;
  onClose: () => void;
}) {
  const t = useT();
  const p = t.runConsole.routePicker;
  const [chosen, setChosen] = useState<RouteMission | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stateLabel = { done: p.stateDone, current: p.stateCurrent, available: p.stateAvailable, blocked: p.stateBlocked, unavailable: p.stateUnavailable } as const;
  const stateTone = { done: 'text-ink-go', current: 'text-[--ink-2]', available: 'text-ink-fire', blocked: 'text-ink-amber', unavailable: 'text-[--ink-4]' } as const;

  function blockerLine(m: RouteMission, kind: WaivableKind): string {
    switch (kind) {
      case 'otherStage': return p.blockOtherStage;
      case 'notReleased': return p.blockNotReleased;
      case 'expired': return p.blockExpired;
      case 'prerequisites': return p.blockPrerequisites({ titles: m.missingTitles.join(', ') });
      case 'stationFull': {
        const b = m.blockers.waivable.find((x) => x.kind === 'stationFull');
        return p.blockStationFull({ count: b && b.kind === 'stationFull' ? b.count : 0, cap: b && b.kind === 'stationFull' ? b.cap : 0 });
      }
    }
  }

  const accept = chosen ? chosen.blockers.waivable.map((b) => b.kind) : [];

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
      <button type="button" aria-label={p.cancel} onClick={onClose} className="absolute inset-0 w-full h-full cursor-default" />
      <div className="relative bg-app-card border border-glass-border rounded-2xl w-full max-w-lg p-5 my-8"
        role="dialog" aria-modal="true" aria-label={p.title({ team: teamName })} data-testid="route-picker">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 dir="auto" className="font-semibold">{p.title({ team: teamName })}</h3>
            <p className="text-xs text-[--ink-3] mt-1">{p.intro}</p>
          </div>
          <button onClick={onClose} aria-label={p.cancel} title={p.cancel}
            className={`${TAP_TARGET} -me-2 shrink-0 rounded-lg text-[--ink-3] hover:text-[--ink-1] hover:bg-[--surface-2] text-lg leading-none`}>
            ✕
          </button>
        </div>

        {chosen ? (
          <div className="space-y-3" data-testid="route-confirm">
            <p dir="auto" className="text-sm font-semibold text-[--ink-1]">{p.sendTo({ title: chosen.title })}</p>
            {accept.length === 0 ? (
              <p className="text-sm text-[--ink-3]">{p.nothingInTheWay}</p>
            ) : (
              <div className="rounded-xl border border-rp-amber/40 bg-rp-amber/5 p-3">
                <p className="text-sm font-semibold text-ink-amber mb-1.5">{p.waiveIntro}</p>
                <ul className="list-disc ps-5 space-y-1 text-sm text-[--ink-2]">
                  {accept.map((k) => <li key={k} dir="auto">{blockerLine(chosen, k)}</li>)}
                </ul>
                <p className="text-xs text-[--ink-3] mt-2">{p.waiveScope}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={() => onRoute(chosen.taskId, accept, 'now')} data-testid="route-now">
                {teamBusy ? p.sendNow : p.send}
              </Button>
              {teamBusy && (
                <Button variant="ghost" onClick={() => onRoute(chosen.taskId, accept, 'after')} data-testid="route-after">
                  {p.sendAfter}
                </Button>
              )}
              <Button variant="subtle" onClick={() => setChosen(null)}>{p.back}</Button>
            </div>
            {teamBusy && <p className="text-xs text-[--ink-3]">{p.nowAfterHelp}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            {stages.map((s) => (
              <section key={s.stageId} className="rounded-xl border border-[--rp-border] p-3">
                <p dir="auto" className="px-1 text-sm font-semibold text-[--ink-2]">{s.title}</p>
                <ul className="mt-2 space-y-1">
                  {s.missions.map((m) => (
                    <li key={m.taskId}>
                      {m.selectable ? (
                        <button type="button" onClick={() => setChosen(m)}
                          className="w-full min-h-[44px] flex items-center justify-between gap-3 rounded-lg px-3 text-start text-sm hover:bg-[--surface-2]"
                          data-testid={`route-task-${m.taskId}`}>
                          <span dir="auto" className="text-[--ink-1]">{m.title}</span>
                          <span className={`text-xs font-medium ${stateTone[m.state]}`}>{stateLabel[m.state]}</span>
                        </button>
                      ) : (
                        // Not a choice, shown so the whole game is visible; never a dead button.
                        <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span dir="auto" className="text-[--ink-3]">{m.title}</span>
                          <span className={`text-xs ${stateTone[m.state]}`}>{stateLabel[m.state]}</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
