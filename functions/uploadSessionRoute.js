// ─── /upload/sessions — resumable uploads (change: video-upload-speed, design D4) ──────────
//
// A tus 1.0-shaped subset so a clip can be sent WHILE it is being filmed, and a dropped
// connection resumes from the bytes the server already has instead of re-sending the whole file
// (today's PUT /upload restarts from byte 0 on every attempt, up to 3 times):
//
//   POST   /upload/sessions?path=…   Content-Type: <media>  [Upload-Length]   → 201 {id} + Location
//   HEAD   /upload/sessions/:id                                               → Upload-Offset [+ Upload-Length]
//   PATCH  /upload/sessions/:id      Upload-Offset: n  [Upload-Length: total] → 204 + Upload-Offset, or 200 {url} when complete
//   DELETE /upload/sessions/:id                                               → 204 (retake, discard)
//
// Every guard is uploadRoute.js's OWN function (path, type, ownership, cap, the streaming byte
// limit, the shared concurrency slots and disk floor), called, never restated. The one behavioural
// difference from PUT: on a stall or abort the bytes already received are KEPT. That is the whole
// point, and HEAD reports exactly what is on disk, so the phone resumes from a true offset.
//
// ⚠ SINGLE PROCESS ONLY, like RUSHPOINT_DOC_CACHE and rateLimitStore: the one-PATCH-per-session
// lock and the per-phone session count are an in-memory Map. Two processes could append to one
// session at once and corrupt it. The JSON sidecar lets a RESTART resume; it does not make this
// safe to run with replicas > 1. Remove this route (or move the lock) before scaling out.
const fs = require('fs');
const fsPath = require('path');
const crypto = require('crypto');
const {
  TMP_DIR_NAME,
  UPLOAD_STALL_MS,
  classifyUploadPath,
  ownsUploadPath,
  contentTypeAllowed,
  maxBytesFor: defaultMaxBytesFor,
  streamToFileWithLimit,
  createUploadSlots,
  createDiskGuard,
  uploadLogRecord,
} = require('./uploadRoute.js');

const SESSION_PREFIX = 's-';
const MAX_SESSIONS_PER_UID = 4;
const ID_RE = /^[a-f0-9]{32}$/;

