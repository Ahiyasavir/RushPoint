// ─── PUT /upload — streaming media upload (change: stream-upload-write) ──────
//
// WHY THIS STREAMS INSTEAD OF USING express.raw().
// The previous implementation parsed the body with `express.raw({limit:'50mb'})`,
// which buffers the ENTIRE file into one in-memory Buffer before the handler runs
// — so peak RAM was `concurrent uploads × file size`, and the size cap could only
// be checked AFTER the whole oversized body had already been received and held.
// On the 4GB VPS a synchronized burst (a field game where every team submits at
// once) could exhaust memory, and raising the cap for video would have made that
// strictly worse. Here the request is piped straight to a temp file in bounded
// chunks, the cap is enforced as bytes arrive (aborting mid-stream), and the file
// is renamed into place only once it is complete. Peak RAM per upload is now a
// fixed chunk, independent of file size. Do NOT "simplify" this back to
// express.raw().
//
// The route is factored out of server.js and takes its dependencies by injection
// so it can be tested without the built callables bundle or a real Admin SDK.
const fs = require('fs');
const fsPath = require('path');
const crypto = require('crypto');

// Content-type allowlist — mirrors storage.rules exactly. The video/ arm mirrors
// VIDEO_CONTENT_TYPES in packages/shared/src/mediaKinds.ts (change:
// video-submission-task); it stays an exact list rather than video/.+ so a
// participant can only send what our recorder or a native camera picker produces.
const ALLOWED_CONTENT_TYPES = /^(image\/(jpeg|jpg|png|webp|heic|heif|gif)|audio\/(webm|mp4|mpeg|ogg|aac|x-m4a|3gpp|amr)|video\/(webm|mp4|quicktime))$/;
// Creator media allows any video type (SVG stays excluded for images).
const ALLOWED_CREATOR_TYPES = /^(image\/(?!svg)(jpeg|jpg|png|webp|heic|heif|gif)|video\/.+|audio\/(webm|mp4|mpeg|ogg|aac|x-m4a|3gpp|amr))$/;

const MAX_PARTICIPANT_BYTES = 10 * 1024 * 1024;  // 10MB
// Video needs more room than a photo — but a blanket raise of the participant cap
// would also let a "photo" upload balloon to 20MB, which is never legitimate (a
// compressed phone photo is well under 1MB) and would weaken the existing guard for
// no gain. So the cap is selected per content-type family instead.
//
// SIZING: this must cover the worst clip the PLATFORM allows, which is one at
// VIDEO_DURATION_LIMITS.ceilingSeconds (60s) — not one at the default 40s max. The
// participant recorder pins its own bitrate (see VIDEO_BITS_PER_SECOND in
// play-web's TaskRunner) at 2 Mbps video + 96 kbps audio, so a ceiling-length clip
// is ~15.7MB and 20MB leaves ~27% headroom for container overhead and bitrate
// overshoot. Raising the ceiling without re-deriving this number ships an upload
// path that refuses missions the Builder happily authored.
const MAX_PARTICIPANT_VIDEO_BYTES = 20 * 1024 * 1024;  // 20MB
const MAX_CREATOR_BYTES = 50 * 1024 * 1024;      // 50MB

// Participant video content-types, matched after codec params are stripped.
const PARTICIPANT_VIDEO_TYPES = /^video\/(webm|mp4|quicktime)$/;

// No byte arrives for this long ⇒ the upload is dead; destroy it and clean up.
// Matches the client's own UPLOAD_STALL_MS so the server never holds a connection
// open longer than the client will wait before retrying.
const UPLOAD_STALL_MS = 45_000;

const TMP_DIR_NAME = '.tmp';
// An orphaned temp file (process killed mid-upload) is swept after this long.
const TMP_TTL_MS = 60 * 60 * 1000; // 1 hour

// A path is a participant upload (runs/…) or creator media (gameMedia/…); anything
// else is refused. Returns null when the path is unusable.
function classifyUploadPath(uploadPath) {
  if (typeof uploadPath !== 'string' || !uploadPath) return null;
  if (uploadPath.includes('..') || uploadPath.startsWith('/') || uploadPath.startsWith('\\')) return null;
  if (uploadPath.startsWith('runs/')) return 'participant';
  if (uploadPath.startsWith('gameMedia/')) return 'creator';
  return null;
}

// IDOR guard: a participant may only write under their own team folder, a creator
// only under their own uid folder.
function ownsUploadPath(kind, uploadPath, uid) {
  const parts = uploadPath.split('/');
  if (kind === 'participant') {
    // runs/{runId}/teams/{teamId}/{filename}
    return parts.length >= 5 && parts[2] === 'teams' && parts[3] === uid;
  }
  // gameMedia/{uid}/…
  return parts.length >= 3 && parts[1] === uid;
}

