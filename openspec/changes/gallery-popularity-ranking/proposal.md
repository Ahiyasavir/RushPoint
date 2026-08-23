## Why

The public library has no notion of "good". `searchGallery` fetches `db.collection('publicGames').limit(…)`
with **no `orderBy` at all** (`functions/src/gallery/index.ts:40`), and `searchTaskLibrary` does the same
(`:72`). Firestore returns those documents in `__name__` order, so the RushPoint gallery is, in practice,
**sorted by random document id** — a creator browsing it sees whatever games happen to sort first
alphabetically-by-id, not the ones anyone has ever played.

The signals to do better are already being collected and are already on the wire, and nothing reads them:
- `PublicGame.playCount` (`packages/shared/src/types/index.ts:538`) is rendered on the card
  (`GalleryPage.tsx:140`) and is otherwise inert.
- `PublicTask.copyCount` (`types/index.ts:570`) is maintained by a whole dedicated callable
  (`incrementTaskCopyCount`, `gallery/index.ts:92-104`), rendered at `GalleryPage.tsx:165`, and likewise
  never influences what a creator is shown.

Two of those signal paths are also incomplete, which would poison any ranking built on top of them:
- `launchRun` bumps `playCount` on the **private** game doc only (`functions/src/runs/index.ts:320`).
  `duplicateGame` bumps **both** the private doc and `publicGames` (`games/index.ts:376-377`). So the
  public `playCount` a creator sees today counts copies but not actual launches.
- `publishGame` re-`set`s the whole gallery document on every publish, hard-coding `copyCount: 0`
  (`games/index.ts:473`) and overwriting `playCount` from the private doc. Re-publishing a game after an
  edit silently zeroes its task copy counts.

And the only signal a creator can *express* — "this is good" — does not exist at all. There is no like,
no favourite, no rating anywhere in the product.

## What Changes

**The library is ordered best-first.**
- With no search text, the Gallery (public games) and the Task Library (public tasks) are returned
  **most popular first**, by a single stored, orderable popularity score.
- Popularity is a published, unit-tested pure function of real signals: how much the item is actually
  used (game launches + copies; task copies) plus how many creators liked it, on a **logarithmic
  engagement scale with a newness allowance** so that recently published content can out-rank an old
  incumbent without needing to match its lifetime total, and without any scheduled job.

**Creators can say what is good.**
- A signed-in creator can **like** or **unlike** any public game or public task.
- Exactly one like per user per item, enforced by the shape of the data (a deterministic document id),
  not by trusting the client. Toggling is idempotent: a double-fire, a retry, or two tabs racing each
  other can never move the count by more than one.
- Like counts are visible on every gallery card, and the current user's own like state is reflected in
  the UI on first render, not only after they click.

**Search stops being a lottery and does not get worse.**
- With an active search query, **relevance is the primary sort and popularity is the tiebreak within a
  relevance tier** — a title match always outranks a description match no matter how popular the latter
  is. Popularity never demotes a better match.
- The text-search candidate window is widened to the hard per-call cap, so asking for a small `limit`
  no longer shrinks the pool the text filter gets to search.

**The signals it ranks on are repaired.**
- `launchRun` now bumps the public game's play signal too, so "plays" means plays.
- Re-publishing a game **preserves** its accumulated likes and copy counts instead of resetting them.

**New callable:** `setPublicLike` (in `functions/src/gallery/index.ts`, re-exported from
`functions/src/index.ts`, typed wrapper in `apps/creator-web/src/services/calls.ts`). It is a
desired-end-state setter, not a toggle, which is what makes double-firing a provable no-op. It requires
auth and is metered through the existing `enforceRateLimit` wrapper from the `callable-rate-limiting`
change. Being new, it ships RED against the e2e callable coverage guard until its scenario exists.

**Changed callables:** `searchGallery` and `searchTaskLibrary` gain popularity ordering and return the
caller's own `likedIds`; `incrementTaskCopyCount` becomes transactional so it can keep the derived score
consistent with the counter it bumps.

