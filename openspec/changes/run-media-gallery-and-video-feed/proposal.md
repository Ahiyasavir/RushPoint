## Why

A game manager running a live event has no way to see or download the full set of photos/videos
teams captured — the Run Console's photo panel only shows submissions still `pending` review plus
a text-only list of recently reviewed ones, so anything auto-approved or long since reviewed is
invisible. Separately, the live media feed (`feedItems`) structurally never carries a video: the
two write sites in `functions/src/index.ts` gate on `kind === 'photo'` and drop video (and audio)
submissions on the floor, and even where a video URL exists in review UI, the two feed renderers
(`FeedPanel.tsx` in play-web, `FeedConsole` in creator-web's `RunConsolePage.tsx`) only emit
`<img>`. Managers and participants both lose visibility into video content that was captured.

## What Changes

- Add a **Run Media Gallery** panel to the creator-web Run Console: every photo/video task
  submission for the run (any status — pending, approved, rejected), rendered as thumbnails
  (`<img>`/`<video>`), independent of the review queue's pending/reviewed split.
- Add a **download** action to that gallery: bulk-open/download every media URL for the run (a
  generated list of direct Storage-hosted links opened for save, since the files already live on
  the VPS upload origin and are not proxied through a callable — no new server-side zip pipeline).
- Allow **video submissions** to enter the live `feedItems` feed on the same paths photos already
  do (`submitStationPhoto` autoApprove, `reviewStationSubmission` approve), respecting the existing
  hidden-location exclusion (`shouldFeedTask`). Audio stays excluded — unchanged.
- Add `mediaKind` to the `FeedItem` shared type so feed consumers know whether to render `<img>` or
  `<video>`.
- Render `<video>` (not a bare broken `<img>`) in both `FeedPanel.tsx` (play-web participant/staff
  feed) and `FeedConsole` (creator-web Run Console) when a feed item's `mediaKind` is `video`.

## Capabilities

### New Capabilities
- `run-media-gallery`: the Run Console panel showing all task media for a run (any review status)
  with a bulk-download action.

### Modified Capabilities
- (none — no existing spec named `live-photo-feed` exists yet to modify; the video-in-feed fix is
  covered under `run-media-gallery`'s companion capability below since it's new spec surface, not a
  correction to a previously-specified requirement)

### New Capabilities (cont'd)
- `live-feed-video-support`: feed items can carry video media and both feed renderers display it.

## Impact

- `packages/shared/src/types/index.ts` — `FeedItem` gains `mediaKind?: MediaKind`.
- `functions/src/index.ts` — `writeFeedItem` call sites in `submitStationPhoto` and
  `reviewStationSubmission` accept `kind === 'video'` in addition to `'photo'`, passing
  `mediaKind` through.
- `apps/play-web/src/components/FeedPanel.tsx` — render `<video>` when `mediaKind === 'video'`.
- `apps/creator-web/src/pages/RunConsolePage.tsx` — new `RunMediaGallery` panel/component reading
  all teams' `taskSubmissions`; `FeedConsole` renders `<video>` for video feed items; a download
  action opens/downloads every gathered media URL.
- `apps/creator-web/src/i18n.ts` — new strings for the gallery panel (EN/HE).
- No Firestore rules changes (owner/staff already have read access to team docs and feedItems).
- No new callable — the gallery reads existing `teams` data already fetched by the Run Console;
  download is a client-side action over URLs already present in that data.
