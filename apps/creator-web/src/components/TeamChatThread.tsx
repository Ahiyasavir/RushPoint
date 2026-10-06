import { useState } from 'react';
import { CHAT_TEXT_MAX_LEN, hqSenderLabel, type ChatMessage } from '@rushpoint/shared';
import { useT } from './LanguageContext';
import { Button, Input } from './ui';
import { runActionVariant } from '../lib/runConsoleActions';

// One team's HQ chat thread: the messages and a reply box (change: team-hq-chat;
// team-dossier-and-search 2.6). Shared by the console's chat panel and the team page, so the two
// can never render a thread differently or send through different paths. A failed send keeps the
// draft for a retry; `onSend` is expected to surface its own failure.
export default function TeamChatThread({ messages, onSend, maxHeightClass = 'max-h-56' }: {
  messages: ChatMessage[];
  onSend: (text: string) => Promise<boolean>;
  maxHeightClass?: string;
}) {
  const rc = useT().runConsole;
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    const clean = draft.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      if (await onSend(clean)) setDraft('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {messages.length > 0 && (
        <div className={`${maxHeightClass} overflow-y-auto flex flex-col gap-1.5`}>
          {messages.map((m) => (
            <div key={m.id} className={`flex flex-col ${m.from === 'hq' ? 'items-end' : 'items-start'}`}>
              <span className="text-[13px] text-[--ink-3]">{m.from === 'hq' ? hqSenderLabel(m.senderName, rc.chatHq) : m.senderName}</span>
              <div dir="auto" className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm text-start ${m.from === 'hq' ? 'bg-neon-blue/15 border border-neon-blue/40 text-[--ink-1]' : 'bg-app-card border border-[--rp-border] text-[--ink-2]'}`}>{m.text}</div>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }}
          maxLength={CHAT_TEXT_MAX_LEN}
          dir="auto"
          disabled={busy}
          placeholder={rc.chatReplyPlaceholder}
          className="flex-1"
        />
        <Button variant={runActionVariant('sendChatReply')} onClick={() => void send()} disabled={busy || !draft.trim()}>
          {rc.chatSend}
        </Button>
      </div>
    </div>
  );
}
