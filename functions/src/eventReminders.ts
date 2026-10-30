// The event countdown items (change: creator-engagement-loop): 3 days before, the day before, and the
// day itself, for every game whose creator told us when it is. Run once a day from digest-cron.ts.
// A real date is the one legitimate reason to call a creator back with nothing new in their game,
// and it is THEIR date, so it never reads as the app begging for attention.
//
// Idempotent by construction: the item id is per game per threshold (`notificationId`), so a cron
// that runs twice in a day rewrites the same three documents. Best effort per game: one bad document
// never stops the rest.
import type * as admin from 'firebase-admin';
import { FIRESTORE_PATHS, eventCountdownKind, formatEventReminderEmail, notificationId } from '@rushpoint/shared';

const DAY_MS = 86_400_000;

/** The email half, injected. `send` says whether it really left, so a failed one is tried again tomorrow's run. */
export interface ReminderMail {
  emailOf: (uid: string) => Promise<string | null>;
  send: (composed: { subject: string; text: string; html: string }, to: string) => Promise<boolean>;
}

export async function writeEventReminders(db: admin.firestore.Firestore, now: Date = new Date(), mail?: ReminderMail): Promise<number> {
  const nowIso = now.toISOString();
  // A window a little wider than 3 Israel days either way of UTC; the pure verdict decides exactly.
  const from = new Date(now.getTime() - DAY_MS).toISOString();
  const to = new Date(now.getTime() + 4 * DAY_MS).toISOString();
  const snap = await db.collectionGroup('games').where('eventAt', '>=', from).where('eventAt', '<', to).get();
  let written = 0;
  for (const d of snap.docs) {
    try {
      const g = d.data() as { ownerUid?: string; title?: string; eventAt?: string; deletedAt?: string; isTemplate?: boolean };
      if (!g.ownerUid || !g.eventAt || g.deletedAt || g.isTemplate) continue;
      const when = eventCountdownKind(g.eventAt, nowIso);
      if (!when) continue;
      const id = notificationId('eventSoon', { gameId: d.id, threshold: when });
      const item = db.doc(FIRESTORE_PATHS.notification(g.ownerUid, id));
      await item.set({
        kind: 'eventSoon', createdAt: nowIso, gameId: d.id, params: { game: g.title ?? '', when },
      }, { merge: true });
      written++;
      if (!mail) continue;
      // The stamp is what makes a second cron run send nothing. Only someone who has an address, and has
      // not stopped these in settings.
      if ((await item.get()).data()?.emailedAt) continue;
      if ((await db.doc(FIRESTORE_PATHS.user(g.ownerUid)).get()).data()?.eventEmails === false) continue;
      const to = await mail.emailOf(g.ownerUid);
      if (!to) continue;
      if (await mail.send(formatEventReminderEmail({ title: g.title ?? '', when, gameId: d.id }), to)) {
        await item.set({ emailedAt: nowIso }, { merge: true });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('event reminder failed for', d.ref.path, String(e));
    }
  }
  return written;
}
