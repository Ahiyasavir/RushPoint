# Photo & audio uploads on the VPS

Uploads do **not** use Firebase Storage. Creating a Storage bucket requires the
Blaze plan, so the same self-hosted API that already runs the callables
(`api.rush-point.com`) also stores and serves the files.

```
phone ──PUT https://api.rush-point.com/upload?path=runs/<runId>/teams/<uid>/x.jpg──▶ VPS
                                                                                      │ writes /data/uploads/<path>
       ◀──{ "url": "https://api.rush-point.com/uploads/runs/<runId>/teams/<uid>/x.jpg" }
```

That returned URL is what goes into Firestore, exactly where a Firebase
`getDownloadURL()` value used to go. Nothing downstream knows the difference.

## What must be true on the VPS

Everything below is required. Miss any one and uploads fail in a way that looks
like a client bug.

### 1. The container runs the current `server.js`

The upload routes were added to `functions/server.js`. Confirm they exist:

```bash
curl -i -X OPTIONS https://api.rush-point.com/upload -H 'Origin: https://rush-point.com' -H 'Access-Control-Request-Method: PUT'
```

`204` = deployed. `404` = the container is still running the old build; rebuild:

```bash
docker compose -f docker-compose.api.yml up -d --build
```

### 2. Environment + a persistent volume

Both are already set in [docker-compose.api.yml](docker-compose.api.yml):

| Variable | Value | Why |
|---|---|---|
| `VPS_UPLOAD_ORIGIN` | `https://api.rush-point.com` | Minted into the returned URL, and the origin the callables will accept a photo URL from. Wrong value ⇒ the server rejects its own uploads. |
| `UPLOAD_DIR` | `/data/uploads` | Where files land inside the container. |
| `ALLOWED_ORIGINS` | `https://rush-point.com,https://creator.rush-point.com` | The browser origin gate. A stale placeholder here 403s every request. |

The `./uploads:/data/uploads` volume is what makes files survive a container
rebuild. **Without it every redeploy silently deletes every photo from every past
run** — the Firestore URLs remain, pointing at 404s.

### 3. The reverse proxy forwards the upload paths

See [Caddyfile.api](Caddyfile.api). A proxy that only forwards the callable POSTs
works perfectly until someone takes a photo. Three extra things are needed:

- `PUT /upload` — the upload itself
- `OPTIONS /upload` — its CORS preflight (cross-origin: `rush-point.com` → `api.rush-point.com`)
- `GET /uploads/*` — serving the file back

Also raise the proxy body limit above **50 MB** (creator video). Caddy defaults to
10 MB and rejects a large upload *before* the server sees it, so the server's own
limit never applies and the error looks like a network failure.

### 4. Disk

Photos and audio accumulate for the life of a run. Creator video is up to 50 MB
per file. `pruneRunNow` / the retention sweep delete under `UPLOAD_DIR` as well as
the (absent) Storage bucket, so expired run media is cleaned up — but plan
capacity for peak event volume regardless.

## Security properties (enforced server-side, tested)

- **Auth** — a valid Firebase ID token is required; the uid comes from the token, never the request.
- **IDOR** — participants may only write `runs/<runId>/teams/<their-own-uid>/…`; creators only `gameMedia/<their-own-uid>/…`.
- **Traversal** — `..` is rejected on write, on read, and again when a stored URL is validated (`packages/shared/src/validation.ts`). The URL check is segment-wise, so a file legitimately named `photo..1.jpg` still works.
- **Content type + size** — allow-list mirroring `storage.rules`; 10 MB participant, 50 MB creator.
- **`X-Content-Type-Options: nosniff`** on served files — the served type is derived from the *filename* while the upload validated the declared *header*, so the two can disagree; nosniff stops a browser sniffing an uploaded file into HTML on this origin.

## Local development is unchanged

Without `VITE_API_ORIGIN`, play-web and creator-web keep using the Firebase
Storage emulator. `npm run dev:all` behaves exactly as before.
