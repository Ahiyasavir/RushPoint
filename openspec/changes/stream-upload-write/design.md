## Context

`functions/server.js` mounts `PUT /upload` (~lines 104-209) as the media upload path used
by both `apps/play-web` (participant photo/audio, soon video) and `apps/creator-web`
(creator-uploaded task media). It runs on the self-hosted IONOS VPS (`vps-upload-route`
change), not Cloud Functions/Firebase Storage — see `RUN_ON_VPS.md` and the
`self-host-functions-vps` history.

Current implementation:
```js
app.put('/upload', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
  // ... auth, path, content-type, size checks against req.body (already a full Buffer)
  await fs.promises.writeFile(fullPath, req.body);
  // ...
});
```
`express.raw()` buffers the ENTIRE request body into a `Buffer` in process memory before
the handler runs at all — size/content-type checks happen only after the whole file is
already resident in RAM. On the VPS (4 vCore / 4GB RAM), N concurrent uploads therefore
cost `N × file_size` bytes of heap, with no backpressure and no early rejection.

This is being fixed now (ahead of a video-submission task type, which needs a larger
per-file cap) specifically so raising the size cap does not also raise the OOM risk.

## Goals / Non-Goals

**Goals:**
- Per-upload memory overhead becomes O(chunk size), not O(file size), regardless of
  concurrency.
- Oversized uploads are rejected as soon as the byte cap is crossed, without receiving
  (or buffering) the rest of the body.
- Every existing check (auth, path validation/IDOR, content-type, response shape, CORS)
  behaves identically from the caller's point of view — this is invisible to
  `uploadViaVps()` in `apps/play-web/src/services/firebase.ts` and to creator-web's
  equivalent.
- No partial/corrupt file is ever servable at its final `UPLOAD_DIR` path — a failed or
  aborted upload leaves no trace under the public `/uploads/` tree.

**Non-Goals:**
- Not changing the client upload API/contract (`PUT /upload?path=...`, `{url}` response).
- Not changing size caps or the content-type allowlist in this change (that's
  `video-submission-task`'s job) — caps stay at today's values, just enforced earlier.
- Not moving media storage off the VPS or back onto Firebase Storage.
- Not adding multipart/form-data support — the wire format stays "whole file as the raw PUT
  body"; only the server's internal handling becomes streaming.

## Decisions

**1. Stream the raw body via Node's request stream + a size-limiting Transform, write with
`fs.createWriteStream`, skip a multipart parser (busboy) entirely.**
Rationale: the request body is a single opaque file (not `multipart/form-data` — the client
sends the raw bytes as the whole body with `Content-Type` as a header), so a multipart
parser like `busboy` solves a problem this endpoint doesn't have. A `Transform` stream that
tracks bytes-seen and destroys the pipeline once the cap is exceeded is simpler, has one
fewer dependency, and maps 1:1 onto the existing wire format.
Alternative considered: `busboy` — rejected as unnecessary complexity/dependency for a
non-multipart endpoint; would only make sense if the client were switched to
`multipart/form-data`, which is out of scope.

**2. Write to a temp path first (`<UPLOAD_DIR>/.tmp/<uuid>`), rename into place on success.**
Rationale: guarantees no partially-written file is ever reachable at its public
`/uploads/<path>` URL (today's `writeFile` already has this property implicitly since it's
atomic for a fully-buffered write; streaming loses that unless we explicitly stage+rename).
`fs.rename` within the same filesystem/volume is atomic on POSIX.
Alternative considered: write directly to the final path and `unlink` on failure — rejected
because a concurrent GET on `/uploads/<path>` during an in-progress write could serve a
truncated file; staging avoids that window entirely.

**3. Enforce the size cap inside the streaming Transform (byte-counting), not via a
`Content-Length` header check.**
Rationale: `Content-Length` can be absent, wrong, or spoofed; the authoritative signal is
bytes actually received. The Transform counts bytes as they flow through and calls
`destroy(new Error('cap exceeded'))` on the source stream the instant the running total
exceeds `maxBytes`, so the server never buffers past the cap even transiently.
Alternative considered: pre-check `Content-Length` and reject before reading — kept as a
cheap fast-path rejection (avoids opening a write stream at all for an obviously-oversized
declared length) but NOT relied on alone, since it's advisory only.

**4. Validation order stays: auth → path → content-type → (now-streaming) size, same as
today.** Auth/path/content-type are checked from headers/query before any body bytes are
read, so those rejections still short-circuit with zero body processing — unchanged
early-exit behavior, just applied before the stream opens instead of before `writeFile`.

## Risks / Trade-offs

- **[Risk] A slow/stalled client connection now holds an open write-stream + temp file
  for longer than the old buffer-then-write pattern (which failed fast on a dead
  connection once `express.raw`'s own timeout fired).**
  → Mitigation: keep an explicit idle/stall timeout on the request (mirroring the client's
  own `UPLOAD_STALL_MS` expectations) that destroys the stream and cleans up the temp file
  if no bytes arrive for N seconds.
- **[Risk] Orphaned temp files if the process crashes mid-upload (rename never runs).**
  → Mitigation: `.tmp/` entries older than a short TTL (e.g. 1 hour) are swept by the
  existing daily retention-prune systemd timer (`rushpoint-prune.timer`), or a lightweight
  startup sweep on server boot. Low blast radius (bounded by the size cap × in-flight count).
- **[Risk] Behavior drift between the "fast-path" `Content-Length` pre-check and the
  streaming byte-count check could produce two different rejection codes/messages for what
  looks like the same error to a caller.**
  → Mitigation: both paths return the same `400 INVALID_ARGUMENT` shape/message format the
  current code uses; a test asserts both trigger paths produce equivalent responses.
- **[Trade-off] Slightly more code/complexity than the one-line `writeFile` it replaces.**
  → Accepted: this is the entire point of the change — the extra complexity buys the memory
  bound that a video-submission feature needs to be safe at 100-group scale.

## Migration Plan

1. Implement the streaming handler behind the same route/contract; no version bump or
   dual-path needed since the wire protocol is unchanged.
2. Land with full test coverage (see tasks.md) verified against the local emulator's `npm
   run e2e` media-upload scenarios plus new streaming-specific assertions.
3. Deploy via the existing `docker-compose.api.yml` flow to the IONOS VPS — a normal
   `functions/` deploy, no data migration, no Firestore/rules changes, no downtime beyond
   the container restart already required for any VPS deploy.
4. Rollback: revert the commit and redeploy — the temp-file staging directory
   (`UPLOAD_DIR/.tmp`) is disposable and requires no cleanup to roll back safely.

## Open Questions

- Exact idle-stall timeout value to use server-side (client already uses 45s
  `UPLOAD_STALL_MS` before it gives up and retries) — propose matching it so the server
  doesn't hold a doomed connection open longer than the client will wait.
- Whether the `.tmp/` sweep should be a dedicated small cron/systemd timer or folded into
  the existing daily retention-prune job — proposed: fold into the existing job to avoid a
  second timer to operate, confirm during tasks/implementation.
