## 1. Test harness setup

- [ ] 1.1 Add `supertest` as a dev dependency in `functions/package.json` (needed to drive
      real streamed PUT requests against the Express app in-process, including sending a
      body larger than the cap and asserting the connection is cut before completion).
- [ ] 1.2 Refactor `functions/server.js` minimally so the Express `app` is exportable
      without binding to a port (e.g. `module.exports = { app }` alongside the existing
      `app.listen(...)` guarded by `require.main === module`), so tests can mount it via
      supertest without a real network listener. This is a pure test-seam change — no
      behavior change.
- [ ] 1.3 Create `functions/src/uploadStream.test.ts` (or `functions/uploadStream.test.ts`,
      matching wherever `server.js`'s tests should live) with a `beforeEach` that points
      `UPLOAD_DIR` at a fresh temp directory and cleans it up in `afterEach`.

## 2. RED — failing tests for streaming behavior

- [ ] 2.1 Write a failing test: "a body under the participant cap is written to disk and
      servable at its final `/uploads/<path>` URL" — asserts response `{url}` shape and that
      `GET` on that url returns the exact bytes sent. (Should currently PASS against old
      code too — this is the regression baseline, confirm it passes before touching
      anything, then keep it green throughout.)
- [ ] 2.2 Write a failing test: "an oversized body is rejected without the server ever
      holding the full body in one buffer" — send a body larger than
      `MAX_PARTICIPANT_BYTES` and assert (a) the response is `400 INVALID_ARGUMENT` with a
      "file too large" message, and (b) no file exists at the final `UPLOAD_DIR/<path>`
      afterward. Confirm this test currently passes against the OLD buffering code too
      (it already rejects oversized bodies, just after fully buffering) — the point of this
      task is scaffolding, not yet proving the memory bound.
- [ ] 2.3 Write a failing test that DOES distinguish the streaming behavior: assert that no
      `.tmp` (or final) file larger than the cap is ever written to disk, by racing a
      write-completion check against the in-flight request — i.e. poll the temp directory
      during the upload and assert the partial file's size never exceeds
      `MAX_PARTICIPANT_BYTES` at any sampled point, even while more bytes are still being
      sent. This MUST fail against the current buffer-then-write implementation (since it
      writes nothing to disk until the entire buffer is already resident in memory, so the
      poll either sees nothing or the full file, but the point is the REQUEST isn't aborted
      until the whole oversized body is received — confirm by observing the request doesn't
      error until `body.length` fully arrives). Run it, confirm it fails for the right
      reason (documents the current "waits for full body" behavior).
- [ ] 2.4 Write a failing test: "a request whose body never finishes and exceeds the cap
      mid-stream causes the server to close the connection / respond before the client
      finishes sending" — simulate a slow/chunked send that crosses the cap partway through
      and assert the server responds (or the connection resets) before all bytes are sent,
      distinguishing "abort early" from "buffer everything then reject." Confirm this fails
      against current code (which cannot respond until `express.raw` finishes buffering the
      whole body).
- [ ] 2.5 Write failing tests for the unchanged guards, run once now to confirm they PASS
      against current code (baseline regression coverage before refactor): missing/invalid
      auth token → 401; path traversal (`..`) → 400; participant writing to another team's
      folder → 403; disallowed content-type → 400; creator path/content-type/size caps use
      the creator limits, not participant limits.
- [ ] 2.6 Write a failing test: "no partially-written file is ever publicly servable" — abort
      an in-flight upload (e.g. destroy the client socket mid-send) and assert a subsequent
      `GET /uploads/<path>` for that exact path returns 404 (no prior file existed) rather
      than a truncated file.

## 3. GREEN — implement the streaming write

- [ ] 3.1 Replace `express.raw({ type: '*/*', limit: '50mb' })` on the `PUT /upload` route
      with raw stream handling: read `req` directly as the source stream (Express request
      objects are readable streams), no body-parsing middleware for this route.
- [ ] 3.2 Implement a byte-counting `Transform` (or manual `data` handler) that tracks
      cumulative bytes and calls `req.destroy(err)` / stops piping as soon as the running
      total exceeds the applicable cap (`MAX_PARTICIPANT_BYTES` / `MAX_CREATOR_BYTES`,
      selected the same way as today based on `isCreator`).
- [ ] 3.3 Add the `Content-Length`-based fast-path pre-check: if present and already exceeds
      the cap, reject immediately with the existing `400 INVALID_ARGUMENT` message/shape
      before opening any write stream — but do not treat its absence as license to skip the
      streaming byte-count guard.
- [ ] 3.4 Pipe the (cap-guarded) source stream into `fs.createWriteStream` targeting a temp
      path under `UPLOAD_DIR/.tmp/<uuid>`, creating the `.tmp` directory if needed.
- [ ] 3.5 On successful stream completion (`finish` event on the write stream), atomically
      `fs.promises.rename` the temp file into its final `UPLOAD_DIR/<path>` location, then
      respond with the existing `{url}` JSON shape — unchanged from today.
- [ ] 3.6 On any failure (cap exceeded, client disconnect, write error), destroy the
      in-progress write stream and delete the temp file (best-effort `fs.promises.unlink`,
      swallow ENOENT), then respond with the appropriate error status/shape matching
      today's messages (`400 INVALID_ARGUMENT` for size, etc.) — do not leave an orphaned
      temp file reachable, and do not double-respond if the client already disconnected.
- [ ] 3.7 Preserve the existing ordered guard sequence ahead of any stream handling: auth
      check → path validation → content-type check — all still read only from
      headers/query, no body bytes consumed, so these reject exactly as fast as before.
- [ ] 3.8 Add an idle/stall timeout on the request (mirroring the client's 45s
      `UPLOAD_STALL_MS`) that destroys the stream and cleans up the temp file if no data
      arrives for that long, so a stalled connection can't hold resources indefinitely.
- [ ] 3.9 Run the full test file from step 2 — confirm 2.1, 2.2, 2.5, 2.6 still pass (or now
      pass, if any regressed during the refactor) and that 2.3/2.4 now PASS (the streaming
      behavior is provable: partial file never exceeds the cap size on disk, and the server
      responds before an oversized client finishes sending).

## 4. REFACTOR

- [ ] 4.1 Extract the streaming-write-with-cap logic into a small named helper (e.g.
      `streamToFileWithLimit(req, destPath, maxBytes)`) so the route handler stays readable
      and the helper is independently testable if useful later.
- [ ] 4.2 Review error-path cleanup for races (e.g. cap-exceeded and client-disconnect firing
      close together) — ensure `unlink` is idempotent/safe and the response is sent exactly
      once per request.
- [ ] 4.3 Add a code comment at the route explaining WHY streaming is used here (the RAM-vs-
      concurrency risk this change fixes) so a future editor doesn't "simplify" it back to
      `express.raw()` — mirroring the existing comment style at the top of the upload route.

## 5. Temp-file hygiene

- [ ] 5.1 Extend the existing daily retention-prune job (or add a small startup sweep in
      `server.js`) to remove any `UPLOAD_DIR/.tmp/*` entries older than a short TTL (e.g. 1
      hour), covering orphaned temp files from a crashed/killed process. Add a test asserting
      the sweep logic identifies and removes only stale temp entries, not in-progress ones.

## 6. Gate verification

- [ ] 6.1 Run `npm run typecheck` — must pass (functions workspace).
- [ ] 6.2 Run `npm run lint` — must pass with 0 errors.
- [ ] 6.3 Run `npm test` — must pass, including the new `functions/**/uploadStream.test.ts`
      vitest file.
- [ ] 6.4 Run `npm run creator:build` and `npm run play:build` — must pass (no client-side
      changes expected, confirms nothing broke incidentally).
- [ ] 6.5 Run `npm run e2e` — confirm the existing photo/audio upload scenarios in
      `scripts/e2e-verify.mjs` still pass unchanged against the streaming implementation.
- [ ] 6.6 Manually verify on a local build: start `functions/server.js`, PUT a file at/near
      `MAX_PARTICIPANT_BYTES`, confirm success; PUT a file well over the cap, confirm fast
      rejection and no leftover temp file in `UPLOAD_DIR/.tmp`.
- [ ] 6.7 No UI touched by this change — `npm run i18n:check` not required, but confirm no
      UI files appear in the diff before marking done.
