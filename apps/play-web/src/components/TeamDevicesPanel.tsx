import { useState } from 'react';
import type { RunTeam } from '@rushpoint/shared';
import { transferController, claimController } from '../services/calls';
import { useT } from '../i18nContext';
import { dialog } from './dialog';
import { useAsyncAction } from '../hooks/useAsyncAction';

// Shared team devices (change: shared-team-devices): every attached phone sees
// the team's device join code (to invite the rest of the team), who is attached,
// and which phone currently controls. The controller can hand control to any
// device; a viewer can take control (confirm-gated) so the team is never stuck
// behind a dead phone. Role changes arrive live via the team-doc snapshot.
export default function TeamDevicesPanel({ team, myUid, ctx, onChanged }: {
  team: RunTeam;
  myUid: string;
  ctx: { ownerUid: string; gameId: string; runId: string };
  onChanged: () => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');

  const controllerUid = team.controllerUid ?? team.id;
  const isController = controllerUid === myUid;
  const devices = team.devices ?? [{ uid: team.id, name: team.displayName, joinedAt: team.updatedAt }];

  async function copyCode() {
    if (!team.deviceJoinCode) return;
    try {
      await navigator.clipboard.writeText(team.deviceJoinCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — the code is still visible on screen */ }
  }

  async function transfer(toUid: string, toName: string) {
    if (!(await dialog.confirm(t.devices.transferTo({ name: toName }), { confirmLabel: t.devices.transferBtn }))) return;
    setErr('');
    try { await transferController({ ...ctx, toUid }); onChanged(); }
    catch { setErr(t.devices.actionFailed); }
  }

  async function takeControl() {
    if (!(await dialog.confirm(t.devices.takeControlConfirm, { confirmLabel: t.devices.takeControl }))) return;
    setErr('');
    try { await claimController(ctx); onChanged(); }
    catch { setErr(t.devices.actionFailed); }
  }

  // In-flight guards (change: wave-b/async-action-guard). These also cover the
  // confirm dialog, so a double tap can no longer stack two confirms — and
  // handing control twice can't race the team into the wrong controller.
  const transferAction = useAsyncAction<[string, string], void>(transfer, (toUid) => toUid);
  const takeControlAction = useAsyncAction(takeControl);
  const busy = transferAction.busy || takeControlAction.busy;

  return (
    <div className="rounded-xl bg-app-card border border-glass-border mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-zinc-300"
      >
        <span className="flex items-center gap-2">📱 {t.devices.panelTitle}</span>
        <span className="text-xs text-zinc-500">{devices.length} {open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {team.deviceJoinCode && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-app-raised px-3 py-2">
              <div>
                <div className="text-[11px] text-zinc-500">{t.devices.inviteHint}</div>
                <div className="font-mono font-bold text-lg tracking-[0.3em] text-zinc-100">{team.deviceJoinCode}</div>
              </div>
              <button onClick={copyCode} className="text-xs font-semibold text-accent hover:underline shrink-0">
                {copied ? t.devices.copied : t.devices.copy}
              </button>
            </div>
          )}

          <ul className="space-y-1.5">
            {devices.map((d) => (
              <li key={d.uid} className="flex items-center justify-between gap-2 text-sm">
                <span dir="auto" className="text-zinc-300 truncate">
                  {d.name || t.devices.deviceFallbackName}
                  {d.uid === myUid && <span className="text-zinc-500 text-xs ms-1">{t.devices.youTag}</span>}
                </span>
                {d.uid === controllerUid ? (
                  <span className="shrink-0 text-[11px] font-bold text-rp-go bg-rp-go/10 border border-rp-go/30 rounded-full px-2 py-0.5">
                    ✏️ {t.devices.controllerBadge}
                  </span>
                ) : isController ? (
                  <button
                    disabled={busy}
                    onClick={() => void transferAction.run(d.uid, d.name || t.devices.deviceFallbackName)}
                    className="shrink-0 text-xs text-accent hover:underline disabled:opacity-40"
                  >
                    {t.devices.transferBtn}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>

          {!isController && (
            <button
              disabled={busy}
              onClick={() => void takeControlAction.run()}
              className="w-full text-sm font-semibold text-accent border border-accent/30 rounded-lg py-2 hover:bg-accent/5 disabled:opacity-40"
            >
              ✏️ {t.devices.takeControl}
            </button>
          )}

          {err && <p className="text-rp-alert text-xs text-center">{err}</p>}
        </div>
      )}
    </div>
  );
}
