// Live photo feed (change: live-photo-feed). Approved photos broadcast to the
// whole run, with one tap emoji reaction per participant. Same snapshot pattern
// as LiveOps announcements: server writes, active-only listener, client sort.
// Lazy loaded (React.lazy in PlayScreen) so it stays out of the initial bundle.
import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { FEED_EMOJIS, applyReaction, type FeedItem } from '@rushpoint/shared';
import { db } from '../services/firebase';
import { reactToFeedItem, hideFeedItem } from '../services/calls';
import { useT } from '../i18nContext';
import { dialog } from './dialog';

interface Ctx { ownerUid: string; gameId: string; runId: string }

export default function FeedPanel({
  ctx, myUid, moderate = false,
}: {
  ctx: Ctx;
  myUid: string;
  /** Staff/owner surfaces render a hide affordance on each card. */
  moderate?: boolean;
}) {
  const { t } = useT();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const { ownerUid, gameId, runId } = ctx;

  useEffect(() => {
    const ref = query(
      collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/feedItems`),
      where('active', '==', true),
    );
    return onSnapshot(ref, (snap) => {
      const docs = snap.docs.map((d) => ({ ...(d.data() as FeedItem), id: d.id }));
      docs.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      setItems(docs);
    }, () => setItems([]));
  }, [ownerUid, gameId, runId]);

  async function react(item: FeedItem, emoji: string) {
    // Optimistic: apply the same pure reducer locally; the listener reconciles.
    try {
      const next = applyReaction(item, myUid, emoji);
      if (next.changed) {
        setItems((prev) => prev?.map((it) =>
          it.id === item.id ? { ...it, reactions: next.reactions, reactedBy: next.reactedBy } : it) ?? prev);
      }
      await reactToFeedItem({ ...ctx, itemId: item.id, emoji });
    } catch {
      await dialog.alert(t.feed.feedReactFailed);
    }
  }

  async function hide(item: FeedItem) {
    if (!(await dialog.confirm(t.feed.feedHideConfirm, { danger: true }))) return;
    try {
      await hideFeedItem({ ...ctx, itemId: item.id });
    } catch { /* the listener keeps the card; a retry is one tap away */ }
  }

  if (items === null) {
    return <div className="h-24 rounded-xl bg-app-card border border-glass-border animate-pulse" />;
  }
  if (items.length === 0) {
    return (
      <div dir="auto" className="rounded-xl bg-app-card border border-glass-border px-4 py-6 text-center text-sm text-zinc-500">
        {t.feed.feedEmpty}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const mine = item.reactedBy?.[myUid];
        return (
          <div key={item.id} className="rounded-xl bg-app-card border border-glass-border overflow-hidden">
            <img src={item.photoUrl} alt="" loading="lazy" className="w-full max-h-64 object-cover" />
            <div className="px-3 py-2">
              <div className="flex items-center gap-2">
                <p dir="auto" className="flex-1 min-w-0 truncate text-sm text-zinc-200">
                  {t.feed.feedItemCaption({ team: item.teamName, task: item.taskTitle })}
                </p>
                {moderate && (
                  <button
                    onClick={() => void hide(item)}
                    className="shrink-0 text-xs text-zinc-500 hover:text-danger"
                  >
                    {t.feed.feedHide}
                  </button>
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                {FEED_EMOJIS.map((emoji) => {
                  const count = item.reactions?.[emoji] ?? 0;
                  const selected = mine === emoji;
                  return (
                    <button
                      key={emoji}
                      onClick={() => void react(item, emoji)}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm transition-colors ${
                        selected
                          ? 'bg-accent/15 border-accent/40 text-accent'
                          : 'bg-app-raised border-glass-border text-zinc-400'
                      }`}
                    >
                      <span aria-hidden>{emoji}</span>
                      {count > 0 && <span className="font-mono text-xs">{count}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
