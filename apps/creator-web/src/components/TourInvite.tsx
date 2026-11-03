// The tour invitation (change: tour-invitation). Ahiya, 3.11: a new user gets a notification right
// away that offers the tour. A card on the dashboard for a brand new account; "later" moves the offer
// into the bell, where it stays until the tour is taken or turned down. Who is offered it is the pure
// `tourInviteVerdict`; this file only reads its inputs and draws the answer.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useAuth } from './AuthGate';
import { useT } from './LanguageContext';
import { Icon } from './Icon';
import { Button } from './ui';
import { restartCreatorTour } from './CreatorTour';
import { useGuidanceCandidate, useGuidanceVisible } from './GuidanceProvider';
import {
  TOUR_RECORD_EVENT, TOUR_VERSION, readTourInviteLater, readTourRecord, tourInviteKey,
  tourInviteVerdict, tourStorageKey, writeTourRecord, type TourInviteVerdict,
} from '../lib/creatorOnboarding';

function readLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export interface TourInvite {
  verdict: TourInviteVerdict;
  start: () => void;
  later: () => void;
  /** "No thanks": recorded the way skipping the tour is, so neither the card nor the bell asks again. */
  decline: () => void;
}

export function useTourInvite(): TourInvite {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const createdMs = Date.parse(user?.metadata?.creationTime ?? '');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener(TOUR_RECORD_EVENT, bump);
    window.addEventListener('storage', bump);
    return () => { window.removeEventListener(TOUR_RECORD_EVENT, bump); window.removeEventListener('storage', bump); };
  }, []);

  const verdict = useMemo<TourInviteVerdict>(() => {
    if (!uid) return 'none';
    return tourInviteVerdict({
      record: readTourRecord(readLocal(tourStorageKey(uid))),
      later: readTourInviteLater(readLocal(tourInviteKey(uid))),
      accountCreatedMs: createdMs,
      nowMs: Date.now(),
    });
    // `tick` is the re-read signal: the inputs live in storage, not in React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, createdMs, tick]);

  const later = useCallback(() => {
    try { localStorage.setItem(tourInviteKey(uid), 'later'); } catch { /* storage unavailable */ }
    // The card and the bell each hold this hook; the event tells both, not only the caller.
    window.dispatchEvent(new Event(TOUR_RECORD_EVENT));
  }, [uid]);
  const decline = useCallback(() => {
    try { localStorage.setItem(tourStorageKey(uid), writeTourRecord({ version: TOUR_VERSION, status: 'skipped' })); } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event(TOUR_RECORD_EVENT));
  }, [uid]);
  // Taking the offer from the card counts as "later" too: a creator who closes the tour on its first
  // card still finds it in the bell rather than losing it.
  const start = useCallback(() => { later(); restartCreatorTour(); }, [later]);

  return { verdict, start, later, decline };
}

/** True while any modal dialog is on screen (the new-game wizard, a confirm). */
function useModalOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector('[aria-modal="true"]'));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] });
    return () => mo.disconnect();
  }, []);
  return open;
}

/** The card. Mounted once beside the tour; it takes the screen only when nothing more important has it. */
export default function TourInviteCard() {
  const tour = useT().tour;
  const reduce = useReducedMotion();
  const { verdict, start, later } = useTourInvite();
  const modal = useModalOpen();
  useGuidanceCandidate('tour-invite', verdict === 'card');
  const visible = useGuidanceVisible('tour-invite') && verdict === 'card' && !modal;

  return (
    <AnimatePresence>
      {visible && (
        <motion.section role="dialog" aria-labelledby="rp-tour-invite-title"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0, transition: reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 32, delay: 0.6 } }}
          exit={{ opacity: 0, y: 16, transition: { duration: reduce ? 0 : 0.15 } }}
          className="fixed z-40 bottom-4 inset-x-3 sm:inset-x-auto sm:end-6 sm:bottom-6 sm:w-[360px] rounded-2xl border border-[--rp-border] bg-[--surface-1] shadow-2xl p-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex w-10 h-10 shrink-0 items-center justify-center rounded-full bg-rp-fire/10 text-ink-fire">
              <Icon name="compass" className="w-5 h-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="rp-tour-invite-title" className="font-brand font-bold text-[16px] text-[--ink-1]">{tour.inviteTitle}</h2>
              <p className="mt-1 text-[14px] leading-snug text-[--ink-2]">{tour.inviteBody}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button onClick={start} className="flex-1 min-h-[44px]">{tour.inviteStart}</Button>
            <Button variant="ghost" onClick={later} className="min-h-[44px]">{tour.inviteLater}</Button>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
