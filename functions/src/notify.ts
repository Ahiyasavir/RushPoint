// Creator notifications, the server side (change: creator-engagement-loop). One writer for every
// item, so every call site gets the same two guarantees:
//   1. Idempotent: the document id comes from `notificationId` (what the item is ABOUT), so a retried
//      callable rewrites the same item, and coalesced kinds (likes, copies) grow a `count` instead of
//      piling up twenty items for one afternoon.
//   2. Best effort: a notification describes an action, it is never part of it. Any failure here is
//      logged and swallowed, so a join, like or finalize can never fail because of it.
import { FieldValue } from 'firebase-admin/firestore';
import { FIRESTORE_PATHS, notificationId, type CreatorNotificationKind, type EventCountdown } from '@rushpoint/shared';
import { db } from './firebase';
import { logBestEffort } from './obs/log';

export interface NotifyInput {
  ownerUid: string;
  kind: CreatorNotificationKind;
  gameId?: string;
  runId?: string;
  taskId?: string;
  milestone?: number;
  day?: string;
  threshold?: EventCountdown;
  params?: Record<string, string | number>;
  /** Coalesced kinds add to `count` rather than replace the item. */
  coalesce?: boolean;
  now?: string;
}

export async function notifyCreator(input: NotifyInput): Promise<void> {
  try {
    if (!input.ownerUid) return;
    const id = notificationId(input.kind, input);
    const createdAt = input.now ?? new Date().toISOString();
    const doc: Record<string, unknown> = { kind: input.kind, createdAt };
    if (input.gameId) doc.gameId = input.gameId;
    if (input.runId) doc.runId = input.runId;
    if (input.params) doc.params = input.params;
    if (input.coalesce) doc.count = FieldValue.increment(1);
    await db.doc(FIRESTORE_PATHS.notification(input.ownerUid, id)).set(doc, { merge: true });
  } catch (e) {
    logBestEffort('notifyCreator', { ownerUid: input.ownerUid, kind: input.kind }, e);
  }
}
