// ─── Gallery callables ────────────────────────────────────────────────────────
// Public game gallery + task library search.

import * as functions from 'firebase-functions';
import { FieldValue } from 'firebase-admin/firestore';
import { loggedCallable } from '../obs/log';
import { enforceRateLimit } from '../rateLimitStore';
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

// The gallery is PUBLIC content, but the callable is not a public firehose: it
// fans out to a ≤50-doc Firestore read per call and was previously reachable by
// anyone on the internet with no auth and no budget. Requiring an auth context
// (anonymous sign-in is enough — participants already have one) gives us a uid
// to meter, which is the only thing that makes a rate limit possible at all.
export const searchGallery = loggedCallable('searchGallery', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  await enforceRateLimit(context.auth.uid, 'searchGallery');

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

// Same reasoning as searchGallery — and a wider blast radius (≤100 docs/call).
export const searchTaskLibrary = loggedCallable('searchTaskLibrary', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  await enforceRateLimit(context.auth.uid, 'searchTaskLibrary');

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

  // NB: `require('firebase-admin')` here threw INTERNAL at runtime — the function
  // bundle is esbuild-built, so a bare CommonJS require of admin isn't resolvable.
  // Use the ESM FieldValue import (as the rest of the codebase does). set/merge so
  // a missing denorm doc self-heals into a copyCount:1 instead of NOT_FOUND-ing.
  const ref = db.doc(`publicTasks/${publicTaskId}`);
  await ref.set({ copyCount: FieldValue.increment(1) }, { merge: true });
  return { ok: true };
});
