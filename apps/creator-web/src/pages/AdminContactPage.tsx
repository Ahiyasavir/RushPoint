// Admin-only list of contact form messages (change: marketing-site).
//
// Not in the primary nav (same treatment as `/admin/users`): reachable only by direct
// URL. Gates its own content on the signed-in user's `admin` custom claim so a non-admin
// never even calls the callable, but the REAL boundary is server-side: listContactMessages
// re-checks `context.auth.token.admin` and writes an auditLogs record for every read.
//
// TEXT, NEVER MARKUP. Every field here was typed by an anonymous stranger into a form on a
// public website, which makes this the single least trustworthy input the product has. It
// is rendered exclusively through React children, never through dangerouslySetInnerHTML,
// and the reply link is built with encodeURIComponent so a crafted address cannot inject
// extra mail headers.
//
// PHONE FIRST, like the other admin page: whoever reads this is usually answering from a
// phone, so a card per message is the primary layout and there is no table at all. A
// message is free text of up to four thousand characters; it was never going to fit a cell.
import { useEffect, useState } from 'react';
import { auth } from '../services/firebase';
import { listContactMessages, type ContactMessage } from '../services/calls';
import { isAdminClaim } from '../lib/adminGate';
import { EmptyState, Badge, Button } from '../components/ui';
import { LoadingState } from '../components/LoadingState';
import { useT } from '../components/LanguageContext';

type GateState = 'checking' | 'denied' | 'allowed';

/**
 * A mailto for replying. `encodeURIComponent` on the subject is not decoration: an
 * unescaped newline in a mailto turns the rest of the string into additional mail
 * headers, and the address came from a stranger.
 */
function replyHref(m: ContactMessage): string {
  return `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(`Re: ${m.name}`)}`;
}

export default function AdminContactPage() {
  const t = useT();
  const tc = t.adminContact;

  const [gate, setGate] = useState<GateState>('checking');
  const [messages, setMessages] = useState<ContactMessage[] | null>(null);
  const [failed, setFailed] = useState(false);

  async function load() {
    setFailed(false);
    try {
      const res = await listContactMessages({ limit: 200 });
      setMessages(res.messages);
    } catch (e) {
      console.error('[adminContact] listContactMessages failed:', e);
      // Keep whatever was already on screen. Replacing a readable list with an
      // error because a refresh failed loses information the reader already had.
      setMessages((prev) => prev ?? []);
      setFailed(true);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const user = auth.currentUser;
      if (!user) { if (!cancelled) setGate('denied'); return; }
      try {
        const token = await user.getIdTokenResult();
        if (cancelled) return;
        if (!isAdminClaim(token.claims as Record<string, unknown>)) { setGate('denied'); return; }
        setGate('allowed');
        await load();
      } catch {
        if (!cancelled) setGate('denied');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (gate === 'checking') return <LoadingState messages={tc.loading} />;

  if (gate === 'denied') {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <EmptyState title={tc.deniedTitle} body={tc.deniedBody} />
      </div>
    );
  }

  if (messages === null) return <LoadingState messages={tc.loading} />;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{tc.title}</h1>
          <p className="text-sm opacity-80 mt-1">{tc.subtitle}</p>
        </div>
        <Button variant="subtle" onClick={() => void load()}>{tc.refreshBtn}</Button>
      </header>

      {failed && <p className="text-sm text-red-500">{tc.loadFailed}</p>}

      {messages.length === 0 ? (
        <EmptyState title={tc.empty} body={tc.emptyHint} />
      ) : (
        <>
          <p className="text-sm opacity-70">{tc.countLabel(messages.length)}</p>
          <ul className="space-y-3">
            {messages.map((m) => (
              <li key={m.id} className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {/* dir="auto" because a sender's name may be Hebrew or Latin. */}
                  <span className="font-semibold" dir="auto">{m.name}</span>
                  <span className="text-sm opacity-70 break-all" dir="ltr">{m.email}</span>
                  {m.language && <Badge color="zinc">{tc.langTag(m.language)}</Badge>}
                  {m.uid && <Badge color="cyan">{tc.signedInTag}</Badge>}
                </div>
                <p className="text-xs opacity-60">
                  {tc.colReceived}: {new Date(m.receivedAt).toLocaleString()}
                </p>
                {/* whitespace-pre-wrap keeps the sender's own line breaks without
                    interpreting anything they wrote. */}
                <p className="text-sm whitespace-pre-wrap break-words" dir="auto">{m.message}</p>
                <a
                  className="inline-block text-sm underline"
                  href={replyHref(m)}
                  rel="noreferrer noopener"
                >
                  {tc.replyBtn}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
