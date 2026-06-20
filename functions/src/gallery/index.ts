// ─── Gallery callables ────────────────────────────────────────────────────────
// Public game gallery + task library search.

import * as functions from 'firebase-functions';
import { db } from '../firebase';
import type { PublicGame, PublicTask } from '@rushpoint/shared';

// ─── searchGallery ───────────────────────────────────────────────────────────

export const searchGallery = functions.https.onCall(async (data, _context) => {
  const { query = '', tags = [], limit = 20 } = data as {
    query?: string;
    tags?: string[];
    limit?: number;
  };

  let ref = db.collection('publicGames').limit(Math.min(limit, 50));

  // Tag filter (Firestore array-contains-any, max 10 values)
  if (tags.length > 0) {
    ref = ref.where('tags', 'array-contains-any', tags.slice(0, 10)) as typeof ref;
  }

  const snap = await ref.get();
  let games = snap.docs.map((d) => d.data() as PublicGame);

  // Client-side text filter (Firestore has no full-text search built-in)
  if (query.trim()) {
    const q = query.toLowerCase();
    games = games.filter(
      (g) =>
        g.title.toLowerCase().includes(q) ||
        g.description?.toLowerCase().includes(q) ||
        g.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  return { games };
});


// ─── searchTaskLibrary ────────────────────────────────────────────────────────

export const searchTaskLibrary = functions.https.onCall(async (data, _context) => {
  const { query = '', tags = [], limit = 30 } = data as {
    query?: string;
    tags?: string[];
    limit?: number;
  };

  let ref = db.collection('publicTasks').limit(Math.min(limit, 100));

  if (tags.length > 0) {
    ref = ref.where('tags', 'array-contains-any', tags.slice(0, 10)) as typeof ref;
  }

  const snap = await ref.get();
  let tasks = snap.docs.map((d) => d.data() as PublicTask);

  if (query.trim()) {
    const q = query.toLowerCase();
    tasks = tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q),
    );
  }

  return { tasks };
});


// ─── copyTask ────────────────────────────────────────────────────────────────
// Increment copyCount on a public task when a creator drags it into their game.

export const incrementTaskCopyCount = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { publicTaskId } = data as { publicTaskId: string };
  if (!publicTaskId) throw new functions.https.HttpsError('invalid-argument', 'publicTaskId required');

  const ref = db.doc(`publicTasks/${publicTaskId}`);
  await ref.update({ copyCount: require('firebase-admin').firestore.FieldValue.increment(1) });
  return { ok: true };
});
