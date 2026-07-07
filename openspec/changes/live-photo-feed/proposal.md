## Why

Approved photo submissions are the emotional core of a field game, but today only the
staff reviewer ever sees them — participants get zero shared moment out of a great
team photo. Competitors (Goosechase's activity feed) make the live photo stream the
social heartbeat of the event. All the ingredients already exist: photos are
Storage-validated, approval already flows through exactly two server code paths, and
the announcements collection proves the "server-writes, any-authed-participant
listens" broadcast pattern.

## What Changes

- When a photo submission is **approved** — either by staff (`reviewStationSubmission`
  approve path) or automatically (`submitStationPhoto` with `smart.autoApprove`) — the
  server also writes a compact **feed item** to
  `runs/{runId}/feedItems/{id}`: `{taskTitle, teamName, photoUrl, reactions, active, createdAt}`.
- Participants see a **Feed panel** in the play app (lazy-loaded, newest-first,
  snapshot listener — same pattern as announcements; no read callable needed).
- Participants react with **one of 4 emojis** per item (`👍 😂 🔥 😮`) via a new
  callable **`reactToFeedItem`** — rate-limited, one reaction per uid per item
  (re-reacting switches the emoji, never double-counts). Counts render live.
- Creators/staff can **hide** an item via a new callable **`hideFeedItem`**
  (sets `active: false`; the listener filters like deactivated announcements).
- A creator toggle **`Game.photoFeedEnabled`** (default **true**; `undefined` ⇒ on)
  gates all feed-item writes server-side; the play app hides the Feed panel when off.
- Feed items are added to the **90-day PII prune** (`pruneRunPII`) — they carry photo
  URLs and team names.

## Capabilities

### New Capabilities
- `live-photo-feed`: server-written feed items on both photo-approval paths; the pure
  `applyReaction` reducer; `reactToFeedItem` + `hideFeedItem` callables; the
  `Game.photoFeedEnabled` gate; the play-web Feed panel with live emoji reactions;
  read rule + FIRESTORE_PATHS entries; prune coverage.

## Non-goals

- No comments / free-text on feed items (moderation surface too large for v1).
- No cross-run or public feed — the feed is scoped to one run's authed participants
  (the big-screen selection is the separate `ceremony-mode` change).
- No push notifications on new items — the snapshot listener is the delivery.
- No retroactive back-fill: toggling `photoFeedEnabled` off stops NEW items only;
  existing items are hidden one-by-one via `hideFeedItem` (documented).
- No participant-uploaded feed content outside the existing photo-task flow.

## Surfaces touched

- **shared:** `Game.photoFeedEnabled?`, new `FeedItem` type, `applyReaction` reducer
  (`packages/shared/src/feedReactions.ts`), `FIRESTORE_PATHS.feedItem/feedItemsCol`,
  `RATE_LIMITS.reactToFeedItem`.
- **functions:** feed-item writes in `submitStationPhoto` (autoApprove) +
  `reviewStationSubmission` (approve); **new callables** `reactToFeedItem` and
  `hideFeedItem` (⇒ typed wrappers + e2e scenario, or the coverage guard fails);
  `updateGame` accepts `photoFeedEnabled`; `pruneRunPII` deletes `feedItems`.
- **rules:** `feedItems/{docId}` — `read: isAuthenticated()`, `write: false`
  (identical to `announcements`).
- **play-web:** lazy `FeedPanel` in `PlayScreen` + i18n EN/HE.
- **creator-web:** Builder settings toggle + i18n EN/HE.
- **Tests:** `scripts/test-feed-reactions.ts` (pure); new `live photo feed` e2e
  scenario (both new callables invoked → coverage guard stays green).
