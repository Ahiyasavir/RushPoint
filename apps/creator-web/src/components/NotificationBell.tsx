// The bell and its red badge (change: creator-engagement-loop). Ahiya, 29.10: red, the way Instagram
// uses it, for things that bring people back. The badge counts items newer than the creator's last
// look; opening the list stamps `notificationsSeenAt` on their own profile doc (which the rules already
// let them write), so there is no per-item read flag to drift. Items are written only by the server and
// only about real activity on the creator's own games (functions/src/notify.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, limit, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { FIRESTORE_PATHS, badgeLabel, unreadCount, type CreatorNotification } from '@rushpoint/shared';
import { db } from '../services/firebase';
import { useT } from './LanguageContext';
import { Icon } from './Icon';
import { notificationView } from '../lib/notificationView';

const LIST_SIZE = 30;

/** How long ago, as a unit and a whole number (the words come from i18n). */
function agoParts(iso: string): { unit: 'now' | 'minute' | 'hour' | 'day'; n: number } {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return { unit: 'now', n: 0 };
  if (s < 3600) return { unit: 'minute', n: Math.floor(s / 60) };
  if (s < 86_400) return { unit: 'hour', n: Math.floor(s / 3600) };
  return { unit: 'day', n: Math.floor(s / 86_400) };
}

export default function NotificationBell({ uid }: { uid: string }) {
  const tn = useT().notifications;
  const reduce = useReducedMotion();
  const nav = useNavigate();
  const [items, setItems] = useState<CreatorNotification[]>([]);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // What was unread when the list opened: those rows keep their dot while it is open, even though
  // opening already stamped them as seen.
  const [openedSeenAt, setOpenedSeenAt] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(db, FIRESTORE_PATHS.notifications(uid)), orderBy('createdAt', 'desc'), limit(LIST_SIZE));
    const offList = onSnapshot(q, (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CreatorNotification, 'id'>) }))), () => undefined);
    const offMe = onSnapshot(doc(db, FIRESTORE_PATHS.user(uid)), (d) => {
      const v = d.data()?.notificationsSeenAt;
      setSeenAt(typeof v === 'string' ? v : null);
    }, () => undefined);
    return () => { offList(); offMe(); };
  }, [uid]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const unread = unreadCount(items, seenAt);
  const label = badgeLabel(unread);
  const views = useMemo(() => items.map((n) => notificationView(n, tn)).filter((v): v is NonNullable<typeof v> => !!v), [items, tn]);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    setOpenedSeenAt(seenAt);
    setOpen(true);
    if (unread > 0) {
      void setDoc(doc(db, FIRESTORE_PATHS.user(uid)), { notificationsSeenAt: new Date().toISOString() }, { merge: true }).catch(() => undefined);
    }
  };
  const isNew = (createdAt: string) => !openedSeenAt || Date.parse(createdAt) > Date.parse(openedSeenAt);

  return (
    <div ref={box} className="relative">
      <button onClick={toggle} aria-expanded={open} aria-label={label ? tn.openWithCount(unread) : tn.open} title={tn.open}
        className="relative w-10 h-10 rounded-lg flex items-center justify-center text-[--ink-2] hover:text-[--ink-1] hover:bg-[--surface-2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rp-fire/60">
        <Icon name="bell" className="w-[22px] h-[22px]" />
        <AnimatePresence>
          {label && (
            <motion.span key={label} aria-hidden
              initial={reduce ? false : { scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.3, opacity: 0 }}
              transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 600, damping: 14 }}
              className="absolute top-1 end-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rp-badge text-white text-[11px] font-bold leading-[18px] text-center ring-2 ring-[--surface-1] tabular-nums">
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="dialog" aria-label={tn.title}
            initial={reduce ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14 }}
            className="fixed sm:absolute inset-x-3 sm:inset-x-auto top-16 sm:top-12 sm:end-0 z-50 sm:w-[380px] max-h-[70vh] overflow-y-auto rounded-2xl border border-[--rp-border] bg-[--surface-1] shadow-2xl">
            <p className="sticky top-0 bg-[--surface-1] px-4 pt-3.5 pb-2 text-[15px] font-bold">{tn.title}</p>
            {views.length === 0 ? (
              <p className="px-4 pb-4 text-[14px] text-[--ink-2] leading-snug">{tn.empty}</p>
            ) : (
              <ul className="pb-2">
                {views.map((v) => (
                  <li key={v.id}>
                    <button disabled={!v.href} onClick={() => { if (v.href) { setOpen(false); nav(v.href); } }}
                      className="w-full min-h-[56px] flex items-start gap-3 px-4 py-2.5 text-start hover:bg-[--surface-2] disabled:cursor-default transition-colors">
                      <span className="mt-0.5 inline-flex w-9 h-9 shrink-0 items-center justify-center rounded-full bg-rp-fire/10 text-ink-fire"><Icon name={v.icon} className="w-[18px] h-[18px]" /></span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[14px] leading-snug ${isNew(v.createdAt) ? 'font-semibold text-[--ink-1]' : 'text-[--ink-2]'}`} dir="auto">{v.text}</span>
                        <span className="block mt-0.5 text-[12px] text-[--ink-3]">{tn.ago(agoParts(v.createdAt))}</span>
                      </span>
                      {isNew(v.createdAt) && <span aria-label={tn.unread} className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-rp-badge" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
