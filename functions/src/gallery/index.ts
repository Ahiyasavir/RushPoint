// ─── Gallery callables ────────────────────────────────────────────────────────
// Public game gallery + task library search.

import * as functions from 'firebase-functions';
import { loggedCallable } from '../obs/log';
import { db } from '../firebase';
import type { PublicGame, PublicTask } from '@rushpoint/shared';

/**
 * Case-insensitive substring match of `query` against a set of text fields.
 * Undefined-safe: a missing/non-string field is simply skipped (denormalized
 * gallery docs are server-written but must never crash search if one is sparse).
 * An empty/whitespace query matches everything.
 */
export function publicTextMatch(haystacks: Array<string | undefined | null>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystacks.some((h) => typeof h === 'string' && h.toLowerCase().includes(q));
}

// ─── searchGallery ───────────────────────────────────────────────────────────

export const searchGallery = loggedCallable('searchGallery', async (data, _context) => {
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
    games = games.filter((g) => publicTextMatch([g.title, g.description, ...(g.tags ?? [])], query));
  }

  return { games };
});


// ─── searchTaskLibrary ────────────────────────────────────────────────────────

export const searchTaskLibrary = loggedCallable('searchTaskLibrary', async (data, _context) => {
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
    tasks = tasks.filter((t) => publicTextMatch([t.title, t.description], query));
  }

  return { tasks };
});


// ─── copyTask ────────────────────────────────────────────────────────────────
// Increment copyCount on a public task when a creator drags it into their game.

export const incrementTaskCopyCount = loggedCallable('incrementTaskCopyCount', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { publicTaskId } = data as { publicTaskId: string };
  if (!publicTaskId) throw new functions.https.HttpsError('invalid-argument', 'publicTaskId required');

  const ref = db.doc(`publicTasks/${publicTaskId}`);
  await ref.update({ copyCount: require('firebase-admin').firestore.FieldValue.increment(1) });
  return { ok: true };
});