function createUploadSessionRoutes({
  verifyIdToken, uploadDir, resolveOrigin, onResponse, log, slots, belowFloor, statfs, maxBytesFor,
}) {
  const emit = (record) => {
    try { (log || ((r) => console.log(JSON.stringify(r))))(record); } catch { /* telemetry never fails an upload */ }
  };
  const capFor = maxBytesFor || defaultMaxBytesFor;
  const uploadSlots = slots || createUploadSlots();
  const statfsImpl = statfs || (fs.promises.statfs ? (p) => fs.promises.statfs(p) : null);
  const diskLow = belowFloor || (statfsImpl ? createDiskGuard(uploadDir, statfsImpl) : async () => false);
  const tmpDir = fsPath.join(uploadDir, TMP_DIR_NAME);
  const locked = new Set();
  const liveByUid = new Map(); // uid -> Set<id>

  const dataPath = (id) => fsPath.join(tmpDir, `${SESSION_PREFIX}${id}`);
  const metaPath = (id) => fsPath.join(tmpDir, `${SESSION_PREFIX}${id}.json`);
  const err = (res, status, code, message) => res.status(status).json({ error: { status: code, message } });

  function track(uid, id) {
    let set = liveByUid.get(uid);
    if (!set) { set = new Set(); liveByUid.set(uid, set); }
    set.add(id);
  }
  function untrack(uid, id) {
    const set = liveByUid.get(uid);
    if (!set) return;
    set.delete(id);
    if (set.size === 0) liveByUid.delete(uid);
  }

  async function authUid(req, res) {
    const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!m) { err(res, 401, 'UNAUTHENTICATED', 'Missing auth token'); return null; }
    try { return (await verifyIdToken(m[1])).uid; } catch {
      err(res, 401, 'UNAUTHENTICATED', 'Invalid auth token');
      return null;
    }
  }

  // Resolve the session for THIS caller: 404 for unknown/malformed, 403 for another phone's.
  async function loadSession(req, res, uid) {
    const id = String(req.params.id || '');
    if (!ID_RE.test(id)) { err(res, 404, 'NOT_FOUND', 'No such upload'); return null; }
    let meta;
    try { meta = JSON.parse(await fs.promises.readFile(metaPath(id), 'utf8')); } catch {
      err(res, 404, 'NOT_FOUND', 'No such upload');
      return null;
    }
    if (!meta || meta.uid !== uid) { err(res, 403, 'PERMISSION_DENIED', 'Not your upload'); return null; }
    let size = 0;
    try { size = (await fs.promises.stat(dataPath(id))).size; } catch {
      err(res, 404, 'NOT_FOUND', 'No such upload');
      return null;
    }
    return { id, meta, size };
  }

  async function discard(id, uid) {
    untrack(uid, id);
    await Promise.all([dataPath(id), metaPath(id)].map((p) => fs.promises.unlink(p).catch(() => {})));
  }

  async function finalize(req, res, s) {
    const fullPath = fsPath.join(uploadDir, s.meta.path);
    await fs.promises.mkdir(fsPath.dirname(fullPath), { recursive: true });
    await fs.promises.rename(dataPath(s.id), fullPath);
    await fs.promises.unlink(metaPath(s.id)).catch(() => {});
    untrack(s.meta.uid, s.id);
    emit(uploadLogRecord({ contentType: s.meta.contentType, bytes: s.size, ms: Date.now() - s.meta.createdAt, outcome: 'ok', uploadPath: s.meta.path }));
    onResponse?.(req, res);
    return res.json({ url: `${resolveOrigin(req)}/uploads/${encodeURI(s.meta.path)}` });
  }

  const declaredLength = (req) => {
    const raw = req.headers['upload-length'];
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : NaN;
  };

  async function create(req, res) {
    try {
      const uid = await authUid(req, res);
      if (!uid) return undefined;
      const uploadPath = req.query.path;
      const kind = classifyUploadPath(uploadPath);
      if (!kind) return err(res, 400, 'INVALID_ARGUMENT', 'Invalid path');
      const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!contentTypeAllowed(kind, contentType)) return err(res, 400, 'INVALID_ARGUMENT', `Content type not allowed: ${contentType}`);
      if (!ownsUploadPath(kind, uploadPath, uid)) return err(res, 403, 'PERMISSION_DENIED', 'Cannot upload to another team folder');
      const maxBytes = capFor(kind, contentType);
      const length = declaredLength(req);
      if (Number.isNaN(length)) return err(res, 400, 'INVALID_ARGUMENT', 'Bad Upload-Length');
      if (length !== undefined && length > maxBytes) return err(res, 400, 'INVALID_ARGUMENT', `File too large (max ${maxBytes / 1024 / 1024}MB)`);
      if (await diskLow()) {
        emit(uploadLogRecord({ contentType, bytes: 0, ms: 0, outcome: 'disk-floor', uploadPath }));
        res.set('Retry-After', '30');
        return err(res, 507, 'RESOURCE_EXHAUSTED', 'Server storage is full');
      }
      if ((liveByUid.get(uid)?.size || 0) >= MAX_SESSIONS_PER_UID) {
        res.set('Retry-After', '3');
        return err(res, 503, 'UNAVAILABLE', 'Too many open uploads on this phone');
      }
      await fs.promises.mkdir(tmpDir, { recursive: true });
      const id = crypto.randomBytes(16).toString('hex');
      await fs.promises.writeFile(dataPath(id), Buffer.alloc(0));
      const meta = { uid, path: uploadPath, contentType, maxBytes, createdAt: Date.now(), ...(length !== undefined ? { length } : {}) };
      await fs.promises.writeFile(metaPath(id), JSON.stringify(meta));
      track(uid, id);
      onResponse?.(req, res);
      res.set('Location', `/upload/sessions/${id}`);
      return res.status(201).json({ id });
    } catch (e) {
      console.error('Upload session create error:', e);
      if (res.headersSent) return undefined;
      return err(res, 500, 'INTERNAL', 'Upload failed');
    }
  }

  async function head(req, res) {
    try {
      const uid = await authUid(req, res);
      if (!uid) return undefined;
      const s = await loadSession(req, res, uid);
      if (!s) return undefined;
      res.set('Cache-Control', 'no-store');
      res.set('Upload-Offset', String(s.size));
      if (s.meta.length) res.set('Upload-Length', String(s.meta.length));
      onResponse?.(req, res);
      return res.status(200).end();
    } catch (e) {
      if (res.headersSent) return undefined;
      return res.status(500).end();
    }
  }

  async function patch(req, res) {
    let slot;
    let lockedId;
    try {
      const uid = await authUid(req, res);
      if (!uid) return undefined;
      const s = await loadSession(req, res, uid);
      if (!s) return undefined;
      if (locked.has(s.id)) {
        res.set('Upload-Offset', String(s.size));
        return err(res, 409, 'ABORTED', 'Another append is in progress');
      }
      const offset = Number(req.headers['upload-offset']);
      if (!Number.isInteger(offset) || offset !== s.size) {
        res.set('Upload-Offset', String(s.size));
        return err(res, 409, 'FAILED_PRECONDITION', 'Offset does not match');
      }
      const length = declaredLength(req);
      if (Number.isNaN(length)) return err(res, 400, 'INVALID_ARGUMENT', 'Bad Upload-Length');
      if (length !== undefined) {
        if (length > s.meta.maxBytes || length < s.size) return err(res, 400, 'INVALID_ARGUMENT', 'Bad Upload-Length');
        s.meta.length = length;
      }
      if (await diskLow()) {
        emit(uploadLogRecord({ contentType: s.meta.contentType, bytes: 0, ms: 0, outcome: 'disk-floor', uploadPath: s.meta.path }));
        res.set('Retry-After', '30');
        return err(res, 507, 'RESOURCE_EXHAUSTED', 'Server storage is full');
      }
      slot = uploadSlots.acquire(uid);
      if (!slot.ok) {
        slot = undefined;
        res.set('Retry-After', '3');
        return err(res, 503, 'UNAVAILABLE', 'Too many uploads right now');
      }
      locked.add(s.id);
      lockedId = s.id;
      // Keep the sidecar fresh so an ACTIVE long upload is never mistaken for a stale one by the
      // temp sweep (which judges by mtime).
      const now = new Date();
      await fs.promises.writeFile(metaPath(s.id), JSON.stringify(s.meta));
      await fs.promises.utimes(dataPath(s.id), now, now).catch(() => {});

      const room = s.meta.maxBytes - s.size;
      let received;
      try {
        received = await streamToFileWithLimit(req, dataPath(s.id), room, UPLOAD_STALL_MS, { flags: 'a' });
      } catch (e) {
        const reason = (e && e.reason) || 'io';
        if (reason === 'too-large') {
          // Can never complete: drop the session, drain, and refuse PERMANENTLY (400).
          await discard(s.id, uid);
          if (!req.readableEnded && !req.destroyed) {
            await new Promise((r) => { req.on('end', r); req.on('error', r); req.on('close', r); req.resume(); });
          }
          if (res.headersSent || res.writableEnded) return undefined;
          return err(res, 400, 'INVALID_ARGUMENT', `File too large (max ${s.meta.maxBytes / 1024 / 1024}MB)`);
        }
        // Stall / abort / io: the bytes on disk are KEPT. HEAD will report them.
        emit(uploadLogRecord({ contentType: s.meta.contentType, bytes: 0, ms: Date.now() - s.meta.createdAt, outcome: `session-${reason}`, uploadPath: s.meta.path }));
        if (res.headersSent || res.writableEnded) return undefined;
        const size = await fs.promises.stat(dataPath(s.id)).then((st) => st.size).catch(() => s.size);
        res.set('Upload-Offset', String(size));
        return err(res, reason === 'stalled' ? 408 : 500, reason === 'stalled' ? 'DEADLINE_EXCEEDED' : 'INTERNAL', 'Upload interrupted');
      }
      s.size += received;
      if (s.meta.length && s.size >= s.meta.length) {
        if (s.size !== s.meta.length) {
          // More bytes than declared: never a valid file.
          await discard(s.id, uid);
          return err(res, 400, 'INVALID_ARGUMENT', 'More bytes than Upload-Length');
        }
        return await finalize(req, res, s);
      }
      onResponse?.(req, res);
      res.set('Upload-Offset', String(s.size));
      return res.status(204).end();
    } catch (e) {
      console.error('Upload session patch error:', e);
      if (res.headersSent) return undefined;
      return err(res, 500, 'INTERNAL', 'Upload failed');
    } finally {
      if (lockedId) locked.delete(lockedId);
      if (slot) slot.release();
    }
  }

  async function remove(req, res) {
    try {
      const uid = await authUid(req, res);
      if (!uid) return undefined;
      const s = await loadSession(req, res, uid);
      if (!s) return undefined;
      await discard(s.id, uid);
      onResponse?.(req, res);
      return res.status(204).end();
    } catch (e) {
      if (res.headersSent) return undefined;
      return err(res, 500, 'INTERNAL', 'Delete failed');
    }
  }

  return { create, head, patch, remove };
}

module.exports = { createUploadSessionRoutes, SESSION_PREFIX, MAX_SESSIONS_PER_UID };
