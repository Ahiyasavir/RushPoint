// The player's view of the background media queue (change: background-media-upload, D3).
//
// A quiet pill while approved media is still on its way ("keep the app open"), the browser's own
// leave-page prompt while anything is pending, and ONE visible notice if a file was refused for
// good. Mounted once at the app level, so it keeps showing on the finish screen after the last
// mission. Resumes whatever a reload left behind on mount.
import { useEffect, useState } from 'react';
import { TopOverlay } from './TopOverlays';
import { backgroundMedia, restoreBackgroundMedia } from '../services/backgroundMedia';
import type { BgSnapshot } from '../lib/backgroundMedia';
import { useT } from '../i18nContext';
import { TAP_TARGET } from '../lib/interaction';

export default function BackgroundUploads() {
  const { t } = useT();
  const [snap, setSnap] = useState<BgSnapshot>(() => backgroundMedia.snapshot());

  useEffect(() => {
    const off = backgroundMedia.subscribe(setSnap);
    restoreBackgroundMedia();
    return off;
  }, []);

  useEffect(() => {
    if (snap.pending === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [snap.pending]);

  if (snap.pending === 0 && snap.failed === 0) return null;
  return (
    <TopOverlay kind="backgroundUpload">
      {snap.failed > 0 ? (
        <div className="flex items-center gap-2 rounded-2xl bg-app-card border border-glass-border text-zinc-100 text-xs ps-3 pe-1 py-1 shadow max-w-[92vw]"
          role="alert" data-testid="bg-upload-failed">
          <span dir="auto">⚠️ {t.task.bgFailed}</span>
          <button type="button" onClick={() => backgroundMedia.dismissFailed()} className={`${TAP_TARGET} inline-flex items-center justify-center shrink-0 text-zinc-400`} aria-label={t.task.bgDismiss}>✕</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-full bg-zinc-800/90 text-zinc-100 text-xs px-3 py-1.5 shadow max-w-[92vw]"
          role="status" aria-live="polite" data-testid="bg-uploading">
          <span className="w-3 h-3 shrink-0 rounded-full border-2 border-zinc-400/40 border-t-zinc-100 animate-spin" />
          <span dir="auto">📤 {t.task.bgUploading({ count: snap.pending })}</span>
        </div>
      )}
    </TopOverlay>
  );
}
