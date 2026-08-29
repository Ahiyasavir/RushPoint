// Share a game by link, without publishing it (change: game-share-link).
//
// The creator's half of the feature: mint a link, see what it allows and how
// often it has been opened, and turn it off. Everything here is one round trip to
// a callable — the collection behind it is closed to clients in both directions.
//
// Deliberately NOT the existing ShareSheet: that one shares a PUBLIC promo URL
// and offers to publish the game, which is the exact thing this flow exists to
// avoid. It does borrow the same three affordances (QR, copy, native share),
// because a link people send from a phone needs all three.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import type { GameShareLink, ShareLinkRefusal } from '@rushpoint/shared';
import { Button, Spinner } from './ui';
import { useT } from './LanguageContext';
import { dialog } from './dialog';
import { toast } from './toast';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useModalDismiss } from '../hooks/useModalDismiss';
import { createGameShareLink, listGameShareLinks, revokeGameShareLink } from '../services/calls';
import { sharedGamePath } from '../lib/publicCreatorPath';

type LinkRow = GameShareLink & { refusal?: ShareLinkRefusal | null };

/** The absolute URL a recipient opens. Built from the app's own origin + base. */
export function shareLinkUrl(token: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return `${window.location.origin}${base}${sharedGamePath(token)}`;
}

const EXPIRY_CHOICES = [0, 7, 30, 90] as const;

