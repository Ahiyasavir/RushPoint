## Context

Today's gallery has no ordering at all (`functions/src/gallery/index.ts:40,72` — a bare `.limit()`),
so results come back in Firestore's `__name__` order. We are adding a real ranking, a new signal
(likes), and the storage + rules to support them. Three things make this non-trivial in this codebase
and each gets an explicit decision below: Firestore can only order by a **stored** field, the signals
have wildly different magnitudes and costs to produce, and a naive cumulative score permanently
entrenches whatever was published first.

---

## Decision 1 — The popularity formula

### The formula

New pure module `packages/shared/src/popularity.ts`:

```
POPULARITY_USE_WEIGHT   = 3
POPULARITY_LIKE_WEIGHT  = 1
POPULARITY_EPOCH_MS     = Date.UTC(2026, 0, 1)   // fixed platform epoch
POPULARITY_DAY_BONUS    = 0.0125                 // 80 days of newness == 10x engagement
POPULARITY_PRECISION    = 6                      // decimals, for stable storage

popularityScore({ uses, likes, createdAtMs }) =
    round6(
      log10(1 + 3*clamp(uses) + 1*clamp(likes))
      + POPULARITY_DAY_BONUS * (clamp(createdAtMs, min=EPOCH) - EPOCH_MS) / 86_400_000
    )
```

`clamp(x)` = `Number.isFinite(x) && x > 0 ? x : 0` (the repo already has this instinct in
`packages/shared/src/sanitizeFinite.ts`; a `NaN` reaching a stored ordering field would be worse than
a wrong order — it would make the document unorderable).

### Why uses and likes are weighted 3:1

A like is one tap by one signed-in creator and costs nothing. A "use" is a real event: a game launch
(someone actually ran this in the physical world) or a copy (someone imported it into their own
builder and intends to run it). They are not interchangeable, so we do not sum them raw. Weighting a
use as **3 likes** says: three people saying "nice" is worth about as much as one person actually
committing. The weights are named exported constants, so the ratio is a one-line, unit-tested policy
change rather than an archaeology exercise.

Per-collection meaning of `uses`:
- `publicGames`: `playCount` (launches + copies — both already accumulate on that field).
- `publicTasks`: `copyCount`.

Both are already `number` fields on the existing types; nothing about their meaning changes.

### Why `log10(1 + weightedEngagement)` and not the raw sum

