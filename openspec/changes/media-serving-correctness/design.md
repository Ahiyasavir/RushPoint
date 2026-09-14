## Context

`functions/server.js` is the self-hosted VPS API (Cloud Functions run on a fixed-cost
VPS; Auth/Firestore stay on Firebase). Among the callables it mounts, it also serves
stored media directly off local disk:

```js
app.get(/^\/uploads\/(.+)$/, (req, res) => {
  // … `..` rejection, UPLOAD_DIR containment check, existsSync …
  const ct = EXTENSION_TYPES[ext] || 'application/octet-stream';
  res.set('Content-Type', ct);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.set('Access-Control-Allow-Origin', '*');
  fs.createReadStream(fullPath).pipe(res);            // ← whole object, always
});
```

Three defects live in those closing lines, all diagnosed from run
`ijI9JMITSf8C9heN1Cwp` (2026-09-10, 5 teams, 15 submissions, 68 MB of media). See
`proposal.md` for the evidence; this document is about how to fix them.

**Current state worth stating precisely**, because it constrains the design:

- `EXTENSION_TYPES` maps `'.webm' → 'audio/webm'`, but `uploadRoute.js`'s
  `ALLOWED_CONTENT_TYPES` accepts `audio/webm` **and** `video/webm`. Both land on
  disk with a `.webm` name. **The extension genuinely cannot distinguish them**, and
  `nosniff` — correctly — stops the browser from second-guessing us.
- The upload path *did* know the truth: it validated the declared `Content-Type` and
  even picked the byte cap from it (`PARTICIPANT_VIDEO_TYPES`). It then stored only
  the bytes. The information was available and discarded.
- Objects are immutable once written (`Cache-Control: immutable`), and are deleted by
  prefix (`fs.promises.rm(fullPath, { recursive: true, force: true })`).
- Media is cross-origin from both consoles: served from the API origin, consumed by
  `creator.rush-point.com` and the participant host.

## Goals / Non-Goals

**Goals:**

- A `.webm` video is declared `video/webm` and a `.webm` audio recording stays
  `audio/webm`, decided from the object rather than from its name.
- Media already on disk is repaired without migration, re-upload, or operator action.
- Video is seekable: `Range` → `206`, correct `Content-Range`, `Accept-Ranges`,
  `Content-Length`, `416` when unsatisfiable, and a useful `HEAD`.
- The existing `download` attribute in `RunMediaGalleryConsole` starts working, via an
  opt-in `Content-Disposition: attachment`, without disturbing inline playback.
- All decision logic is pure and unit-tested; the route stays thin I/O.

**Non-Goals:**

- Upload-side compression, resumable uploads, poster thumbnails, a review-queue
  notification sound, a download button in the review queue, any scoring change, a CDN
  (all enumerated in `proposal.md` § Non-goals).
- Changing `uploadRoute.js`. It is correct; it is simply not consulted on read.
- Fixing the retention question raised in Open Questions.

## Decisions

### D1 — Detect from bytes on read, rather than persist the validated type on write

**Chosen:** resolve an ambiguous extension by inspecting a bounded prefix of the
stored file.

**Alternative considered — persist the validated `Content-Type` at upload time** (a
sidecar file, or a per-directory manifest) and replay it on read. This is arguably the
more principled fix, since it restores information the write path already had rather
than re-deriving it, and it would cost no read I/O.

**Why rejected, for now:**

1. **Retention.** `pruneRunPII` deletes run media via
   `storage.bucket().deleteFiles({ prefix: runPhotoPrefix(runId) })` —
   a *Firebase Storage* bucket prefix (`functions/src/maintenance/index.ts:167-176`) —
   while in the VPS topology the objects sit on local disk under `UPLOAD_DIR`.
   Attaching a new per-object artifact to a retention path whose coverage of
   disk-stored media is not established risks creating a record of a participant's
   media that outlives the media. Adding nothing cannot leak anything.
2. **It does not repair history.** Persisting on write fixes future uploads only; the
   four broken videos from the run that motivated this change would still need a
   byte-inspection fallback. That fallback is therefore required either way — and once
   it exists, persistence is an optimisation, not a correctness mechanism.
3. **Blast radius.** Persistence touches the write path, the delete paths and the
   storage layout. Detection touches one read route. This change is meant to ship
   today.

**Revisit when** the disk-retention question is answered; persistence then becomes a
clean performance follow-up with a known-correct deletion story.

### D2 — Inspect the container, not a magic-byte guess

`.webm` is EBML/Matroska. A video track is declared by a `CodecID` element whose value
is `V_VP8` / `V_VP9` / `V_AV1`; an audio-only recording declares only `A_OPUS` /
`A_VORBIS`. Scanning a bounded leading prefix for a video `CodecID` marker is
sufficient, and was verified against the real production artefacts from the run: the
14.7 MB `.webm` submission contains `V_VP8` and `A_OPUS`, the `.mp4` submissions are
unaffected.