export default function ShareLinkDialog({ gameId, gameTitle, onClose }: {
  gameId: string;
  gameTitle: string;
  onClose: () => void;
}) {
  const t = useT();
  const s = t.share;
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [allowCopy, setAllowCopy] = useState(true);
  const [revealAnswers, setRevealAnswers] = useState(false);
  // Starting a run WRITES into this creator's own account, so unlike the other
  // two switches it is off until they turn it on, and the server refuses on
  // absence rather than on falsity (shareLinkLaunchRefusal).
  const [allowLaunch, setAllowLaunch] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState<number>(0);
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [qr, setQr] = useState('');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  useModalDismiss(onClose);

  async function reload() {
    const { links } = await listGameShareLinks({ gameId });
    setLinks(links);
  }

  useEffect(() => {
    void reload().catch(() => setLinks([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  useEffect(() => {
    if (!qrFor) { setQr(''); return; }
    QRCode.toDataURL(shareLinkUrl(qrFor), { margin: 1, width: 220 }).then(setQr).catch(() => setQr(''));
  }, [qrFor]);

  // In-flight guarded (the same reason ShareSheet guards publish): two clicks in
  // one React batch would mint two links.
  const create = useAsyncAction(async () => {
    try {
      await createGameShareLink({
        gameId,
        allowCopy,
        revealAnswers,
        allowLaunch,
        ...(expiresInDays > 0 ? { expiresInDays } : {}),
      });
      await reload();
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      toast.error(message.includes('active share links') ? s.limitReached : s.error);
    }
  });

  const revoke = useAsyncAction(async (token: string) => {
    const ok = await dialog.confirm(`${s.confirmRevokeTitle}\n\n${s.confirmRevokeBody}`, s.revoke, true);
    if (!ok) return;
    try {
      await revokeGameShareLink({ token });
      await reload();
    } catch { toast.error(s.error); }
  }, (token) => token);

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(shareLinkUrl(token));
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch { /* no clipboard permission — the field below is selectable */ }
  }

  async function nativeShare(token: string) {
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (!nav.share) { void copyLink(token); return; }
    try {
      await nav.share({ title: gameTitle, text: s.shareText({ title: gameTitle }), url: shareLinkUrl(token) });
    } catch { /* the sheet was dismissed */ }
  }

  function stateLabel(link: LinkRow): { text: string; tone: string } {
    if (link.refusal === 'revoked') return { text: s.stateRevoked, tone: 'text-[--ink-3]' };
    if (link.refusal === 'expired') return { text: s.stateExpired, tone: 'text-[--ink-3]' };
    return { text: s.stateActive, tone: 'text-ink-go' };
  }

  const live = (links ?? []).filter((l) => !l.refusal);
  const dead = (links ?? []).filter((l) => !!l.refusal);

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
      {/* The backdrop is a real <button>, not a clickable <div>: click-to-dismiss
          then costs no keyboard trap and no onClick on a non-interactive element,
          and the content below is a SIBLING rather than a child, so no
          stopPropagation is needed to keep a click inside from closing it. */}
      <button type="button" aria-label={s.close} onClick={onClose} className="absolute inset-0 w-full h-full cursor-default" />
      <div
        className="relative bg-app-card border border-glass-border rounded-2xl w-full max-w-lg p-5 my-8"
        role="dialog"
        aria-modal="true"
        aria-label={s.title}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="font-semibold">{s.title}</h3>
            <p className="text-xs text-[--ink-3] mt-1">{s.subtitle}</p>
          </div>
          <button
            onClick={onClose}
            aria-label={s.close}
            title={s.close}
            className="text-[--ink-3] hover:text-[--ink-1] text-lg leading-none shrink-0"
          >
            ✕
          </button>
        </div>

        {/* ── What the next link will allow ── */}
        <div className="rounded-xl border border-[--rp-border] p-3 space-y-3 mb-4">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={allowCopy}
              onChange={(e) => setAllowCopy(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{s.allowCopy}</span>
              <span className="block text-xs text-[--ink-3]">{s.allowCopyHelp}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={revealAnswers}
              onChange={(e) => setRevealAnswers(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{s.revealAnswers}</span>
              <span className="block text-xs text-[--ink-3]">{s.revealAnswersHelp}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={allowLaunch}
              onChange={(e) => setAllowLaunch(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{s.allowLaunch}</span>
              <span className="block text-xs text-[--ink-3]">{s.allowLaunchHelp}</span>
            </span>
          </label>
          <div>
            <div className="text-xs text-[--ink-3] mb-1">{s.expiry}</div>
            <div className="flex flex-wrap gap-1.5">
              {EXPIRY_CHOICES.map((d) => (
                <button
                  key={d}
                  onClick={() => setExpiresInDays(d)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    expiresInDays === d
                      ? 'border-rp-fire/60 bg-rp-fire/10 text-ink-fire'
                      : 'border-[--rp-border] text-[--ink-3] hover:text-[--ink-1]'
                  }`}
                >
                  {d === 0 ? s.expiryNever : s.expiryDays({ n: d })}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={() => void create.run()} loading={create.busy} className="w-full">
            {create.busy ? s.creating : s.createCta}
          </Button>
        </div>

        {/* ── The links that exist ── */}
        <div className="text-xs font-medium text-[--ink-3] mb-2">{s.listTitle}</div>
        {links === null && <Spinner label={s.creating} />}
        {links !== null && links.length === 0 && (
          <p className="text-sm text-[--ink-3]">{s.empty}</p>
        )}

        <ul className="space-y-2">
          {[...live, ...dead].map((link) => {
            const state = stateLabel(link);
            return (
              <li key={link.token} className="rounded-xl border border-[--rp-border] p-3">
                <div className="flex items-center gap-2 flex-wrap text-xs mb-2">
                  <span className={`font-medium ${state.tone}`}>{state.text}</span>
                  {!link.allowCopy && <span className="text-[--ink-3]">· {s.stateCopyOff}</span>}
                  {link.revealAnswers && <span className="text-ink-alert">· {s.stateAnswers}</span>}
                  {link.allowLaunch && <span className="text-ink-go">· {s.stateLaunchOn}</span>}
                  <span className="text-[--ink-3] ms-auto">
                    {s.stats({ views: link.viewCount ?? 0, copies: link.copyCount ?? 0 })}
                  </span>
                </div>

                {!link.refusal && (
                  <>
                    <div
                      className="text-xs text-[--ink-2] break-all bg-[--surface-2] rounded-lg px-2 py-1.5 mb-2 select-all"
                      dir="ltr"
                    >
                      {shareLinkUrl(link.token)}
                    </div>
                    {link.expiresAt && (
                      <div className="text-[11px] text-[--ink-3] mb-2">
                        {s.expiresOn({ date: new Date(link.expiresAt).toLocaleDateString() })}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button variant="subtle" className="text-xs min-h-0 py-1.5" onClick={() => void copyLink(link.token)}>
                        {copiedToken === link.token ? s.copied : s.copyLink}
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-xs min-h-0 py-1.5"
                        onClick={() => setQrFor(qrFor === link.token ? null : link.token)}
                      >
                        {qrFor === link.token ? s.hideQr : s.showQr}
                      </Button>
                      <Button variant="ghost" className="text-xs min-h-0 py-1.5" onClick={() => void nativeShare(link.token)}>
                        {s.menuLabel}
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-xs min-h-0 py-1.5 text-ink-alert ms-auto"
                        loading={revoke.isBusy(link.token)}
                        onClick={() => void revoke.run(link.token)}
                      >
                        {s.revoke}
                      </Button>
                    </div>
                    {qrFor === link.token && qr && (
                      <img src={qr} alt={s.showQr} className="mx-auto mt-3 rounded-lg bg-white p-2 w-[220px] h-[220px]" />
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
