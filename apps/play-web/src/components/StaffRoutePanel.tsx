// "Send this team to a mission", staff app (change: route-team-to-mission, staff half).
//
// Same rule as the organizer's RoutePicker: any mission in the game, EXACTLY what stands in the way,
// confirm that list (only that list is waived, for this team, this once), now or after the current
// mission. The staff app cannot read the game, so the list of blockers comes from the server's own
// dry run (`previewRoute`), the same `routeBlockers` it recomputes on the real call. Inline, not a
// modal, like every other panel on this screen (a phone keyboard reflows the page under a modal).
import { useState } from 'react';
import type { RouteBlockers, WaivableKind } from '@rushpoint/shared';
import { useT } from '../i18nContext';
import { previewRoute, type Ctx } from '../services/calls';
import { staffRouteList, type StaffRouteMission } from '../lib/staffRouteList';

type Preview = { mission: StaffRouteMission; blockers: RouteBlockers; missingTitles: string[]; teamBusy: boolean };

export default function StaffRoutePanel({ ctx, team, outlineStages, busy, onRoute, onDone }: {
  ctx: Ctx;
  team: { id: string; activeTaskId?: string | null; stages?: unknown };
  outlineStages: { id: string; title: string; tasks: { id: string; title: string }[] }[];
  busy: boolean;
  onRoute: (taskId: string, title: string, accept: WaivableKind[], when: 'now' | 'after') => void;
  onDone: () => void;
}) {
  const { t } = useT();
  const r = t.staff.route;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const stages = staffRouteList(outlineStages, team);

  async function pick(m: StaffRouteMission) {
    setChecking(m.taskId);
    setFailed(false);
    try {
      const res = await previewRoute({ ...ctx, teamId: team.id, taskId: m.taskId, dryRun: true });
      setPreview({ mission: m, blockers: res.blockers, missingTitles: res.missingTitles ?? [], teamBusy: res.teamBusy === true });
    } catch {
      setFailed(true);
    } finally {
      setChecking(null);
    }
  }

  function waivableLine(p: Preview, b: RouteBlockers['waivable'][number]): string {
    switch (b.kind) {
      case 'otherStage': return r.blockOtherStage;
      case 'notReleased': return r.blockNotReleased;
      case 'expired': return r.blockExpired;
      case 'prerequisites': return r.blockPrerequisites({ titles: p.missingTitles.join(', ') });
      case 'stationFull': return r.blockStationFull({ count: b.count, cap: b.cap });
    }
  }

  if (preview) {
    const hard = preview.blockers.hard;
    const accept = preview.blockers.waivable.map((b) => b.kind);
    const send = (when: 'now' | 'after') => { onRoute(preview.mission.taskId, preview.mission.title, accept, when); onDone(); };
    return (
      <div className="mt-2.5 pt-2.5 border-t border-glass-border" data-testid="staff-route-confirm">
        <p dir="auto" className="text-sm font-semibold text-zinc-100 mb-2">{r.sendTo({ title: preview.mission.title })}</p>
        {hard.length > 0 ? (
          <div className="rounded-lg border border-danger/40 p-2.5 mb-2">
            <p className="text-xs font-semibold text-danger mb-1">{r.cannot}</p>
            <ul className="list-disc ps-5 text-xs text-zinc-300">
              {hard.map((h) => <li key={h.kind}>{r.hard[h.kind]}</li>)}
            </ul>
          </div>
        ) : accept.length === 0 ? (
          <p className="text-xs text-zinc-400 mb-2">{r.nothing}</p>
        ) : (
          <div className="rounded-lg border border-amber-500/50 p-2.5 mb-2">
            <p className="text-xs font-semibold text-ink-amber mb-1">{r.waiveIntro}</p>
            <ul className="list-disc ps-5 space-y-0.5 text-xs text-zinc-300">
              {preview.blockers.waivable.map((b) => <li key={b.kind} dir="auto">{waivableLine(preview, b)}</li>)}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {hard.length === 0 && (
            <button className="min-h-[44px] px-3 rounded-lg text-xs font-semibold bg-accent text-black disabled:opacity-40"
              disabled={busy} onClick={() => send('now')} data-testid="staff-route-now">
              {preview.teamBusy ? r.now : r.send}
            </button>
          )}
          {hard.length === 0 && preview.teamBusy && (
            <button className="min-h-[44px] px-3 rounded-lg text-xs font-semibold bg-app-raised border border-glass-border text-zinc-200 disabled:opacity-40"
              disabled={busy} onClick={() => send('after')} data-testid="staff-route-after">
              {r.after}
            </button>
          )}
          <button className="min-h-[44px] px-3 rounded-lg text-xs font-medium text-zinc-400" onClick={() => setPreview(null)}>
            {r.back}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2.5 pt-2.5 border-t border-glass-border" data-testid="staff-route-list">
      <div className="text-[13px] text-zinc-500 mb-1.5">{r.pick}</div>
      {failed && <p role="status" className="text-xs text-danger mb-1.5">{r.checkFailed}</p>}
      <div className="flex flex-col gap-2">
        {stages.map((s) => (
          <div key={s.stageId}>
            <p dir="auto" className="text-xs font-semibold text-zinc-400 mb-1">{s.title}</p>
            <div className="flex flex-col gap-1">
              {s.missions.map((m) => m.selectable ? (
                <button key={m.taskId}
                  className="min-h-[44px] px-3 rounded-lg text-xs font-medium bg-app-raised border border-glass-border text-zinc-200 flex items-center justify-between gap-2 text-start disabled:opacity-40"
                  disabled={busy || checking !== null}
                  onClick={() => void pick(m)}
                  data-testid={`staff-route-task-${m.taskId}`}>
                  <span dir="auto" className="truncate">{m.title}</span>
                  {checking === m.taskId && <span className="shrink-0 text-[13px] text-zinc-500">{r.checking}</span>}
                </button>
              ) : (
                // Shown so the whole game is visible; never a dead button.
                <div key={m.taskId} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  <span dir="auto" className="truncate text-zinc-500">{m.title}</span>
                  <span className="shrink-0 text-[13px] text-zinc-500">{m.state === 'done' ? r.stateDone : m.state === 'current' ? r.stateCurrent : ''}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