// The cap is chosen from the VALIDATED content-type, never from the path or from
// anything the caller declares about its intent — otherwise every participant
// upload would inherit the larger video ceiling just by asking.
function maxBytesFor(kind, contentType) {
  if (kind === 'creator') return MAX_CREATOR_BYTES;
  const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
  return PARTICIPANT_VIDEO_TYPES.test(normalized) ? MAX_PARTICIPANT_VIDEO_BYTES : MAX_PARTICIPANT_BYTES;
}

function contentTypeAllowed(kind, contentType) {
  return kind === 'creator'
    ? ALLOWED_CREATOR_TYPES.test(contentType)
    : ALLOWED_CONTENT_TYPES.test(contentType);
}

// Pipe `req` into `destPath`, aborting as soon as more than `maxBytes` have
// arrived. Resolves with the byte count on success; rejects with an Error whose
// `.reason` is 'too-large' | 'stalled' | 'aborted' | 'io' otherwise. The caller
// owns cleanup of destPath on rejection.
function streamToFileWithLimit(req, destPath, maxBytes, stallMs = UPLOAD_STALL_MS) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    let received = 0;
    let settled = false;
    let stallTimer;

    const finish = (err, bytes) => {
      if (settled) return;
      settled = true;
      if (stallTimer) clearTimeout(stallTimer);
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
      if (err) {
        out.destroy();
        reject(err);
      } else {
        // Wait for the write stream to flush before declaring success, or a
        // rename could race an unflushed tail.
        out.end(() => resolve(bytes));
      }
    };

    const fail = (reason, message) => {
      const err = new Error(message);
      err.reason = reason;
      // Stop CONSUMING the body — this is what bounds memory: we never accumulate
      // past the cap, and nothing more is written to disk. We deliberately do NOT
      // destroy the socket here: the caller still has to deliver a 400 the client
      // can READ. Killing the connection outright surfaces to the browser as a
      // network error, which uploadResiliency treats as retryable — so an
      // oversized file would be re-sent three times to earn the same refusal.
      // The caller destroys the request after the response has flushed.
      req.pause();
      finish(err);
    };

    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => fail('stalled', 'Upload stalled'), stallMs);
    };

    const onData = (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        fail('too-large', 'File too large');
        return;
      }
      armStall();
      // Respect backpressure so a fast client cannot outrun the disk and grow an
      // unbounded internal buffer — the whole point of streaming.
      if (!out.write(chunk)) {
        req.pause();
        out.once('drain', () => req.resume());
      }
    };
    const onEnd = () => finish(null, received);
    const onError = (e) => {
      const err = new Error('Upload read error');
      err.reason = 'io';
      err.cause = e;
      finish(err);
    };
    const onAborted = () => {
      const err = new Error('Upload aborted');
      err.reason = 'aborted';
      finish(err);
    };

    out.on('error', (e) => {
      const err = new Error('Upload write error');
      err.reason = 'io';
      err.cause = e;
      finish(err);
    });

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
    armStall();
  });
}

async function safeUnlink(p) {
  try {
    await fs.promises.unlink(p);
  } catch {
    // Already gone (or never created) — nothing to clean up.
  }
}

// Remove orphaned temp files left by a process that died mid-upload. Only entries
// older than TMP_TTL_MS are touched, so an in-flight upload is never destroyed.
async function sweepStaleTempUploads(uploadDir, now = Date.now(), ttlMs = TMP_TTL_MS) {
  const tmpDir = fsPath.join(uploadDir, TMP_DIR_NAME);
  let entries;
  try {
    entries = await fs.promises.readdir(tmpDir);
  } catch {
    return 0; // No temp dir yet — nothing to sweep.
  }
  let removed = 0;
  for (const name of entries) {
    const full = fsPath.join(tmpDir, name);
    try {
      const st = await fs.promises.stat(full);
      if (now - st.mtimeMs > ttlMs) {
        await fs.promises.unlink(full);
        removed += 1;
      }
    } catch {
      // Vanished mid-sweep or unreadable — skip it.
    }
  }
  return removed;
}

