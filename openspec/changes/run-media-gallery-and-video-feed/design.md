## Context

`RunConsolePage.tsx` already polls `listRunTeams` every ~5s (state `teams`, each with
`taskSubmissions: Record<string, RawSubmission>` including `photoUrl`/`mediaKind`/`status`) and
also runs a live `teams` collection listener specifically for `PhotoReviewConsole` (see the
"Photo approval queue" comment block, ~line 2103). `PhotoReviewConsole` derives two views from
that same listener: `pending` (via `buildReviewQueueView`, status === 'pending' only) and
`reviewed` (approved/rejected, rendered as a text-only row with no thumbnail). Neither view is
"everything" — an autoApproved photo never passes through `pending`, and `reviewed` intentionally
drops the media itself. There is currently no single place a manager can see every media item.

Separately, `writeFeedItem` (functions/src/index.ts) is called from exactly two sites, both gated
`kind === 'photo'` (submitStationPhoto autoApprove) / `submissionKind === 'photo'`
(reviewStationSubmission approve). `FeedItem` (packages/shared/src/types/index.ts) has no
`mediaKind` field, so even if the gate were loosened, downstream consumers have no way to know
which URL is a video. Both feed renderers (`FeedPanel.tsx`, `FeedConsole` in `RunConsolePage.tsx`)
hardcode `<img src={item.photoUrl}>`.

Media files themselves are hosted on the self-hosted VPS upload origin (not Firebase Storage —
see CLAUDE.md "Firebase plan & storage location"), so URLs are plain HTTPS links; no signed-URL or
Storage SDK download call is needed, an anchor/link suffices.

## Goals / Non-Goals

**Goals:**
- One Run Console panel shows every photo/video task submission for the run, regardless of review
  status, each rendered as a real thumbnail (`<img>` or `<video>`).
- A single action lets the manager retrieve all of that media (opens/downloads each URL — no new
  server-side archival pipeline).
- Videos flow into the live `feedItems` feed the same way photos do today, and both feed renderers
  display them as `<video>`.
- Audio behavior is untouched (still excluded from the feed; already handled correctly in the
  review queue's `Media()`).

**Non-Goals:**
- No new callable, no new Firestore collection, no new index. The gallery reads data already
  fetched by the Run Console.
- No server-side zip/archive generation. "Download" means triggering a browser download per file
  (or opening a list), not a bundled `.zip` — the files already live on a plain HTTPS origin, and a
  server-side zip step would need a new callable + streaming/temp-storage that the VPS origin
  doesn't currently support and this change doesn't need.
- No change to audio task handling, no change to `PhotoReviewConsole`'s existing pending/reviewed
  behavior (it keeps doing exactly what it does — the gallery is additive).
- No change to the hidden-location feed exclusion policy (`shouldFeedTask` keeps gating both photo
  and video the same way it always gated photo).

## Decisions

1. **Gallery reads existing `teams` state already held by `RunConsolePage`, not a new listener.**
   The page already has full `taskSubmissions` per team via its 5s `listRunTeams` poll (state
   `teams`, ~line 252) — the same data `PhotoReviewConsole`'s pending/reviewed split derives from.
   A new `RunMediaGallery` component takes a flattened list of
   `{ teamId, teamName, taskId, taskTitle, photoUrl, mediaKind, status, submittedAt }` built once
   from that same `teams` state (mirroring the flatten `PhotoReviewConsole` already does), rather
   than opening a third listener. Alternative considered: reuse the dedicated `teams` listener
   already running for `PhotoReviewConsole` — rejected because that listener's derived state
   (`pending`/`reviewed`) already excludes approved autoApproved rows from `reviewed`'s intent
   (it's a review-outcome list, not a media list); building a third derived view off the SAME raw
   snapshot the page already computes for that listener is cleaner and reuses more.
2. **Filter to submissions with a renderable `photoUrl`** (`isRenderableMedia`, already exported
   from `photoReviewQueue`/`@rushpoint/shared` and used by `PhotoReviewConsole.Media`), not by
   status. Every status (`pending`, `approved`, `rejected`, or missing) is included — that's the
   entire point of "even ones he did not need to approve."
3. **Download = per-file `<a download>` triggered in a loop, not a zip.** Each gallery card gets a
   direct link to its own URL; a "Download all" button iterates the filtered list and programmatically
   clicks a temporary anchor for each URL in sequence (small delay between clicks so the browser
   doesn't block a burst of downloads as a popup flood). This keeps the feature entirely client-side
   with zero new backend surface, matching the Non-Goals above. Browsers may still prompt/limit
   multi-file downloads; the panel also offers "open all in new tabs" is rejected in favor of
   direct downloads since it's cleaner UX, but the exact button copy should set expectations
   (e.g. "Download all (N)").
4. **`FeedItem.mediaKind?: MediaKind`, default-absent = `'photo'`** for backward compatibility with
   already-written feed docs (mirrors the exact pattern already used for `taskSubmissions[taskId].mediaKind`
   — "An absent mediaKind is a pre-audio-tasks record, which could only have been a photo," per the
   existing comment in `reviewStationSubmission`). `writeFeedItem`'s `entry` param gains an optional
   `mediaKind?: MediaKind` that's written through only when present-and-not-photo, keeping existing
   photo-only call behavior byte-identical when nothing changes.
5. **Loosen the feed gate from `kind === 'photo'` to `kind === 'photo' || kind === 'video'`** at
   both call sites, passing `mediaKind: kind` into `writeFeedItem`'s entry. Audio (`kind === 'audio'`)
   stays excluded — the condition simply adds one more accepted value, it doesn't become an
   allow-everything default, preserving the deliberate allowlist shape called out in the existing
   comments ("tested as an allowlist, not a deny-list").
6. **Feed renderers branch on `mediaKind === 'video'`** using the exact same `<video controls
   playsInline preload="metadata">` pattern already proven in `PhotoReviewConsole.Media()` — no new
   pattern invented, just reused in `FeedPanel.tsx` and `FeedConsole`.

## Risks / Trade-offs

- [Risk] "Download all" triggering N sequential `<a download>` clicks may be blocked or throttled
  by some browsers for large N. → Mitigation: this is a manager-facing power tool, not a
  participant flow; document the limitation in the button's tooltip/i18n string rather than build
  a zip pipeline (explicitly a non-goal). A future change can add server-side zipping if this proves
  insufficient.
- [Risk] Loosening the feed gate to include video could surprise anyone who relied on "feed = photos
  only." → Mitigation: this is exactly what the user requested ("in the media feed the user dont
  see the videos wich is bad please fix it"); the hidden-location exclusion and audio exclusion are
  both preserved, so the only observable change is video now appearing.
- [Risk] The gallery could re-render large media grids on every 5s poll tick, causing jank on a big
  run. → Mitigation: `RunMediaGallery` memoizes its flattened list on the `teams` array reference
  the same way `PhotoReviewConsole` already does with `useMemo`; the poll only replaces `teams`
  when `listRunTeams` returns changed data (existing behavior, not something this change alters).

## Migration Plan

No data migration. `mediaKind` is optional and additive on `FeedItem`; existing feed docs without
it keep rendering as photos exactly as before. Deploy order: functions (writeFeedItem change) can
ship independently of the UI changes since it's additive; UI changes require the shared package
rebuild (`packages/shared` → `functions` prebuild dependency already documented in CLAUDE.md).

## Open Questions

- None blocking; "download all" UX (sequential anchor clicks vs. a simple list of links to
  right-click-save) can be refined during implementation/preview testing.
