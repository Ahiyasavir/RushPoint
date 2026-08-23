## Why

`functions/server.js`'s `PUT /upload` (the VPS-hosted media upload endpoint that replaced
Firebase Storage, per `vps-upload-route`) buffers each incoming file entirely into RAM
(`express.raw({ limit: '50mb' })`) before writing it to disk. Per-upload memory therefore
scales linearly with concurrent uploads × file size. At today's scale (photo/audio only,
10MB participant cap) this is tolerable, but adding larger media (a prospective video
submission task type, up to ~20-25MB per clip) and running at higher concurrency (e.g. 100
groups submitting near-simultaneously) risks holding several GB of Buffers at once on a
4GB-RAM VPS — a real OOM risk under a synchronized burst. Fixing this now, before video
uploads exist, means the video capability can ship without a load-bearing memory ceiling.

## What Changes

- Replace the raw-body buffering in `PUT /upload` with a streaming write: the incoming
  request body is piped directly to a temp file on disk in bounded-size chunks, never fully
  materialized as one in-memory `Buffer`.
- Enforce the per-caller size cap (`MAX_PARTICIPANT_BYTES` / `MAX_CREATOR_BYTES`) **during**
  the stream — abort and clean up the partial temp file as soon as the cap is exceeded,
  rather than only after the full body has already been received.
- Preserve every existing behavioral guarantee unchanged: Firebase ID token auth, path
  validation (`runs/` / `gameMedia/` prefix, no path traversal), content-type allowlist
  check, the IDOR guard (participant path's teamId segment must equal the authenticated
  uid), the `{url}` JSON response shape, and CORS handling.
- On success, atomically move the completed temp file into its final `UPLOAD_DIR` location
  (matching current behavior where a completed upload is immediately servable).
- No client-side change: `apps/play-web/src/services/firebase.ts`'s `uploadViaVps()` talks
  to the same `PUT /upload?path=...` contract, unchanged.

## Capabilities

### New Capabilities
- `vps-media-upload`: the behavioral contract for the self-hosted `PUT /upload` endpoint
  (auth, path/content-type/size validation, IDOR scoping, and now bounded-memory streaming
  writes). No existing `openspec/specs/` capture this endpoint's behavior yet (it shipped
  under the `vps-upload-route` change before this capability existed), so this proposal
  captures it as a new capability going forward rather than a delta against nothing.

### Modified Capabilities
(none — no prior spec exists to diff against; see `vps-media-upload` above)

## Impact

- **Backend only**: `functions/server.js` (the `PUT /upload` handler and its request-body
  parsing middleware). Adds a streaming dependency (e.g. `busboy`) to `functions/package.json`.
- No changes to `functions/src/**` (the callable business logic), Firestore rules, or any
  client (`apps/play-web`, `apps/creator-web`).
- Enables the separate `video-submission-task` change to raise upload size limits safely.
- Deploy: this changes the Docker image (`Dockerfile.api`) only insofar as it adds a new npm
  dependency; no infra/VPS-tier change required.