**Alternative considered — shell out to `ffprobe`.** Rejected: it adds a binary
dependency to the API image, spawns a process per request, and is far more capability
than "is there a video track in the first N KB".

**Bound:** read at most a fixed prefix (start at 64 KB; the marker appears in the
Tracks element near the head of the file). If no video marker is found in that prefix,
the result is *inconclusive*, not *audio* — and inconclusive falls back to the
extension table, preserving today's behaviour exactly. This makes the change
**strictly additive**: it can only ever upgrade a `.webm` from audio to video, never
the reverse.

**Only ambiguous extensions are inspected.** `.jpg`, `.png`, `.mp4` and the rest skip
inspection entirely and cost nothing.

### D3 — Three pure modules, one thin route

Mirrors the existing `scripts/lib/bundleBudget.mjs` /
`buildArtifactGuard.mjs` / `backendOriginGuard.mjs` pattern: decisions are pure and
unit-tested, I/O is dumb.

| Module | Responsibility | Purity |
|---|---|---|
| `functions/lib/mediaContentType.js` | `(filename, bytePrefix) → content type`; owns `EXTENSION_TYPES`, the ambiguous-extension set, and the container probe | pure; takes a `Buffer`, no `fs` |
| `functions/lib/rangeRequest.js` | `(rangeHeader, totalBytes) → {status:200\|206\|416, start, end}` | pure; total; never throws |
| `functions/lib/contentDisposition.js` | `(filename) → sanitized attachment header value` | pure; total |

Exact directory to be confirmed at apply time — these must sit where the VPS image
already ships them and where a `scripts/test-*.ts` can import them (see Risks).

The route becomes: guards (unchanged) → `statSync` for size → read prefix only if the
extension is ambiguous → resolve type → range decision → set headers → stream the
chosen byte window.

### D4 — `Content-Disposition` is opt-in via a query flag

`?download=1` sets `Content-Disposition: attachment`. Absent, no such header is sent.

**Why opt-in:** the same URL is used for inline `<video>`/`<img>` rendering in
`PhotoReviewConsole` and the gallery. Sending `attachment` unconditionally would turn
every review thumbnail into a download prompt. The gallery's existing
`<a href={row.photoUrl} download={...}>` simply appends the flag.

**Header-injection guard:** the filename is attacker-influenced (participants control
upload filenames within the IDOR-guarded prefix). CR, LF, `"` and other control
characters are stripped before emission; a name that sanitizes to empty falls back to
a constant. This is why it is its own pure, tested function rather than a template
literal at the call site.

### D5 — Caching does not need to change

Objects are already `immutable`. Adding `Accept-Ranges` and varying on `Range` is
standard and needs no `Vary` header for correctness here, since `Range` responses are
`206` and are not conflated with the `200` entity by a compliant cache. `?download=1`
produces a distinct URL and therefore a distinct cache key.

## Test Strategy

Stated up front, per repo rules. **Every defect gets a failing test before its fix.**

**Pure lane — `npm test`** (auto-discovered `scripts/test-*.ts`):

- `scripts/test-media-content-type.ts`
  - a `.webm` prefix containing `V_VP8` → `video/webm` ← **RED today**
  - a `.webm` prefix containing only `A_OPUS` → `audio/webm`
  - a truncated / empty / random `Buffer` for `.webm` → falls back to `audio/webm`
  - `.jpg` / `.png` / `.mp4` → unchanged table values, and the probe is not consulted
  - unknown extension → `application/octet-stream`
  - a guard that every extension in `EXTENSION_TYPES` yields a non-empty type
- `scripts/test-range-request.ts`
  - `bytes=0-99` / 1000 → `206`, `[0,99]`
  - `bytes=500-` → `206`, `[500,999]`; `bytes=-200` → `206`, `[800,999]`
  - `bytes=-5000` on 1000 → `206`, `[0,999]`
  - `bytes=5000-6000` → `416`; any range on a 0-byte object → `416`
  - `bytes=abc-def`, `items=0-10`, `bytes=`, `''`, `undefined` → `200`, never throws
  - **property-style sweep**: for a seeded set of `(header, total)` pairs, the result
    always satisfies `0 ≤ start ≤ end < total` whenever the status is `206`
- `scripts/test-content-disposition.ts`
  - a name containing `\r`, `\n`, `"`, `\x00` → none survive in the emitted value
  - a name that sanitizes to empty → the safe constant
  - a normal name → recognisable and quoted correctly

**e2e lane — `npm run e2e`** (`scripts/e2e-verify.mjs`), for the real HTTP round trip
the pure lane cannot prove:

