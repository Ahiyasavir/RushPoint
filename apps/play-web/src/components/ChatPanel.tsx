// Team ↔ HQ chat (change: team-hq-chat). One thread doc per team; the participant
// side snapshots exactly ONE doc (its own thread) and sends via the callable — the
// doc is server-write-only. Lazy loaded (React.lazy in PlayScreen) so the listener
// and this bundle only mount when the team opens chat. Any attached device may send.
import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { FIRESTORE_PATHS, CHAT_TEXT_MAX_LEN, chatMessageSide, chatSeenMarker, type ChatMessage } from '@rushpoint/shared';
import { db, uid } from '../services/firebase';
import { sendTeamChatMessage } from '../services/calls';
import { saveChatSeen } from '../store';
import { useT } from '../i18nContext';

interface Ctx { ownerUid: string; gameId: string; runId: string }

export default function ChatPanel({ ctx, teamId }: { ctx: Ctx; teamId: string }) {
  const { t } = useT();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const { ownerUid, gameId, runId } = ctx;
  const myUid = uid(); // stable for the session; drives own-vs-others attribution

  // Single-doc listen on this team's thread. Firestore tears the listener down on
  // error, and this effect only re-subscribes when its deps change — which they
  // don't for a stable run — so one `unavailable`/token-refresh blip would freeze
  // chat for the rest of the run. On error we fail open (clear the thread) AND
  // schedule a bounded re-subscribe (2s→…→30s cap, always finite), unsubscribing
  // the old listener first so we never stack concurrent ones (change:
  // fix-play-chat-listener-resubscribe).
  useEffect(() => {
    const ref = doc(db, FIRESTORE_PATHS.runChat(ownerUid, gameId, runId, teamId));
    let unsub: (() => void) | undefined;
    let retryTimer: number | undefined;
    let backoff = 2_000;
    let cancelled = false;

    const subscribe = () => {
      if (cancelled) return;
      unsub = onSnapshot(ref, (snap) => {
        backoff = 2_000; // healthy snapshot — reset the backoff
        const msgs = (snap.data() as { messages?: ChatMessage[] } | undefined)?.messages ?? [];
        setMessages(msgs);
        // The panel is open while mounted, so anything arriving now is seen.
        // Marker, not a count (change: team-chat-unread-accuracy).
        saveChatSeen(runId, teamId, chatSeenMarker(msgs));
      }, () => {
        setMessages([]); // fail open — never crash the panel
        unsub?.();
        unsub = undefined;
        if (cancelled) return;
        retryTimer = window.setTimeout(subscribe, backoff);
        backoff = Math.min(backoff * 2, 30_000);
      });
    };
    subscribe();

    return () => {
      cancelled = true;
      unsub?.();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [ownerUid, gameId, runId, teamId]);

  // Keep the newest message in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const clean = text.trim();
    if (!clean || sending) return;
    setSending(true);
    setSendFailed(false);
    try {
      await sendTeamChatMessage({ ...ctx, text: clean });
      setText('');
    } catch {
      // Keep the text so the player does not lose what they typed, AND say so:
      // a silently-kept draft read as "my message just vanished"
      // (change: play-no-silent-failures).
      setSendFailed(true);
    } finally {
      setSending(false);
    }
  }

  if (messages === null) {
    return <div className="h-24 rounded-xl bg-app-raised animate-pulse" />;
  }

  return (
    <div className="flex flex-col gap-2">
      <div ref={listRef} className="max-h-64 overflow-y-auto flex flex-col gap-2 pe-1">
        {messages.length === 0 ? (
          <p dir="auto" className="text-center text-sm text-zinc-500 py-4">{t.chat.chatEmpty}</p>
        ) : (
          messages.map((m) => {
            // Attribute by the message's real author, not a fixed label: my own
            // lines read as me (right-aligned) even when the server stamped them
            // from:'hq' (owner playing their own game); HQ replies read as "המטה";
            // a teammate's line shows the team name. (fix-chat-sender-attribution)
            const side = chatMessageSide(m, myUid);
            const mine = side === 'me';
            const label = side === 'me' ? t.devices.youTag
              : side === 'hq' ? t.chat.chatHq
              : m.senderName;
            return (
              <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                <span className="text-[13px] text-zinc-500 mb-0.5">{label}</span>
                <div
                  dir="auto"
                  className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm text-start ${
                    mine
                      ? 'bg-accent/15 border border-accent/40 text-zinc-100'
                      : 'bg-app-raised border border-glass-border text-zinc-200'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            );
          })
        )}
      </div>
      {sendFailed && (
        <p role="status" aria-live="polite" className="text-xs font-medium text-ink-alert">
          ⚠ {t.chat.sendFailedRetry}
        </p>
      )}
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }}
          maxLength={CHAT_TEXT_MAX_LEN}
          dir="auto"
          disabled={sending}
          aria-label={t.chat.chatPlaceholder}
          placeholder={t.chat.chatPlaceholder}
          className="flex-1 min-w-0 rounded-full bg-app-raised border border-glass-border px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-accent/50 disabled:opacity-50"
        />
        {/* bg-ink-fire, not bg-accent: white on #FF5722 is 3.16:1 (below AA).
            min-h-[44px] because this was a ~36px target, tapped one handed while
            walking, on the team's only channel back to HQ. */}
        <button
          onClick={() => void send()}
          disabled={sending || !text.trim()}
          className="shrink-0 inline-flex items-center justify-center min-h-[44px] rounded-full bg-ink-fire px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t.chat.chatSend}
        </button>
      </div>
    </div>
  );
}