// Build the PUT /upload handler. Dependencies are injected so tests can run it
// without the callables bundle or real Firebase credentials.
//   verifyIdToken(token) -> Promise<{uid}>  — throws/rejects on an invalid token
//   uploadDir                                — root of the served upload tree
//   resolveOrigin(req)                       — returns the origin for the {url} reply
//   onResponse(req, res)                     — hook to set CORS headers before replying
function createUploadHandler({ verifyIdToken, uploadDir, resolveOrigin, onResponse }) {
  return async function uploadHandler(req, res) {
    let tempPath;
    try {
      // 1. Auth — header only, no body bytes consumed yet.
      const authHeader = req.headers.authorization || '';
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        return res.status(401).json({ error: { status: 'UNAUTHENTICATED', message: 'Missing auth token' } });
      }
      let uid;
      try {
        const decoded = await verifyIdToken(match[1]);
        uid = decoded.uid;
      } catch {
        return res.status(401).json({ error: { status: 'UNAUTHENTICATED', message: 'Invalid auth token' } });
      }

      // 2. Path shape.
      const uploadPath = req.query.path;
      const kind = classifyUploadPath(uploadPath);
      if (!kind) {
        return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'Invalid path' } });
      }

      // 3. Content type.
      const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!contentTypeAllowed(kind, contentType)) {
        return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: `Content type not allowed: ${contentType}` } });
      }

      // 4. Ownership (IDOR).
      if (!ownsUploadPath(kind, uploadPath, uid)) {
        return res.status(403).json({
          error: {
            status: 'PERMISSION_DENIED',
            message: kind === 'participant'
              ? 'Cannot upload to another team folder'
              : 'Cannot upload to another creator folder',
          },
        });
      }

      const maxBytes = maxBytesFor(kind, contentType);

      // 5. Declared-length fast path. Advisory only — Content-Length can be absent
      // or wrong, so the streaming byte count below is the authoritative guard.
      // We still drain the body: replying while the client is mid-send breaks its
      // write with ECONNRESET before it can read this 400, and uploadResiliency
      // treats a network error as RETRYABLE — so the client would send the whole
      // oversized file twice more. Draining discards each chunk without ever
      // accumulating it, so memory stays bounded either way.
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        req.resume();
        await new Promise((r) => { req.on('end', r); req.on('error', r); req.on('close', r); });
        if (res.headersSent || res.writableEnded) return undefined;
        return res.status(400).json({
          error: { status: 'INVALID_ARGUMENT', message: `File too large (max ${maxBytes / 1024 / 1024}MB)` },
        });
      }

      // 6. Stream to a temp file, then rename into place. Staging is what keeps a
      // partial upload from ever being reachable at its public /uploads/ URL.
      const tmpDir = fsPath.join(uploadDir, TMP_DIR_NAME);
      await fs.promises.mkdir(tmpDir, { recursive: true });
      tempPath = fsPath.join(tmpDir, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`);

      let bytes;
      try {
        bytes = await streamToFileWithLimit(req, tempPath, maxBytes);
      } catch (e) {
        await safeUnlink(tempPath);
        tempPath = undefined;
        if (e && e.reason === 'too-large') {
          if (res.headersSent || res.writableEnded) return undefined;
          // Discard whatever else the client is still sending instead of killing
          // the socket — same reasoning as the Content-Length fast path above:
          // an ECONNRESET reads as retryable to the client, a clean 400 does not.
          // Chunks are dropped as they arrive, so memory stays bounded.
          req.resume();
          await new Promise((r) => { req.on('end', r); req.on('error', r); req.on('close', r); });
          if (res.headersSent || res.writableEnded) return undefined;
          return res.status(400).json({
            error: { status: 'INVALID_ARGUMENT', message: `File too large (max ${maxBytes / 1024 / 1024}MB)` },
          });
        }
        // Client vanished / stalled / io error — the socket is usually already
        // gone, so only answer if we still can.
        if (res.headersSent || res.writableEnded) return undefined;
        return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'Upload failed' } });
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
      console.error('Upload error:', e);
      if (res.headersSent || res.writableEnded) return undefined;
      return res.status(500).json({ error: { status: 'INTERNAL', message: 'Upload failed' } });
    }
  };
}

module.exports = {
  ALLOWED_CONTENT_TYPES,
  ALLOWED_CREATOR_TYPES,
  MAX_PARTICIPANT_BYTES,
  MAX_PARTICIPANT_VIDEO_BYTES,
  MAX_CREATOR_BYTES,
  UPLOAD_STALL_MS,
  TMP_DIR_NAME,
  TMP_TTL_MS,
  classifyUploadPath,
  ownsUploadPath,
  maxBytesFor,
  contentTypeAllowed,
  streamToFileWithLimit,
  sweepStaleTempUploads,
  createUploadHandler,
};
