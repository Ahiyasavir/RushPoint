import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase.config';
import type { Announcement } from '@rushpoint/shared';

const APP_ID = process.env.EXPO_PUBLIC_RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';

/**
 * Live sync of operational announcements (distinct from gamified flash missions).
 * Returns the active ones, newest first. The admin pushes these via the
 * `pushAnnouncement` callable; they persist until the admin deactivates them, so
 * we only ever load `active === true` (dismissed/old ones never enter the payload).
 * Per-device dismissal is handled by the consumer (localStorage), not here.
 */
export function useAnnouncements(): Announcement[] {
  const [items, setItems] = useState<Announcement[]>([]);

  useEffect(() => {
    const ref = collection(db, `artifacts/${APP_ID}/public/data/announcements`);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Announcement)
          .filter((a) => a.active)
          .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
        setItems(list);
      },
      () => setItems([]),
    );
    return unsub;
  }, []);

  return items;
}
