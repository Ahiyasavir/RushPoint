// Live photo feed (change: live-photo-feed). Approved photos broadcast to the
// whole run, with one tap emoji reaction per participant. Same snapshot pattern
// as LiveOps announcements: server writes, active-only listener, client sort.
// Lazy loaded (React.lazy in PlayScreen) so it stays out of the initial bundle.
//
// UGC safety (change: feed-ugc-safety):
//  - every card carries a Report control (closed reason set, server-validated)
//    and a "mute this team" control;
//  - mute is DEVICE-LOCAL: a run-scoped localStorage key, never a Firestore
//    write, applied as a filter AFTER the snapshot so it works offline;
//  - reporting mutes the item optimistically, before/regardless of the callable
//    resolving, so the reporter's own suppression never depends on the network;
//  - in `moderate` mode the listener drops the `active == true` clause so staff
//    can see (and restore) hidden items. The participant listener is unchanged.
import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  FEED_EMOJIS, FEED_REPORT_REASONS, applyReaction,
  EMPTY_FEED_MUTE, addMutedItem, addMutedTeam, isFeedItemMuted,
  parseFeedMute, serializeFeedMute,
  type FeedItem, type FeedMuteState, type FeedReportReason,
} from '@rushpoint/shared';
import { db } from '../services/firebase';
import { reactToFeedItem, hideFeedItem, reportFeedItem } from '../services/calls';
import { useT } from '../i18nContext';
import { dialog } from './dialog';

interface Ctx { ownerUid: string; gameId: string; runId: string }

/** Run-scoped so a mute never leaks across unrelated events. */
const muteKey = (runId: string) => `rp.feedMute.${runId}`;

function loadMute(runId: string): FeedMuteState {
  try {
    return parseFeedMute(window.localStorage.getItem(muteKey(runId)));
  } catch {
    return EMPTY_FEED_MUTE; // private mode / storage disabled — never white-screen
  }
}

function saveMute(runId: string, state: FeedMuteState): void {
  try {
    window.localStorage.setItem(muteKey(runId), serializeFeedMute(state));
  } catch { /* storage unavailable — the in-memory state still suppresses */ }
}

/** Reason value → the i18n key holding its localized label. */
const REASON_LABEL_KEY = {
  inappropriate: 'feedReasonInappropriate',
  harassment: 'feedReasonHarassment',
  privacy: 'feedReasonPrivacy',
  other: 'feedReasonOther',
} as const;