## Non-goals

- **No personalization.** Ranking is global and identical for every viewer. No per-creator affinity, no
  "because you played X", no collaborative filtering.
- **No star ratings, reviews, or comments.** A like is a single bit. No 1-5 scale, no free text.
- **No full-text search engine.** Text matching stays the existing in-memory substring filter over a
  capped candidate window; this change only makes the ordering of that window deterministic and useful.
- **No scheduled/cron recomputation.** The formula is deliberately chosen so a stored score never needs
  to be revisited after the last signal change (see design.md).
- **No moderation, demotion, or ranking penalties.** Reports, takedowns, and negative signals are out of
  scope; the score is monotonic in its inputs.
- **No `play-web` surface.** Participants do not like anything. The public game promo page (`?game=`) is
  untouched.
- **No cross-run analytics change.** `playCount` on the private game doc keeps its existing meaning and
  existing consumers.

## Capabilities

### New Capabilities
- `gallery-popularity-ranking`: The public gallery and task library order results by a stored popularity
  score derived from real usage and likes, with a newness allowance that lets recent content surface,
  and with relevance taking precedence over popularity whenever a search query is active.
- `public-content-likes`: A signed-in creator can like or unlike a public game or public task; the like
  is one-per-user-per-item by construction, idempotent under retry, server-write-only, and its count and
  the caller's own state are readable through the gallery search callables.

### Modified Capabilities
<!-- None. No existing spec in openspec/specs/ describes the gallery, the task library, or publicGames /
     publicTasks ordering, so there is no requirement contract to amend. `input-validation` and
     `authorization` describe cross-cutting rules this change conforms to rather than changes. -->

## Impact

- **Surfaces touched:** `packages/shared` (types + a new pure module) · `functions/` (gallery + games +
  runs callables) · `firestore.rules` · `firestore.indexes.json` · `apps/creator-web` (Gallery page,
  `services/calls.ts`, `i18n.ts`, a new pure `lib/` module). **`apps/play-web` is not touched.**
- **New Firestore collection:** `publicLikes/{kind}_{itemId}_{uid}` — server-write-only, client-read
  denied (like state is served through the callables, so no client query and no extra index).
- **New stored fields:** `likeCount` and `popularity` on `publicGames/{id}` and `publicTasks/{id}`. Both
  optional in the type, so every already-published document keeps working and self-heals on its next
  signal.
- **New composite indexes:** `publicGames (tags CONTAINS, popularity DESC)` and
  `publicTasks (tags CONTAINS, popularity DESC)` — required because tag filtering and popularity
  ordering are now combined. Single-field `popularity DESC` needs no declared index.
- **Rules change:** `publicLikes` denies all client reads and writes; the existing `publicGames` /
  `publicTasks` `allow write: if false` already covers the new counter fields, and a rules test pins
  that a client cannot write `likeCount` or `popularity` directly.
- **Not a Task payload change.** `likeCount` / `popularity` live on the *gallery* documents
  (`PublicTask`), never on a run's `Task`, so `ALLOWED_TASK_KEYS` / `ALLOWED_SMART_KEYS` in
  `scripts/e2e-verify.mjs` are unaffected. This is asserted, not assumed.
- **Risk:** the score is denormalized, so a write that bumps a counter without recomputing the score
  would leave the ordering stale. Mitigated by routing every signal change through one shared helper
  that writes counter and score in the same transaction, and by an e2e assertion that the stored score
  equals the pure function applied to the stored counters.
- **Testing:** the formula, the comparator, and the relevance-vs-popularity ranking are pure and land in
  `packages/shared` with a co-located vitest; the UI like-state derivation lands in
  `apps/creator-web/src/lib/` with a `scripts/test-*.ts`; callable behaviour (like, unlike, double-like,
  second user, unauthenticated, ordering actually changing) lands as a new `scripts/e2e-verify.mjs`
  scenario.
