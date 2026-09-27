## Why

Every media complaint from the 2026-09-10 production run of "פעולת פתיחה חבב 1#"
(run `ijI9JMITSf8C9heN1Cwp`, 5 teams, 15 submissions) traces to one 28-line route:
`GET /uploads/*` in `functions/server.js`. Three independent defects there made
participant video effectively unusable, and the organizer could not review what
teams sent him.

The run's own evidence:

- **4 of 7 videos could not be viewed at all.** They were `.webm`, and the route
  declares `.webm` as `audio/webm` while also sending `X-Content-Type-Options:
  nosniff` — so the browser is told "this is audio" and forbidden from correcting
  it. Verified against live production: the served response is
  `Content-Type: audio/webm`, while the stored bytes carry a `V_VP8` **video**
  track. The three `.mp4` submissions worked, because `.mp4` maps correctly. The
  split falls along device lines (Android `MediaRecorder` emits `.webm`, iOS emits
  `.mp4`), which is why it presented as intermittent and undiagnosable in the field.
- **Nothing could be previewed before it fully downloaded.** The route sends no
  `Accept-Ranges` and no `Content-Length`, and ends in a bare
  `fs.createReadStream(fullPath).pipe(res)`. That run's videos were 6.9–14.7 MB
  (68 MB total). Player feedback: *"הסרטונים לא עובדים טוב"*. Organizer behaviour:
  approved submissions without watching them. Player feedback again:
  *"שהמנחה יאשר מהר יותר את המשימות"*.
- **The download button opens a fullscreen player instead of saving the file.**
  The route never sends `Content-Disposition`. Per the HTML spec the `download`
  attribute on `<a>` is ignored cross-origin without it — and media is served from
  `api.rush-point.com` while the console runs on `creator.rush-point.com`. The
  client code is already correct (`apps/creator-web/src/lib/downloadFile.ts`); it is
  defeated purely by the missing header.

The root cause of the first defect is worth stating plainly, because it dictates the
fix: **the upload path already knows the true media type and throws it away.**
`functions/uploadRoute.js` validates the declared `Content-Type` against an
allowlist that distinguishes `audio/webm` from `video/webm`, and even selects the
byte cap from it — then stores only the bytes, and the read path re-guesses the type
from the filename. The `nosniff` comment in `server.js` already documents that these
two can disagree; this change removes the guess rather than the guard.

## What Changes

- **A stored object's served `Content-Type` becomes a fact, not a guess.** Where an
  extension is ambiguous between media kinds — `.webm`, which this product uses for
  both video and audio submissions — the served type is determined by inspecting the
  container's own track declarations rather than by the filename. Unambiguous
  extensions keep using the existing table untouched. Every object already on disk,
  including all four unviewable videos from the run above, is repaired by this with no
  migration, no re-upload and nothing rewritten.
- **Media becomes seekable.** The route advertises `Accept-Ranges: bytes`, honours a
  `Range` request with `206 Partial Content` and a correct `Content-Range`, answers
  an unsatisfiable range with `416`, and always sends `Content-Length`. A `HEAD`
  request advertises the same without a body. A player can start mid-file and show
  real progress instead of waiting for the whole object.
- **Download becomes downloadable.** An explicit opt-in query flag makes the route
  send `Content-Disposition: attachment` with a safe filename. Inline playback in
  the review queue is unaffected, because the flag is opt-in.
- `X-Content-Type-Options: nosniff` **remains on every response**, and the existing
  path-traversal guards are preserved unchanged.

**BREAKING**: none. Every change is additive to the response; no URL, no stored
object and no client call site changes shape. The `download` attribute already
present in `RunMediaGalleryConsole` starts working rather than starting to exist.

## Capabilities

### New Capabilities
- `media-serving`: how the self-hosted API serves a stored media object over HTTP —
  the content type it declares, range/streaming support, download disposition, and
  the security headers that must survive all of it.

### Modified Capabilities
<!-- None. `run-media-gallery` and `photo-review-throughput` describe which media the
     consoles show and how the queue is triaged; neither states a requirement about
     the HTTP response that carries the bytes, so neither changes at spec level. -->

## Impact

- **Surface: the self-hosted VPS API only** — `functions/server.js`, the
  `GET /uploads/*` route and its `EXTENSION_TYPES` table, plus new pure decision
  modules and their test suites. `functions/uploadRoute.js` is **not** modified. No
  callable is added or changed, so no `services/calls.ts` wrapper and no Firestore
  rule moves.
- **No client change is required for the fix to land.** creator-web and play-web
  already request these URLs and already carry a correct `download` attribute; they
  begin working when the server does. (Whether the review queue should also *offer*
  a download action is a separate concern and is out of scope here.)
- **Deployment: this ships by VPS redeploy, not by `deploy:hosting`.** Cloud
  Functions are self-hosted (see CLAUDE.md); a hosting deploy will not move this code.
  The change is not live until the API container is rebuilt on the VPS.
- **Nothing new is stored.** The fix is entirely on the read path, which is
  deliberate: `pruneRunPII` purges run media with
  `storage.bucket().deleteFiles({ prefix })` — a *Firebase Storage* prefix
  (`functions/src/maintenance/index.ts:172`) — while on the VPS the objects live on
  local disk under `UPLOAD_DIR`. Rather than attach a new artifact to a retention path
  whose coverage of disk-stored media is not established, this change adds no artifact
  at all. (Whether disk-stored media is actually reached by the 90-day sweep is a real
  and separate question, raised in Open Questions and deliberately not answered here.)
- **Test lanes**: new pure suites under `scripts/test-*.ts` (auto-discovered by
  `npm test`) for the two decision functions, plus behavioural assertions over a real
  HTTP round trip in `scripts/e2e-verify.mjs`.

## Non-goals

Explicitly **not** in this change, each because it is a separate problem with its own
risk profile:

- **Upload-side video compression** and the native-camera path that today only checks
  a 20 MB ceiling without re-encoding.
- **Resumable / chunked uploads** for flaky field connectivity.
- **Server-generated poster thumbnails** for the review queues.
- **A notification sound** when a submission enters the review queue.
- **Adding a download action to the review queue** (`PhotoReviewConsole` has none
  today; only `RunMediaGalleryConsole` does).
- **Any scoring change.** Nothing here touches points, ranking, or the leaderboard.
- **A CDN or reverse-proxy caching layer** in front of `/uploads`.