export default function FeedPanel({
  ctx, myUid, moderate = false,
}: {
  ctx: Ctx;
  myUid: string;
  /** Staff/owner surfaces see hidden items and render hide/restore affordances. */
  moderate?: boolean;
}) {
  const { t } = useT();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [mute, setMute] = useState<FeedMuteState>(EMPTY_FEED_MUTE);
  const [reportFor, setReportFor] = useState<FeedItem | null>(null);
  const { ownerUid, gameId, runId } = ctx;

  useEffect(() => { setMute(loadMute(runId)); }, [runId]);

  useEffect(() => {
    const base = collection(db, `users/${ownerUid}/games/${gameId}/runs/${runId}/feedItems`);
    // Moderation view drops the active filter (rules already let staff/owner read
    // hidden docs); the participant listener keeps `active == true` exactly as-is.
    const ref = moderate ? query(base) : query(base, where('active', '==', true));
    return onSnapshot(ref, (snap) => {
      const docs = snap.docs.map((d) => ({ ...(d.data() as FeedItem), id: d.id }));
      docs.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      setItems(docs);
    }, () => setItems([]));
  }, [ownerUid, gameId, runId, moderate]);

  function persistMute(next: FeedMuteState) {
    setMute(next);
    saveMute(runId, next);
  }

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

  async function restore(item: FeedItem) {
    if (!(await dialog.confirm(t.feed.feedRestoreConfirm))) return;
    try {
      await hideFeedItem({ ...ctx, itemId: item.id, restore: true });
    } catch { /* the listener keeps the card as hidden; retry is one tap away */ }
  }

  async function report(item: FeedItem, reason: FeedReportReason) {
    setReportFor(null);
    // Suppress locally FIRST and persist — the reporter must stop seeing the
    // content immediately, even offline and even though the global auto-hide
    // threshold is 2 distinct teams.
    persistMute(addMutedItem(mute, item.id));
    try {
      const res = await reportFeedItem({ ...ctx, itemId: item.id, reason });
      await dialog.alert(res.hidden ? t.feed.feedReportRemoved : t.feed.feedReportDone);
    } catch {
      await dialog.alert(t.feed.feedReportFailed);
    }
  }

  async function muteTeam(item: FeedItem) {
    if (!(await dialog.confirm(t.feed.feedMuteTeamConfirm({ team: item.teamName })))) return;
    persistMute(addMutedTeam(mute, item.teamId));
  }

  if (items === null) {
    return <div className="h-24 rounded-xl bg-app-card border border-glass-border animate-pulse" />;
  }

  // Device-local mute is applied AFTER the snapshot (never in the query, never
  // in Firestore) and only in the participant view — staff must still see
  // everything they are moderating.
  const visible = moderate ? items : items.filter((it) => !isFeedItemMuted(mute, it));
  const mutedCount = items.length - visible.length;

  const undoRow = mutedCount > 0 ? (
    <div className="flex items-center gap-2 text-xs text-zinc-500">
      <span dir="auto" className="flex-1 min-w-0">{t.feed.feedMutedNote({ n: mutedCount })}</span>
      <button
        onClick={() => persistMute(EMPTY_FEED_MUTE)}
        className="shrink-0 font-semibold text-ink-fire hover:underline"
      >
        {t.feed.feedMuteUndo}
      </button>
    </div>
  ) : null;

  if (visible.length === 0) {
    return (
      <div className="space-y-3">
        <div dir="auto" className="rounded-xl bg-app-card border border-glass-border px-4 py-6 text-center text-sm text-zinc-500">
          {t.feed.feedEmpty}
        </div>
        {undoRow}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {undoRow}
      {visible.map((item) => {
        const mine = item.reactedBy?.[myUid];
        const isHidden = item.active === false;
        const reportCount = item.reportCount ?? 0;
        const reasons = Array.from(new Set(Object.values(item.reportedBy ?? {})))
          .filter((r): r is FeedReportReason => (FEED_REPORT_REASONS as readonly string[]).includes(r))
          .map((r) => t.feed[REASON_LABEL_KEY[r]])
          .join(' · ');
        return (
          <div
            key={item.id}
            className={`rounded-xl bg-app-card border overflow-hidden ${
              isHidden ? 'border-danger/50 opacity-70' : 'border-glass-border'
            }`}
          >
            <img src={item.photoUrl} alt="" loading="lazy" className="w-full max-h-64 object-cover" />
            <div className="px-3 py-2">
              <div className="flex items-center gap-2">
                <p dir="auto" className="flex-1 min-w-0 truncate text-sm text-zinc-200">
                  {t.feed.feedItemCaption({ team: item.teamName, task: item.taskTitle })}
                </p>
                {moderate ? (
                  isHidden ? (
                    <button
                      onClick={() => void restore(item)}
                      className="shrink-0 text-xs font-semibold text-ink-fire hover:underline"
                    >
                      {t.feed.feedRestore}
                    </button>
                  ) : (
                    <button
                      onClick={() => void hide(item)}
                      className="shrink-0 text-xs text-zinc-500 hover:text-danger"
                    >
                      {t.feed.feedHide}
                    </button>
                  )
                ) : (
                  <>
                    <button
                      onClick={() => void muteTeam(item)}
                      aria-label={t.feed.feedMuteTeamAria({ team: item.teamName })}
                      className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      {t.feed.feedMuteTeam}
                    </button>
                    <button
                      onClick={() => setReportFor(item)}
                      aria-label={t.feed.feedReportAria({ team: item.teamName })}
                      className="shrink-0 text-xs text-zinc-500 hover:text-danger"
                    >
                      {t.feed.feedReport}
                    </button>
                  </>
                )}
              </div>

              {moderate && (isHidden || reportCount > 0) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                  {isHidden && (
                    <span className="rounded-full bg-danger/15 border border-danger/40 px-2 py-0.5 font-semibold text-danger">
                      {item.hiddenBy === 'auto:reports' ? t.feed.feedAutoHidden : t.feed.feedHiddenBadge}
                    </span>
                  )}
                  {reportCount > 0 && (
                    <span className="rounded-full bg-app-raised border border-glass-border px-2 py-0.5 text-zinc-400">
                      {t.feed.feedReportCountLabel({ n: reportCount })}
                    </span>
                  )}
                  {reasons && (
                    <span dir="auto" className="text-zinc-500">
                      {t.feed.feedReasonSummary({ reasons })}
                    </span>
                  )}
                </div>
              )}

              <div className="mt-1.5 flex items-center gap-1.5">
                {FEED_EMOJIS.map((emoji) => {
                  const count = item.reactions?.[emoji] ?? 0;
                  const selected = mine === emoji;
                  return (
                    <button
                      key={emoji}
                      onClick={() => void react(item, emoji)}
                      aria-label={t.feed.feedReactAria({ emoji })}
                      aria-pressed={selected}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm transition-colors ${
                        selected
                          ? 'bg-accent/15 border-accent/40 text-ink-fire'
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

      {reportFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-app-card border border-glass-border p-5 space-y-3">
            <p className="text-base font-bold text-zinc-100 text-center">{t.feed.feedReportTitle}</p>
            <p className="text-sm text-zinc-400 text-center">{t.feed.feedReportPrompt}</p>
            <div className="space-y-2">
              {FEED_REPORT_REASONS.map((reason) => (
                <button
                  key={reason}
                  onClick={() => void report(reportFor, reason)}
                  className="w-full rounded-xl bg-app-raised border border-glass-border px-4 py-3 text-start text-sm font-semibold text-zinc-200 hover:border-danger/50"
                >
                  {t.feed[REASON_LABEL_KEY[reason]]}
                </button>
              ))}
            </div>
            <button
              onClick={() => setReportFor(null)}
              className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-zinc-500 hover:text-zinc-300"
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
