# Callable unit-test harness

`mockAdmin.ts` is a tiny in-memory Firestore mock for **fast, emulator-free**
unit tests of callable **branch logic** — which `HttpsError` fires, whether a
credit rolled back, whether a guard rejects. Full integration (real Firestore,
custom tokens, end-to-end lifecycle) stays the job of `scripts/e2e-verify.mjs`
(`npm run e2e`).

## When to use which lane

| Want to prove… | Lane |
|---|---|
| A guard/error branch in isolation (bad input → `invalid-argument`, no credit burned) | **unit** — `mockAdmin` + vitest |
| Pure math / sanitizer / predicate | **unit** — co-located `*.test.ts` (no mock needed) |
| The real lifecycle across services | **e2e** — `scripts/e2e-verify.mjs` |
| Firestore security rules | **rules** — `scripts/test-rules.mjs` |

## The pattern (for DI-friendly callables)

The existing v2 callables read a module-level `db`, so they can't be injected
without a refactor (out of scope — see the change's non-goals). **New** callables
should take their data layer as a parameter so they're unit-testable:

```ts
// production: thin onCall wrapper delegates to a pure-ish core
export const doThing = loggedCallable('doThing', (data, context) =>
  doThingCore(db, requireAuth(context), data));

// core: testable — db is injected
export async function doThingCore(db: Db, uid: string, data: unknown) { /* ... */ }
```

```ts
// test
import { makeDb, ctx } from '../testutil/mockAdmin';
test('insufficient credits → failed-precondition', async () => {
  const db = makeDb({ 'wallets/u1': { eventCredits: 0 } });
  await expect(doThingCore(db as any, 'u1', {})).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(db.store.get('wallets/u1')).toMatchObject({ eventCredits: 0 }); // unchanged
});
```

## API

- `makeDb(seed?)` → `{ store, doc(path), runTransaction(fn) }`. `store` is the raw
  `Map<path, data>` — assert against it after the call. `doc(path)` supports
  `get/set/update/delete`; `set` honors `{ merge }`; `update` throws on a missing
  doc (surfaces a bad assumption); `runTransaction` exposes `get/set/update`.
- `ctx(uid?)` → a fake `CallableContext` carrying just `auth.uid`.

Keep the seed minimal — an unseeded path makes the dependency obvious instead of
silently passing.