- upload a small object, `GET` with `Range: bytes=0-9` → `206`, `Content-Range` exact,
  body is the first 10 bytes ← **RED today**
- `HEAD` → `Accept-Ranges: bytes`, correct `Content-Length`, no body
- `GET` with no `Range` → `200`, whole object, byte-identical to what was uploaded
- `GET ?download=1` → `Content-Disposition: attachment`; without it → header absent
- `X-Content-Type-Options: nosniff` present on the `200`, the `206` **and** the `416`
- a traversal attempt with a `Range` header → still refused, nothing served

**Post-deploy verification against production** (this is server code; see Migration):
re-request the four known-broken URLs from run `ijI9JMITSf8C9heN1Cwp` and assert
`Content-Type: video/webm`, plus a `Range` probe returning `206`.

**Gates:** `npm run verify` (all nine) then `npm run e2e`. No UI text changes, so
`i18n:check:strict` has nothing new to find — but it runs as part of `verify` regardless.

## Risks / Trade-offs

- **[The new pure modules must be reachable by both the VPS image and the test lane]**
  → `functions/server.js` is plain CommonJS shipped in the API container, while
  `scripts/test-*.ts` are tsx. Placement must satisfy both without dragging the built
  callables bundle into the test. Mitigation: mirror how `functions/uploadRoute.js` is
  already factored out of `server.js` and takes dependencies by injection "so it can be
  tested without the built callables bundle or a real Admin SDK" — the precedent and
  the constraint are both already in the repo. Confirm at apply time before writing the
  first test.
- **[A byte probe on every ambiguous request costs an extra read]** → bounded to a
  fixed prefix, skipped entirely for unambiguous extensions, and the objects are
  immutable so the result may be memoized in-process later. Note memoization would be a
  *derived-data* cache, so unlike `docCache` it stays correct even if the API is ever
  run as more than one process.
- **[Range handling could open a path that skips the containment guard]** → the
  guards run before any file access and are not touched; the range only chooses a byte
  window on the already-validated `fullPath`. An explicit e2e assertion covers traversal
  **with** a `Range` header present.
- **[Streaming a byte window changes error behaviour mid-response]** → once headers are
  sent, a read error cannot become a status code. Keep `createReadStream(path, {start,
  end})` and let an error destroy the response, as today; do not attempt a late
  `res.status()`.
- **[`nosniff` + a newly-correct type could change rendering somewhere]** → the change
  is strictly additive (inconclusive ⇒ today's value), so nothing that renders now can
  stop rendering; only `.webm` videos change, from broken to working.
- **[Shipping requires a VPS redeploy]** → a `deploy:hosting` will not move this code
  at all. Called out in the proposal, the migration plan, and it must be in the PR
  description.

## Migration Plan

1. Land the change; `npm run verify` and `npm run e2e` green locally.
2. Deploy to the VPS (`git pull` + `docker compose -f docker-compose.api.yml up -d
   --build`). Expect the documented ~40 s `503` window while the container rebuilds —
   do not deploy mid-event.
3. Verify against production with the known-broken artefacts from run
   `ijI9JMITSf8C9heN1Cwp`: `Content-Type: video/webm`, a `206` on a `Range` probe,
   `Content-Disposition` present only with `?download=1`, `nosniff` still on all three.
4. Open the Run Console for that run and confirm the four previously-black videos now
   play, and that the gallery's download button saves a file.

**Rollback:** revert the commit and rebuild the container. No stored object, schema,
URL or client contract changed, so rollback is a pure code revert with nothing to undo
— which is a direct consequence of D1.

## Open Questions

1. **Does the 90-day retention sweep actually reach disk-stored media?**
   `pruneRunPII` purges via `storage.bucket().deleteFiles({ prefix })`, which addresses
   a Firebase Storage bucket, while the VPS stores objects on local disk under
   `UPLOAD_DIR` — and `server.js` has an internal `DELETE /uploads/*` prefix route that
   nothing in `maintenance/index.ts` appears to call. If disk media is never swept, the
   90-day deletion promise is not being kept for participant photos and video. **This
   is out of scope here and must not be fixed in this change** — but it warrants its
   own investigation and, if confirmed, its own change. Raised because D1 turns on it.
2. **Should the review queue gain a download action at all?** `PhotoReviewConsole` has
   none today; only `RunMediaGalleryConsole` does. Out of scope, but it is the surface
   the operator was actually on when the download failed.
3. **Is 64 KB the right probe prefix** for every recorder this product accepts, or
   should it be derived from an observed sample of stored `.webm` objects? Start at
   64 KB; the inconclusive-falls-back-to-today design makes a wrong guess harmless
   rather than incorrect.
