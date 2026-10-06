// The flash mission a team took (change: flash-missions-v2).
//
// Shown INSTEAD of the team's mission while `team.flashSuspension` is set: the mission they were on
// is suspended on the server (its clock does not run) and comes back when they finish or give up
// this one, or when the organizers end it. Done with a button, a photo or a video, as the organizer
// chose. The server decides everything; this only renders and sends.
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, uploadTaskPhoto, uploadTaskVideo } from '../services/firebase';
import { submitFlashMission, releaseFlashMission } from '../services/calls';
import { useT } from '../i18nContext';
import { Button, Card } from './ui';
import type { FlashMissionDoc } from '@rushpoint/shared';
import { Icon } from './Icon';
import { listenWithRetry } from '../lib/liveListen';

type Ctx = { ownerUid: string; gameId: string; runId: string };

export default function FlashRunner({ ctx, flashId, lang, onChanged, readOnly }: {
  ctx: Ctx;
  flashId: string;
  lang: 'he' | 'en';
  onChanged: () => void;
  /** A teammate's phone that is not the one answering: it sees the mission, it cannot send. */
  readOnly?: boolean;
}) {
  const { t } = useT();
  const f = t.flash;
  const [flash, setFlash] = useState<(FlashMissionDoc & { title?: string; titleHe?: string; description?: string; descriptionHe?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // The countdown lives here now, not in the live strip above (which skips the flash
  // this team is on, so the screen says it once). Ticks once a second while mounted.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Comes back after an error (issue 27): a dropped listener left the flash card frozen.
  useEffect(() => listenWithRetry('flashMission', (h) => onSnapshot(
    doc(db, `users/${ctx.ownerUid}/games/${ctx.gameId}/runs/${ctx.runId}/flashMissions/${flashId}`),
    (snap) => { h.healthy(); setFlash(snap.exists() ? (snap.data() as FlashMissionDoc) : null); },
    h.failed,
  )), [ctx.ownerUid, ctx.gameId, ctx.runId, flashId]);

  const title = flash ? (lang === 'he' && flash.titleHe ? flash.titleHe : flash.title) : '';
  const desc = flash ? (lang === 'he' && flash.descriptionHe ? flash.descriptionHe : flash.description) : '';

  async function send(file?: File) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      let mediaUrl: string | undefined;
      if (file && flash?.doneBy === 'photo') {
        mediaUrl = await uploadTaskPhoto(file, { runId: ctx.runId, taskId: `flash-${flashId}` });
      } else if (file && flash?.doneBy === 'video') {
        mediaUrl = (await uploadTaskVideo(file, { runId: ctx.runId, taskId: `flash-${flashId}`, contentType: file.type })).url;
      }
      const res = await submitFlashMission({ ...ctx, flashId, ...(mediaUrl ? { mediaUrl } : {}) });
      setMsg(res.approved ? f.doneApproved : f.doneWaiting);
      onChanged();
    } catch {
      setMsg(f.sendFailed);
    } finally {
      setBusy(false);
    }
  }
  async function giveUp() {
    if (busy) return;
    setBusy(true);
    try { await releaseFlashMission({ ...ctx, flashId }); onChanged(); }
    catch { setMsg(f.sendFailed); }
    finally { setBusy(false); }
  }

  return (
    <Card className="p-5 border-2 border-purple-400/60" data-testid="flash-runner">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-xs font-bold uppercase tracking-widest text-purple-700 inline-flex items-center gap-1"><Icon name="bolt" className="w-3.5 h-3.5" />{f.badge}</div>
        {flash?.expiresAt && (() => {
          const secs = Math.max(0, Math.round((new Date(flash.expiresAt).getTime() - now) / 1000));
          return (
            <span className="text-xs font-mono text-purple-700 shrink-0" data-testid="flash-runner-countdown" dir="ltr">
              {String(Math.floor(secs / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')}
            </span>
          );
        })()}
      </div>
      <h2 dir="auto" className="text-2xl font-bold mb-2">{title}</h2>
      {desc && <p dir="auto" className="text-base text-zinc-300 leading-relaxed mb-2">{desc}</p>}
      {(flash?.bonusPoints ?? 0) > 0 && <p className="text-sm font-semibold text-ink-fire mb-3">+{flash?.bonusPoints} {f.points}</p>}
      <p className="text-[13px] text-zinc-500 mb-4">{f.missionWaits}</p>
      {readOnly ? (
        <p className="text-sm text-zinc-400">{f.otherPhoneSends}</p>
      ) : (
        <div className="space-y-2">
          {flash?.doneBy === 'button' && (
            <Button loading={busy} onClick={() => void send()} data-testid="flash-done">{f.done}</Button>
          )}
          {(flash?.doneBy === 'photo' || flash?.doneBy === 'video') && (
            <label className="block">
              <span className="sr-only">{flash.doneBy === 'photo' ? f.takePhoto : f.takeVideo}</span>
              <span className="inline-flex w-full items-center justify-center min-h-[48px] rounded-xl bg-gradient-to-r from-rp-fire to-rp-amber text-white font-bold cursor-pointer">
                {busy ? f.sending : flash.doneBy === 'photo' ? f.takePhoto : f.takeVideo}
              </span>
              <input type="file" className="hidden" disabled={busy}
                accept={flash.doneBy === 'photo' ? 'image/*' : 'video/*'} capture="environment"
                onChange={(e) => { const file = e.target.files?.[0]; if (file) void send(file); e.target.value = ''; }} />
            </label>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => void giveUp()} data-testid="flash-give-up">{f.giveUp}</Button>
        </div>
      )}
      {msg && <p role="status" className="mt-3 text-sm text-zinc-300">{msg}</p>}
    </Card>
  );
}
