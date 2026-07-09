# Design — ceremony-mode

## Data shapes (packages/shared/src/ceremony.ts)

```ts
export interface CeremonyFeedItem {
  taskTitle: string;
  teamName: string;
  photoUrl: string;
  totalReactions: number;
}
export const CEREMONY_FEED_CAP = 20;

// Server-side selection: active items only, ranked by Σ reaction counts desc,
// tie-break createdAt asc (earlier photo wins), capped at n. Pure + shared so the
// server and tests agree byte-for-byte.
pickCeremonyFeed(items: FeedItem[], n = CEREMONY_FEED_CAP): CeremonyFeedItem[]

// Client sequence machine — pure reducer so timing/skip logic is unit-testable:
type CeremonyPhase = 'slideshow' | 'podium3' | 'podium2' | 'podium1' | 'standings';
ceremonyStart(feedCount: number, teamCount: number): CeremonyPhase  // skips empty phases
ceremonyNext(phase: CeremonyPhase, teamCount: number): CeremonyPhase
```
- `feedCount === 0` ⇒ start at the podium; `teamCount < 3` ⇒ start at the highest
  podium step that exists (e.g. 2 teams ⇒ `podium2`); `teamCount === 0` ⇒ `standings`.
- `ceremonyNext` is total (every phase has a successor; `standings` is terminal).

## Server extension (functions/src/runs/index.ts — getPublicLeaderboard)

No new callable. After resolving the run and computing `published`:
```ts
let ceremonyFeed: CeremonyFeedItem[] = [];
if (published) {
  const feedSnap = await db
    .collection(`${FIRESTORE_PATHS.run(c.ownerUid, c.gameId, c.runId)}/feedItems`)
    .get();                              // runs are small; cap applied in memory
  ceremonyFeed = pickCeremonyFeed(feedSnap.docs.map((d) => d.data() as FeedItem));
}
return { ...existing, ceremonyFeed };
```
- Read happens with the Admin SDK inside the callable — the big screen never needs a
  Firestore rules path to `feedItems`, so **no rules change**.
- Gated on `published` exactly like `rankings` — an unpublished run leaks neither
  standings nor photos. Hidden items (`active:false`) are excluded by
  `pickCeremonyFeed`.
- If the run predates `live-photo-feed` (no subcollection), the query returns empty
  and `ceremonyFeed` is `[]` — fully backward compatible. After the 90-day prune the
  items are deleted, so an old board simply skips the slideshow.
- `PublicLeaderboard` wrapper type in `apps/play-web/src/services/calls.ts` gains
  `ceremonyFeed: CeremonyFeedItem[]`.

## Client (apps/play-web)

- **Routing** (`App.tsx`): the existing `?board=<code>` branch also reads
  `params.has('ceremony')`; when set, render lazy `CeremonyScreen` instead of
  `PublicLeaderboardScreen` (MapLibre-style `React.lazy` — confetti/animation code
  stays out of the main bundle).
- **`screens/CeremonyScreen.tsx`** (new):
  - Loads `getPublicLeaderboard({ code })`; while `!published`, shows the same
    holding screen as `TvLeaderboard` and re-polls every 12s (so the operator can
    open it BEFORE publishing and it comes alive on publish — the natural stage cue).
  - Phase machine driven by `ceremonyStart`/`ceremonyNext` + timers: slideshow
    (each photo ~4s, Ken-Burns CSS transform, `dir="auto"` caption
    "teamName · taskTitle"), then podium phases (~5s apart): rank rows animate up
    with CSS `@keyframes` (translate + scale), winner phase fires the confetti.
  - **Confetti**: a `<canvas>` overlay with ~150 requestAnimationFrame particles
    (rects, gravity + drift, branding `primaryColor`-derived palette) — pure canvas,
    no deps; stops after ~8s and cancels on unmount.
  - `standings` phase reuses the ranked-table markup style of `TvLeaderboard`
    (medals, `fmtTime`) — extract or mirror, keeping Tailwind classes static.
  - A tap/click anywhere advances to the next phase early (operator escape hatch).
- **Share hint** (creator-web `RunConsolePage.tsx`): the existing board-link share
  row gains a copy variant appending `&ceremony` (one string, via `t.*`).

## Test strategy
- **Pure (TDD RED→GREEN):** `scripts/test-ceremony.ts` —
  `pickCeremonyFeed`: excludes `active:false`; ranks by total reactions desc;
  tie-break createdAt asc; caps at 20; empty input ⇒ []; strips `reactedBy`/ids
  (output shape is exactly `CeremonyFeedItem`). `ceremonyStart`/`ceremonyNext`:
  full transition table incl. 0-feed, 0/1/2/3+-team starts, `standings` terminal.
- **Callable (e2e):** extend the existing lifecycle/public-leaderboard assertions in
  `scripts/e2e-verify.mjs`: before publish ⇒ `ceremonyFeed` is `[]`; after publish
  (with the live-photo-feed scenario's items present in ITS run) ⇒ `ceremonyFeed`
  non-empty, capped, sorted by `totalReactions` desc, contains no
  `reactedBy`/`active` fields, excludes a hidden item. No new callable ⇒ coverage
  guard list unchanged.
- **UI:** preview `?board=<code>&ceremony` through all phases (incl. the empty-feed
  skip and a 2-team podium); `npm run i18n:check` + `:strict` (new screen).

## Footguns respected
- Published gate is the single reveal control — `ceremonyFeed` computed strictly
  under `if (published)`; nothing new for the authz denial matrix (still just an
  authed call by code).
- Heavy/animated code lazy-loaded; canvas RAF loop cancelled on unmount (long-lived
  projection screens — same lesson as the TvLeaderboard flash timer).
- No writes anywhere — read-only change; run/team docs untouched.
