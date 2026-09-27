// ─── POST /ingest-url — fetch a picture the creator dragged from another tab ──
// (change: server-side-url-ingest)
//
// The browser gives a page a URL on a cross-tab image drag, never the bytes, and
// only a CORS-permissive host lets the page read them. This route does the fetch
// server-side so every source works — and every rule the ordinary upload enforces
// is enforced here too, by CALLING THE SAME FUNCTIONS rather than restating them:
// the Bearer token, `ownsUploadPath` (IDOR), `contentTypeAllowed`, `maxBytesFor`,
// and `streamToFileWithLimit`'s temp→rename staging. A second upload path that
// validated "equivalently" would drift from the first, and the drift would be a
// hole rather than a cosmetic difference.
//
// What is NEW here is only the address guard (urlIngestGuard.js) and the redirect
// loop — see that file for what SSRF means on this box and what is deliberately
// still open.
const fs = require('fs');
const fsPath = require('path');
const crypto = require('crypto');

const {
  classifyUploadPath,
  ownsUploadPath,
  maxBytesFor,
  contentTypeAllowed,
  streamToFileWithLimit,
  TMP_DIR_NAME,
} = require('./uploadRoute.js');
const { validateIngestUrl, assertPublicHost } = require('./urlIngestGuard.js');

// A public image is reached in a hop or two; more than this is either a loop or
// somebody walking us somewhere.
const MAX_REDIRECTS = 3;
// The whole conversation, not per chunk — a slowloris source must not hold a VPS
// connection open indefinitely.
const FETCH_TIMEOUT_MS = 15_000;

async function safeUnlink(p) {
  try { await fs.promises.unlink(p); } catch { /* already gone */ }
}

/**
 * Fetch `rawUrl`, re-validating every redirect hop, and return the final response.
 * Rejects with `{ reason }` so the caller can answer without leaking internals.
 */
async function fetchGuarded(rawUrl, { lookupAll, fetchImpl, signal }) {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const verdict = validateIngestUrl(current);
    if (!verdict.ok) throw Object.assign(new Error('blocked'), { reason: verdict.reason });
    const host = await assertPublicHost(verdict.url.hostname, lookupAll);
    if (!host.ok) throw Object.assign(new Error('blocked'), { reason: host.reason });

    // `redirect: 'manual'` is the load-bearing word. Letting the client follow
    // redirects itself would validate the first address and then follow the
    // Location header to anywhere — which is the ordinary way an SSRF guard is
    // bypassed, not an exotic one.
    const res = await fetchImpl(current, {
      redirect: 'manual',
      signal,
      headers: { accept: 'image/*,video/*' },
    });
    const status = res.status;
    if (status >= 300 && status < 400) {
      const location = res.headers.get('location');
      if (!location) throw Object.assign(new Error('blocked'), { reason: 'redirect-no-location' });
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) throw Object.assign(new Error('blocked'), { reason: 'status' });
    return res;
  }
  throw Object.assign(new Error('blocked'), { reason: 'too-many-redirects' });
}

/**
 * @param verifyIdToken (token) -> Promise<{uid}>
 * @param uploadDir     where files land
 * @param resolveOrigin (req) -> public origin for the returned URL
 * @param lookupAll     (hostname) -> Promise<[{address}]>
 * @param fetchImpl     global fetch by default; injected in tests
 */
function createIngestUrlHandler({ verifyIdToken, uploadDir, resolveOrigin, onResponse, lookupAll, fetchImpl }) {
  return async function ingestUrlHandler(req, res) {
    let tempPath;
    const timer = { id: null };
    try {
      const authHeader = req.headers.authorization || '';
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        return res.status(401).json({ error: { status: 'UNAUTHENTICATED', message: 'Missing auth token' } });
      }
      let uid;
      try {
        uid = (await verifyIdToken(match[1])).uid;
      } catch {
        return res.status(401).json({ error: { status: 'UNAUTHENTICATED', message: 'Invalid auth token' } });
      }

      const body = req.body || {};
      const uploadPath = body.path;
      const kind = classifyUploadPath(uploadPath);
      if (!kind) {
        return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'Invalid path' } });
      }
      // IDOR, before any outbound request: a caller who cannot write here must not
      // be able to make this server fetch anything at all.
      if (!ownsUploadPath(kind, uploadPath, uid)) {
        return res.status(403).json({ error: { status: 'PERMISSION_DENIED', message: 'Cannot upload to another folder' } });
      }

      const verdict = validateIngestUrl(body.url);
      if (!verdict.ok) {
        return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'URL not allowed' } });
      }

      const ac = new AbortController();
      timer.id = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

      let upstream;
      try {
        upstream = await fetchGuarded(body.url, { lookupAll, fetchImpl, signal: ac.signal });
      } catch {
        // One message for every refusal reason. Telling a caller WHICH address was
        // blocked, or that DNS failed, turns this endpoint into a probe of the
        // VPS's network — the exact thing the guard exists to prevent.
        return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'Could not fetch that URL' } });
      }

      const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!contentTypeAllowed(kind, contentType)) {
        return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: `Content type not allowed: ${contentType}` } });
      }
      const maxBytes = maxBytesFor(kind, contentType);

      // Advisory only, exactly as in the upload route: a lying Content-Length is
      // caught by the streaming byte count below, which is authoritative.
      const declared = Number(upstream.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: `File too large (max ${maxBytes / 1024 / 1024}MB)` } });
      }

      const tmpDir = fsPath.join(uploadDir, TMP_DIR_NAME);
      await fs.promises.mkdir(tmpDir, { recursive: true });
      tempPath = fsPath.join(tmpDir, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`);

      // The SAME staged writer the upload route uses, so the byte cap, the stall
      // timeout and "a partial file is never reachable at its public URL" hold
      // identically on this path.
      const { Readable } = require('stream');
      const nodeStream = upstream.body && typeof upstream.body.pipe === 'function'
        ? upstream.body
        : Readable.fromWeb(upstream.body);

      let bytes;
      try {
        bytes = await streamToFileWithLimit(nodeStream, tempPath, maxBytes);
      } catch (e) {
        await safeUnlink(tempPath);
        tempPath = undefined;
        const tooLarge = e && e.reason === 'too-large';
        return res.status(400).json({
          error: {
            status: 'INVALID_ARGUMENT',
            message: tooLarge ? `File too large (max ${maxBytes / 1024 / 1024}MB)` : 'Could not fetch that URL',
          },
        });
      }
      if (bytes === 0) {
        await safeUnlink(tempPath);
        tempPath = undefined;
        return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'Empty file' } });
      }

      const fullPath = fsPath.join(uploadDir, uploadPath);
      await fs.promises.mkdir(fsPath.dirname(fullPath), { recursive: true });
      await fs.promises.rename(tempPath, fullPath);
      tempPath = undefined;

      const url = `${resolveOrigin(req)}/uploads/${encodeURI(uploadPath)}`;
      onResponse?.(req, res);
      return res.json({ url });
    } catch (e) {
      if (tempPath) await safeUnlink(tempPath);
      console.error('Ingest error:', e);
      if (res.headersSent || res.writableEnded) return undefined;
      return res.status(500).json({ error: { status: 'INTERNAL', message: 'Ingest failed' } });
    } finally {
      if (timer.id) clearTimeout(timer.id);
    }
  };
}

module.exports = { createIngestUrlHandler, fetchGuarded, MAX_REDIRECTS, FETCH_TIMEOUT_MS };
