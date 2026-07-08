// Team ↔ HQ chat (change: team-hq-chat). One thread doc per team; the participant
// side snapshots exactly ONE doc (its own thread) and sends via the callable — the
// doc is server-write-only. Lazy loaded (React.lazy in PlayScreen) so the listener
// and this bundle only mount when the team opens chat. Any attached device may send.
import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { FIRESTORE_PATHS, CHAT_TEXT_MAX_LEN, type ChatMessage } from '@rushpoint/shared';
import { db } from '../services/firebase';
import { sendTeamChatMessage } from '../services/calls';
import { saveChatSeen } from '../store';
import { useT } from '../i18nContext';

interface Ctx { ownerUid: string; gameId: string; runId: string }

export default function ChatPanel({ ctx, teamId }: { ctx: Ctx; teamId: string }) {
  const { t } = useT();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const { ownerUid, gameId, runId } = ctx;

  // Single-doc listen on this team's thread.
  useEffect(() => {
    const ref = doc(db, FIRESTORE_PATHS.runChat(ownerUid, gameId, runId, teamId));
    return onSnapshot(ref, (snap) => {
      const msgs = (snap.data() as { messages?: ChatMessage[] } | undefined)?.messages ?? [];
      setMessages(msgs);
      // The panel is open while mounted, so anything arriving now is seen.
      saveChatSeen(runId, teamId, msgs.length);
    }, () => setMessages([]));
  }, [ownerUid, gameId, runId, teamId]);

  // Keep the newest message in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const clean = text.trim();
    if (!clean || sending) return;
    setSending(true);
    try {
      await sendTeamChatMessage({ ...ctx, text: clean });
      setText('');
    } catch {
      // The listener reconciles; a retry is one tap away. Keep the text so the
      // player does not lose what they typed.
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
            const hq = m.from === 'hq';
            return (
              <div key={m.id} className={`flex flex-col ${hq ? 'items-start' : 'items-end'}`}>
                <span className="text-[11px] text-zinc-500 mb-0.5">
                  {hq ? t.chat.chatHq : m.senderName}
                </span>
                <div
                  dir="auto"
                  className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${
                    hq
                      ? 'bg-app-raised border border-glass-border text-zinc-200 text-start'
                      : 'bg-accent/15 border border-accent/40 text-zinc-100 text-start'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }}
          maxLength={CHAT_TEXT_MAX_LEN}
          dir="auto"
          disabled={sending}
          placeholder={t.chat.chatPlaceholder}
          className="flex-1 min-w-0 rounded-full bg-app-raised border border-glass-border px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-accent/50 disabled:opacity-50"
        />
        <button
          onClick={() => void send()}
          disabled={sending || !text.trim()}
          className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t.chat.chatSend}
        </button>
      </div>
    </div>
  );
}