Raw sums make the ranking a single-item story: a game with 4,000 plays sits 4,000 units above
everything and every distinction below it is numerically invisible next to the newness term, which
would have to be absurdly large to ever matter. `log10` puts engagement on an **order-of-magnitude**
scale — one whole unit per 10x — which is the scale humans actually reason about ("this is ten times
more used"), and it makes the newness term commensurable with it. `1 +` keeps a zero-engagement item
at exactly `0` rather than `-Infinity`.

### How new content surfaces — and why there is no cron

This is the part a cumulative score gets wrong. Two families of solution exist:

1. **Decay** — multiply by `exp(-age/τ)`. Every stored score becomes wrong the instant it is written
   and drifts continuously, so it must be periodically rewritten across the whole collection. That is
   a cron (or a scheduled function) plus a full-collection write amplification. **Rejected.**
2. **A monotonic newness bonus on creation time** (the Hacker News / Reddit "hot" shape). The score is
   `engagement + f(createdAt)` where `f` is strictly increasing in creation time. **Chosen.**

The key property of (2) is that **the score is a constant once computed**. It contains no reference to
"now" — only to the item's own immutable creation timestamp — so it is correct forever and only needs
rewriting when a *signal* changes. Nothing decays; instead, **later content is graded on a curve**. An
item published today starts with a higher baseline than one published last quarter, so it needs only a
fraction of the incumbent's engagement to overtake it. Relative order between two old items is
untouched.

Calibration: `POPULARITY_DAY_BONUS = 0.0125` means 80 days of newness is worth `+1.0`, which on the
`log10` scale is exactly **one order of magnitude of weighted engagement**. Concretely: a game
published today ties an 80-day-old game that has 10x its engagement, and ties a 160-day-old game with
100x. That is aggressive enough that a genuinely good new game reaches the first screen within days,
and conservative enough that a brand-new zero-engagement game does not out-rank a well-loved one from
last month (it needs the *incumbent* to be old, not merely older).

`POPULARITY_EPOCH_MS` is a fixed constant, not "now", specifically so scores computed on different
days remain comparable. The offset is clamped at 0 so a document with a corrupt pre-epoch `createdAt`
scores as pure engagement rather than going negative.

### The comparator

`comparePopularity(a, b)` in the same module, giving a **total** order:
`popularity` desc → `uses` desc → `likes` desc → `id` asc. Firestore's `orderBy('popularity','desc')`
alone is only a partial order and would let equal-scored documents shuffle between calls (breaking
paging); the in-memory pass applies the full comparator to whatever window came back, so the sequence
the creator sees is deterministic. The `id` tiebreak guarantees totality.

**Pure function, one home.** Server ranking (`gallery/index.ts`) and any client display/re-sort both
import from `@rushpoint/shared`. There is no second copy to drift.

---

## Decision 2 — Where the orderable value is stored, and when it is recomputed

### Storage

New optional fields on the existing denormalized gallery documents
(`packages/shared/src/types/index.ts`, `PublicGame` and `PublicTask`):

```ts
likeCount?: number;    // distinct users who have liked this item
popularity?: number;   // popularityScore(...) — the orderable field. SERVER-WRITE-ONLY.
```

Optional, because tens of already-published documents exist without them. Every read path treats
`undefined` as `0`; every write path fills both in. A pre-existing document self-heals the first time
any signal touches it, and until then sorts as a zero-engagement item of its own publication age —
which is correct, not a bug.

Likes themselves live in a **new top-level collection** (Decision 4).

### When it is recomputed — the complete list of writers

Every one of these goes through **one** shared helper, `bumpPublicSignals()` in
`functions/src/gallery/popularityStore.ts`, so no call site can bump a counter and forget the score:

| Trigger | Call site | Delta |
|---|---|---|
| Run launched (not a test drive) | `runs/index.ts:319-321` | `playCount +1` on `publicGames` (**new** — today only the private game doc is bumped) |
| Public game duplicated by another creator | `games/index.ts:377` | `playCount +1` |
| Public task copied | `gallery/index.ts` `incrementTaskCopyCount` | `copyCount +1` |
| Like added / removed | `gallery/index.ts` `setPublicLike` | `likeCount ±1` |
| Game published / re-published | `games/index.ts` `publishGame` | full recompute from preserved counters |

### The race, and why a transaction rather than `FieldValue.increment`

`FieldValue.increment` is the right primitive for a counter and is what the code uses today — it is
atomic and lost-update-free. But `popularity` is **derived**: it cannot be incremented, it has to be
recomputed from the *post-increment* counter, and a read-modify-write around a plain increment is
exactly the lost update the mission warns about. Two concurrent launches would each read
`playCount: 5`, each write `popularity(6)`, and the counter would land on 7 with a score for 6 —
silently wrong ranking, the failure mode that is hardest to notice.

So `bumpPublicSignals()` does the counter and the score **inside one `db.runTransaction`**:

```
runTransaction(async (tx) => {
  const snap = await tx.get(ref);
  if (!snap.exists) return { applied: false };       // not published — nothing to rank
  const d = snap.data();
  const uses  = Math.max(0, (d[useField] ?? 0) + usesDelta);
  const likes = Math.max(0, (d.likeCount ?? 0) + likesDelta);
  tx.update(ref, {
    [useField]: uses,
    likeCount: likes,
    popularity: popularityScore({ uses, likes, createdAtMs: Date.parse(d.createdAt) }),
  });
});
```

Firestore transactions retry on contention, so the read is re-executed against fresh data and the
final counter is exact. This is strictly stronger than the current `increment`, and the cost (one
extra read on a low-frequency path) is irrelevant: these are gallery bumps, not the play hot path.
The repo's own hard-won rule — *never put a transaction in `completeTask`'s hot path*
(`memory: competitive-upgrades-2026-07-05`) — does not apply here; nothing in a live run touches these
documents except one bump at launch.

`update()` with flat top-level keys only: no dotted paths, no `.set({merge})` with a computed key
(the literal-`"a.b"`-field footgun), no array element ever touched.

**Best-effort, never blocking.** All of these bumps stay `.catch(logBestEffort(...))` off the critical
path, exactly like the existing `playCount` increments — a gallery counter must never be able to fail
a run launch.

**Re-publish preserves signals.** `publishGame` currently `batch.set`s a fresh `PublicGame` with
`playCount` copied from the private doc and each `PublicTask` with a hard-coded `copyCount: 0`
(`games/index.ts:439,473`) — re-publishing after an edit today silently wipes every task's copy count.
The publish path will first read the existing public documents and carry forward `likeCount` and
`copyCount`, then compute `popularity` from the preserved values. Without this, likes evaporate on the
next edit-and-publish and the whole feature is a lie.

### Read path (`searchGallery` / `searchTaskLibrary`)

```
const hardCap   = 50 (games) / 100 (tasks)          // unchanged
const wanted    = min(limit, hardCap)
const fetchSize = query.trim() ? hardCap : wanted   // widen the pool when text-filtering
let ref = col.orderBy('popularity', 'desc').limit(fetchSize)
if (tags.length) ref = ref.where('tags', 'array-contains-any', tags.slice(0,10))
```

`orderBy('popularity','desc')` **excludes documents that lack the field**. Since the field is new,
a legacy document would vanish from the gallery — an unacceptable regression. Two mitigations, both
applied: (a) a one-shot backfill in the publish path is not enough, so (b) the query result is
**unioned with a bounded unordered fallback fetch** when the ordered query returns fewer than
`fetchSize` documents, de-duplicated by id, and the union is sorted with `comparePopularity` (which
treats a missing score as 0). This keeps the gallery complete during the rollout and costs one extra
capped read only while legacy documents exist.

---

## Decision 3 — Search versus popularity

**Relevance is primary; popularity is the tiebreak inside a relevance tier.** Making popularity the
primary key with an active query would be a straight downgrade: a creator typing "kotel" would get the
most popular game that happens to mention Kotel in its description above the game actually *called*
"Kotel Hunt".

`rankGalleryResults(items, query, adapt)` in `packages/shared/src/popularity.ts` (pure, unit-tested):

```
relevanceTier(item, q):
  3  title starts with q
  2  title contains q
  1  any other searchable field (description, tags, source game title) contains q
  0  no match          → filtered out entirely
sort by: tier desc, then comparePopularity
```

With an **empty** query every item is tier 0-equivalent and the function degenerates to a pure
`comparePopularity` sort — one code path, two behaviours, one test file.

Two supporting guarantees:
- The existing substring matcher `publicTextMatch` (`gallery/index.ts:17`) stays the definition of
  "matches"; tiering only refines *ordering among matches*. No result that is returned today stops
  being returned.
- **The candidate window is widened, not narrowed.** Today a `limit: 6` request fetches 6 arbitrary
  documents and then text-filters them, so a search can return almost nothing for no good reason.
  With a text query we now fetch the full hard cap (50/100) and trim to `limit` *after* ranking. This
  makes search strictly better, and it is the honest bound: without a real full-text index the capped
  window is the pre-existing limitation, and this change does not pretend otherwise (see Non-goals).

---

## Decision 4 — Likes: data shape, idempotence, and abuse

### One like per user per item, by construction

New top-level collection with a **deterministic composite document id**:

```
publicLikes/{kind}_{itemId}_{uid}      kind ∈ 'game' | 'task'
  { id, kind, itemId, uid, createdAt }
```

Uniqueness is not enforced by a check the server could forget or a client could lie about — it is
enforced by **the address of the document**. A second like from the same user resolves to the same
path, so it is physically impossible to create a second like record. This is the "enforced by data
shape, not by trust" requirement, and it also makes the caller's own like state a **point read by
known id** rather than a query (no index, no `where uid ==`, no fan-out).

New `FIRESTORE_PATHS` entries in `packages/shared/src/types/index.ts` (never a hardcoded string):

```ts
publicLike:    (kind: PublicLikeKind, itemId: string, uid: string) =>
                 `publicLikes/${kind}_${itemId}_${uid}`,
publicLikesCol: () => 'publicLikes',
```

`scripts/test-firestore-paths.ts` gains a case for each (document = even segment count).

### Why a desired-state setter, not a toggle

The callable is `setPublicLike({ kind, itemId, liked })`, not `toggleLike({...})`.

A toggle is *inherently* non-idempotent: a retried request flips twice and lands back where it
started, and two tabs racing produce an unpredictable result. A desired-end-state setter is idempotent
by definition — "make it liked" applied twice is "liked". The transaction computes the delta from
**observed state**, not from the request:

```
runTransaction(tx):
  likeSnap = tx.get(likeRef)
  itemSnap = tx.get(itemRef)          // both reads before any write (Firestore requirement)
  if (!itemSnap.exists) → not-found
  delta = liked && !likeSnap.exists ?  1
        : !liked && likeSnap.exists  ? -1
        : 0                                  // already in the requested state ⇒ NO-OP
  if (delta ===  1) tx.set(likeRef, {...})
  if (delta === -1) tx.delete(likeRef)
  likeCount  = max(0, (itemSnap.likeCount ?? 0) + delta)
  popularity = popularityScore({ uses, likes: likeCount, createdAtMs })
  tx.update(itemRef, { likeCount, popularity })
→ { liked, likeCount }
```

Double-firing cannot double-count because the second call observes `likeSnap.exists === true` and
computes `delta = 0`. Concurrent duplicates are serialized by the transaction (the like document is in
the read set, so a concurrent create forces a retry). `max(0, …)` means the counter can never go
negative even if a like document were removed out of band.

The response returns the authoritative `{ liked, likeCount }` so the UI's optimistic state is
reconciled with the server rather than trusted.

### Abuse

- **Auth required.** `if (!context.auth) throw unauthenticated` — matching the existing gallery
  callables (`gallery/index.ts:31,63`).
- **Metered with the existing wrapper.** `await enforceRateLimit(context.auth.uid, 'setPublicLike')`
  from the `callable-rate-limiting` change (`functions/src/rateLimitStore.ts`), with a new budget in
  `packages/shared/src/rateLimit.ts`: `setPublicLike: { max: 30, windowMs: 60_000 }`. Tighter than the
  60/min browse budgets because a like is a write, generous enough that a creator liking their way
  down a gallery page is never throttled. No bespoke limiter is invented.
- **Residual gap, stated honestly:** an anonymous uid is free to mint, so a determined script can farm
  likes across identities. This is the *same* residual gap the repo already documents for
  `searchGallery` (`rateLimit.ts:95-102`: "treat these as a brake on casual scripting, not a hard
  wall — App Check is the real fix"). Requiring a non-anonymous provider was considered and rejected
  for this change: it is a separate policy decision that would also fence out the e2e suite's
  anonymous identities, and the log-compressed formula already means a farm has to 10x its effort for
  each additional unit of score.
- **Self-likes are permitted.** An owner liking their own game moves the score by `log10` of one like
  — noise. Blocking it costs an owner lookup on every call for no measurable benefit.

---

## Decision 5 — Security rules and indexes

### `firestore.rules`

```
// ── PUBLIC LIKES (server-write-only; like state is served via callables) ──
match /publicLikes/{likeId} {
  allow read:  if false;
  allow write: if false;
}
```

Read is denied too, deliberately: like state reaches the UI through `searchGallery` /
`searchTaskLibrary`, so no client ever needs to query this collection. Denying reads means a scraper
cannot enumerate who liked what — a like is a small piece of personal data, and there is no product
reason to expose the graph.

`publicGames` / `publicTasks` already carry `allow write: if false` (`firestore.rules:173-180`), which
already covers the two new fields — no rules edit needed there. `test:rules` gains cases pinning that
a signed-in client cannot write `likeCount`/`popularity` on a gallery document and cannot touch
`publicLikes`.

### `firestore.indexes.json`

`orderBy('popularity','desc')` alone uses the automatic single-field index — nothing to declare.
Combining the **existing tag filter** with the new ordering does need composite indexes; both are
added:

```json
{ "collectionGroup": "publicGames", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "tags", "arrayConfig": "CONTAINS" },
              { "fieldPath": "popularity", "order": "DESCENDING" } ] },
{ "collectionGroup": "publicTasks", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "tags", "arrayConfig": "CONTAINS" },
              { "fieldPath": "popularity", "order": "DESCENDING" } ] }
```

(The existing `tags + updatedAt` / `tags + createdAt` entries stay; they serve other call sites.)

### Not a sanitizer change

`likeCount` / `popularity` are added to `PublicTask` — the **gallery** document at
`publicTasks/{id}` — and never to `Task`, the run-time object that `sanitizeTaskForParticipant`
processes. `ALLOWED_TASK_KEYS` / `ALLOWED_SMART_KEYS` in `scripts/e2e-verify.mjs` therefore do **not**
change. The e2e scenario asserts this explicitly rather than leaving it to inspection.

---

## Files to touch

**`packages/shared/src`**
- `popularity.ts` **(new)** — `popularityScore`, `comparePopularity`, `relevanceTier`,
  `rankGalleryResults`, the weight/epoch constants, `PublicLikeKind`.
- `popularity.test.ts` **(new)** — co-located vitest.
- `index.ts` — re-export the new module.
- `types/index.ts` — `PublicGame.likeCount/popularity`, `PublicTask.likeCount/popularity`,
  `PublicLike`, `FIRESTORE_PATHS.publicLike` / `.publicLikesCol`.
- `rateLimit.ts` — `setPublicLike` budget.

**`functions/src`**
- `gallery/popularityStore.ts` **(new)** — `bumpPublicSignals()`, the single transactional writer.
- `gallery/index.ts` — ordering + `likedIds` in both search callables; `incrementTaskCopyCount`
  routed through the store; new `setPublicLike` callable.
- `index.ts` — re-export `setPublicLike`.
- `games/index.ts` — `publishGame` preserves `likeCount`/`copyCount` and seeds `popularity`;
  `duplicateGame`'s public bump routed through the store.
- `runs/index.ts` — `launchRun` also bumps the public game's play signal.

**`apps/creator-web/src`**
- `lib/likeState.ts` **(new)** — pure optimistic like-state derivation.
- `services/calls.ts` — `setPublicLike` wrapper; `likedIds` on the two search response types.
- `pages/GalleryPage.tsx` — like control + count on both card types, own-state wiring.
- `i18n.ts` — new `gallery.*` keys in **both** dictionaries.

**Root**
- `firestore.rules`, `firestore.indexes.json`
- `scripts/test-firestore-paths.ts`, `scripts/test-gallery-likes.ts` **(new)**
- `scripts/e2e-verify.mjs` — new scenario
- `scripts/test-rules.mjs` (or the existing rules-test entry point) — new denial cases

---

## Test strategy

Every claim above is proven by one of four lanes. Nothing is "verified by inspection".

**1. Pure logic → co-located vitest, `packages/shared/src/popularity.test.ts` (runs under `npm test`).**
Written FIRST, confirmed failing (module does not exist ⇒ import error, then failing assertions):
- a use is worth exactly 3 likes at equal age;
- 10x weighted engagement ⇒ exactly `+1.0` on the engagement term;
- a zero-engagement item scores exactly its newness offset; zero engagement + epoch age ⇒ `0`;
- an item 80 days newer ties an incumbent with 10x its engagement (the calibration claim);
- the score is time-invariant: computing it twice with different "now" values is identical
  (the no-cron claim, encoded as a test);
- `NaN` / `Infinity` / negative counts / missing `createdAt` all yield a finite number;
- `comparePopularity` is a total order: antisymmetric, transitive over a seeded random sample, and
  never returns 0 for two distinct ids;
- `rankGalleryResults`: title-prefix > title-contains > description-contains regardless of
  popularity; popularity breaks ties inside a tier; non-matches are dropped; an empty query
  degenerates to pure popularity order.

**2. Pure UI logic → `scripts/test-gallery-likes.ts` (tsx aggregator lane).**
`applyOptimisticLike` / `reconcileLike` in `apps/creator-web/src/lib/likeState.ts`: toggling twice
returns to the start; a repeated same-direction toggle is a no-op; the count never goes negative;
a server response always wins over optimistic state.

**3. Callable behaviour → a new `scripts/e2e-verify.mjs` scenario, `gallery popularity + likes`.**
This is the lane that covers the new callable (and satisfies the coverage guard). Assertions:
- `setPublicLike` unauthenticated ⇒ `unauthenticated`; unknown item ⇒ `not-found`;
- like ⇒ `likeCount` 1; **like again ⇒ still 1** (idempotence); unlike ⇒ 0; **unlike again ⇒ 0**
  (no negative);
- 5 concurrent identical likes from one identity ⇒ `likeCount === 1`;
- a second identity likes ⇒ `likeCount === 2`;
- `searchGallery` returns `likedIds` containing the item for the liker and **not** for the
  non-liker, while both see `likeCount === 2`;
- publish two games, drive one to strictly higher engagement, and assert it is returned **first**
  by `searchGallery` — i.e. ordering actually changed, not merely a field appeared;
- the stored `popularity` on the gallery document equals `popularityScore` applied to the stored
  counters (the denormalization-consistency oracle);
- re-publishing a game **preserves** `likeCount` and task `copyCount`;
- `launchRun` bumps the public game's `playCount`;
- the run-time task payload is still allowlist-clean (`assertTaskPayloadAllowlisted`), proving the
  new fields did not leak into `Task`.

**4. Rules → `test:rules`.** A signed-in client cannot write `likeCount`/`popularity` on
`publicGames`/`publicTasks`, and can neither read nor write `publicLikes`.

**5. UI → `npm run i18n:check` + `npm run i18n:check:strict`.** Baseline is captured clean before any
edit; every new string goes through `t.gallery.*` in both dictionaries (Hebrew must be real Hebrew),
and the change must add **zero** PART B findings. Visual verification is the preview tools.

**Gate set at the end:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run i18n:check` ·
`npm run i18n:check:strict` · `npm run creator:build` · `npm run play:build` · `npm run e2e` ·
`npm run test:rules`.
