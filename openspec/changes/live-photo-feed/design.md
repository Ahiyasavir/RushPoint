# Design — live-photo-feed

## Data model

**`FeedItem`** (packages/shared/src/types/index.ts, "Live ops" section):
```ts
export interface FeedItem {
  id: string;
  taskId: string;
  taskTitle: string;         // denormalized from the game doc at approval time
  teamId: string;
  teamName: string;          // denormalized team.displayName
  photoUrl: string;          // already Storage-validated by requireStorageUrl at submit
  reactions: Record<string, number>;   // emoji → count, e.g. { '🔥': 3 }
  reactedBy: Record<string, string>;   // uid → emoji (dedup/switch source of truth)
  active: boolean;           // hideFeedItem sets false; listener filters active==true
  createdAt: string;
}
export const FEED_EMOJIS = ['👍', '😂', '🔥', '😮'] as const;
```
**`Game.photoFeedEnabled?: boolean`** — default true (`!== false` ⇒ enabled), so every
existing game keeps working with the feed on.

**Firestore path** (FIRESTORE_PATHS in packages/shared/src/types/index.ts):
```ts
feedItem:     (ownerUid, gameId, runId, id) => `users/${ownerUid}/games/${gameId}/runs/${runId}/feedItems/${id}`,
feedItemsCol: (ownerUid, gameId, runId)     => `users/${ownerUid}/games/${gameId}/runs/${runId}/feedItems`,
```

## Pure reducer (packages/shared/src/feedReactions.ts)
```ts
applyReaction(item: Pick<FeedItem,'reactions'|'reactedBy'>, uid: string, emoji: string)
  : { reactions; reactedBy; changed: boolean }
```
- Rejects (throws) an emoji outside `FEED_EMOJIS` — server validates before writing.
- First reaction: increment `reactions[emoji]`, set `reactedBy[uid]`.
- Same emoji again: no-op (`changed: false`) — idempotent, never double-counts.
- Different emoji: decrement the old count (floor 0, delete zero keys), increment new.
The callable is a thin transactional shell around this reducer.

## Server enforcement (functions/src/index.ts)

- **Write points** — exactly the two places that call `completeTaskForTeam` for photos:
  1. `submitStationPhoto` autoApprove branch: the game doc is ALREADY fetched (for
     `smart.autoApprove`) — pull `task.title` + `game.photoFeedEnabled` from the same
     snapshot; read `team.displayName` from the team doc; write the feed item after
     `completeTaskForTeam` (plain `.set()` on a fresh doc — no transaction, not needed
     for a brand-new doc, and the hot path stays txn-free per repo lesson).
  2. `reviewStationSubmission` approve branch: add a game-doc read (staff path, not
     hot) for `taskTitle` + the gate, team doc for `teamName`, then the same write.
  - Both paths skip silently when `game.photoFeedEnabled === false` or the task/team
    lookup fails (feed is best-effort; never blocks completion).
  - `photoUrl` is re-used verbatim from `taskSubmissions[taskId].photoUrl` — it was
    validated by `requireStorageUrl` (run/uid-scoped) at submission time.
- **`reactToFeedItem`** (new callable): `requireAuth` → `enforceRateLimit(uid,
  'reactToFeedItem')` (new `RATE_LIMITS` bucket `{ max: 60, windowMs: MIN }`) →
  `resolveCallerTeam` proves run membership (staff/owner also allowed via
  `assertStaffOrOwner` fallback — try participant first) → `db.runTransaction` reads
  the feed item, applies `applyReaction`, writes only if `changed`. Rejects a hidden
  (`active: false`) or missing item with `not-found`; invalid emoji ⇒
  `invalid-argument`.
- **`hideFeedItem`** (new callable): `assertStaffOrOwner(context, ownerUid, runId)` →
  `.update({ active: false, hiddenAt, hiddenBy })` — same shape as
  `deactivateAnnouncement`.
- **`updateGame`** (functions/src/games/index.ts): destructure `photoFeedEnabled`,
  `if (photoFeedEnabled !== undefined) updates.photoFeedEnabled = photoFeedEnabled;`
  (mirrors `allowInstantPlay`).
- **Prune** (functions/src/maintenance/index.ts `pruneRunPII`): fetch
  `${runPath}/feedItems` and include its refs in the `deleteDocsInChunks` batch
  alongside teamLocations/locationTrack (feed items hold photo URLs + team names).
- Re-export both callables from `functions/src/index.ts` (they live there already —
  station domain); typed wrappers in `apps/play-web/src/services/calls.ts`
  (`reactToFeedItem`) and both apps for `hideFeedItem` (staff console + run console).

## Rules (firestore.rules)
Inside the existing `runs/{runId}` block, next to `announcements`:
```
match /feedItems/{docId} {
  allow read:  if isAuthenticated();
  allow write: if false;
}
```
The rules engine cannot conditionally gate reads on `game.photoFeedEnabled`; that is
fine — when the feed is disabled no items are ever written, so there is nothing to
read. Documented in the rules comment.

## UI

- **play-web `FeedPanel`** (new `apps/play-web/src/components/FeedPanel.tsx`,
  `React.lazy` behind a "Feed" toggle button in `PlayScreen`): snapshot listener on
  `feedItemsCol` with `where('active','==',true)` (LiveOps pattern), client-sorted
  `createdAt` desc; each card = photo (`loading="lazy"`), `dir="auto"` team/task line,
  4 emoji buttons with counts; own reaction highlighted (from `reactedBy[myUid]`);
  tap → `reactToFeedItem` (optimistic bump, listener reconciles). Panel hidden when
  the joined game has `photoFeedEnabled === false` (the flag rides the join payload —
  it is not a secret; verify it passes the game sanitizer, add if stripped).
- **Staff/creator hide**: a small "hide" affordance on feed cards in
  `StaffConsole.tsx` / `RunConsolePage.tsx` calling `hideFeedItem`.
- **creator-web Builder**: a settings checkbox "Live photo feed" (default on) writing
  `photoFeedEnabled` through the existing save payload. All strings via `t.*` EN+HE.

## Test strategy
- **Pure (RED→GREEN):** `scripts/test-feed-reactions.ts` — `applyReaction` truth
  table: invalid emoji throws; first react counts; same-emoji idempotent
  (`changed:false`); emoji switch moves the count (old decremented, zero keys
  dropped, never negative); multi-uid counts accumulate. Auto-run by `npm test`.
- **Callable (e2e):** new `live photo feed` scenario in `scripts/e2e-verify.mjs`:
  autoApprove photo → feed item exists with correct
  taskTitle/teamName/photoUrl; staff-reviewed approve → second item;
  `reactToFeedItem` twice with the same emoji ⇒ count stays 1; switch emoji ⇒ counts
  move; invalid emoji rejected; stranger (other-run uid) denied; `hideFeedItem` by
  owner flips `active:false`, by participant denied; `photoFeedEnabled:false` game ⇒
  NO item written on approval; `pruneRunNow` deletes the items. Both new callables
  invoked ⇒ **callable coverage guard stays green**.
- **UI:** preview FeedPanel + Builder toggle; `npm run i18n:check` (+ `:strict` — new UI).

## Footguns respected
- Feed-item creation is a plain create of a NEW doc — no transaction added to the
  photo-approval paths; `completeTaskForTeam` untouched.
- Reaction maps are nested objects written via transaction `update` with a real
  nested object (never dotted `.set({merge})` keys).
- `photoUrl` never re-derived client-side; answer-key secrecy untouched (feed items
  contain no task config).
