import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { Button } from './ui';
import { useT } from './LanguageContext';
import { useAsyncAction } from '../hooks/useAsyncAction';

// Reusable share modal: QR + copyable link + native share sheet. Used to recruit
// players to a game's public promo page before an event, and reusable anywhere a
// link wants sharing.
export function ShareSheet({
  title, text, url, notPublic, onPublish, onClose,
}: {
  title: string;
  text: string;
  url: string;
  notPublic?: boolean;   // game isn't in the gallery yet → the promo link 404s
  onPublish?: () => void | Promise<void>;
  onClose: () => void;
}) {
  const b = useT().builder;
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 220 }).then(setQr).catch(() => setQr(''));
  }, [url]);

  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* no clipboard */ }
  }

  async function nativeShare() {
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) { try { await nav.share({ title, text, url }); } catch { /* cancelled */ } }
    else void copy();
  }

  async function publish() {
    if (!onPublish) return;
    await onPublish();
  }
  // In-flight guard (change: wave-b/async-action-guard): `onPublish` fires the
  // publishGame callable, and the old `publishing` useState flag couldn't stop a
  // second click landing in the same React batch.
  const publishAction = useAsyncAction(publish);
  const publishing = publishAction.busy;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-app-card border border-glass-border rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">✕</button>
        </div>

        {notPublic && (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
            {b.shareNotInGallery}
            {onPublish && (
              <button onClick={() => void publishAction.run()} disabled={publishing}
                className="ms-1 underline hover:text-amber-200 disabled:opacity-50">
                {publishing ? b.sharePublishing : b.sharePublishNow}
              </button>
            )}
          </div>
        )}

        {qr && <img src={qr} alt={b.shareQrAlt} className="mx-auto rounded-lg bg-white p-2 w-44 h-44" />}

        <div className="mt-4 flex items-center gap-2 rounded-lg bg-app-bg border border-glass-border px-3 py-2">
          <span className="text-xs text-zinc-400 truncate flex-1 min-w-0">{url.replace(/^https?:\/\//, '')}</span>
          <button onClick={copy} className="text-xs text-neon-green hover:underline shrink-0">
            {copied ? b.shareCopied : b.shareCopy}
          </button>
        </div>

        <Button className="mt-4 w-full" onClick={nativeShare}>{b.shareBtn}</Button>
      </div>
    </div>,
    document.body,
  );
}

export default ShareSheet;
