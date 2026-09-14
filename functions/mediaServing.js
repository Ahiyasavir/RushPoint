// ─── Serving a stored media object over HTTP (change: media-serving-correctness) ──
//
// The three decisions behind `GET /uploads/*` in server.js, extracted so they can be
// tested without booting the API. Pure, total, no `fs`, no `express`, no clock. The
// route stays thin I/O: it does the guards and the streaming, this file decides
// WHAT to declare and WHICH bytes to send.
//
// Factored out the same way `uploadRoute.js` already is — plain CommonJS at the
// `functions/` root, so both `server.js` (shipped verbatim in the API container) and
// a `scripts/test-*.ts` under tsx can load it. NOT under `functions/lib/`: that path
// is the esbuild output directory and is gitignored, so a module placed there would
// be wiped by the next build and never committed.
//
// Motivating production evidence — run `ijI9JMITSf8C9heN1Cwp`, 2026-09-10, 5 teams,
// 15 submissions, 68MB of media:
//   • 4 of 7 videos were unviewable. They were `.webm`, the table said `audio/webm`,
//     and `nosniff` (correctly) forbade the browser from correcting us. The 3 iOS
//     `.mp4` submissions worked, so it presented as intermittent.
//   • Nothing could be previewed before it fully downloaded: no `Accept-Ranges`, no
//     `Content-Length`, and a bare `createReadStream(path).pipe(res)`.
//   • The gallery's download button opened a fullscreen player, because the `download`
//     attribute on an <a> is ignored cross-origin without `Content-Disposition`.
//
// Tested by scripts/test-media-content-type.ts, scripts/test-range-request.ts and
// scripts/test-content-disposition.ts (all in `npm test`).
'use strict';

const fs = require('fs');
const fsPath = require('path');

// ─── Content type ────────────────────────────────────────────────────────────

// Moved here from server.js so the table and the rule that reads it live together.
const EXTENSION_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif',
  '.gif': 'image/gif', '.webm': 'audio/webm', '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.mp4': 'video/mp4',
  '.aac': 'audio/aac', '.3gp': 'audio/3gpp', '.3gpp': 'audio/3gpp', '.amr': 'audio/amr',
  '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
};

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

// Extensions this product genuinely uses for BOTH an audio and a video recording,
// so the name cannot decide. `uploadRoute.js`'s allowlist accepts `audio/webm` AND
// `video/webm`, and both land on disk as `.webm`. Everything else is decided by the
// table alone and never costs a byte of I/O.
const AMBIGUOUS_EXTENSIONS = new Set(['.webm']);

// What an ambiguous extension becomes when the container proves it carries video.
const AMBIGUOUS_VIDEO_TYPES = { '.webm': 'video/webm' };

// How much of the head to inspect. The Tracks element sits near the front of an
// EBML file; 64KB covers every recorder this product accepts with room to spare.
// Getting this too small is HARMLESS by construction — see `resolveContentType`.
const PROBE_PREFIX_BYTES = 64 * 1024;

// A WebM video track declares itself with a CodecID of V_VP8 / V_VP9 / V_AV1; an
// audio-only recording declares only A_OPUS / A_VORBIS. An explicit list, not a
// `V_` prefix scan: random bytes contain two-character sequences constantly, and a
// false positive here would mislabel an audio recording as video.
const VIDEO_CODEC_MARKERS = ['V_VP8', 'V_VP9', 'V_AV1'];

/**
 * Does this EBML/Matroska prefix declare a video track?
 *
 * Total: any non-Buffer, empty or truncated input answers `false`, which the caller
 * reads as "inconclusive". Never throws.
 */
function probeWebmHasVideo(bytePrefix) {
  if (!Buffer.isBuffer(bytePrefix) || bytePrefix.length === 0) return false;
  // 'latin1' maps every byte to exactly one character, so a marker can never be
  // lost to multi-byte decoding or a replacement character the way 'utf8' would.
  const text = bytePrefix.toString('latin1');
  for (let i = 0; i < VIDEO_CODEC_MARKERS.length; i++) {
    if (text.indexOf(VIDEO_CODEC_MARKERS[i]) !== -1) return true;
  }
  return false;
}

/**
 * The Content-Type to declare for a stored object.
 *
 * `bytePrefix` is a bounded head of the file, and is consulted ONLY when the
 * extension is ambiguous. An inconclusive probe falls back to the extension table
 * rather than guessing, which makes this strictly additive: it can only ever
 * upgrade a `.webm` from audio to video, never the reverse — so nothing that
 * renders today can stop rendering.
 */
function resolveContentType(filename, bytePrefix) {
  if (typeof filename !== 'string' || filename.length === 0) return DEFAULT_CONTENT_TYPE;
  const dot = filename.lastIndexOf('.');
  // `lastIndexOf('.') <= 0` covers both "no extension" and a dotfile like `.env`,
  // neither of which names a media type.
  const ext = dot > 0 ? filename.slice(dot).toLowerCase() : '';
  if (AMBIGUOUS_EXTENSIONS.has(ext) && probeWebmHasVideo(bytePrefix)) {
    return AMBIGUOUS_VIDEO_TYPES[ext] || EXTENSION_TYPES[ext] || DEFAULT_CONTENT_TYPE;
  }
  return EXTENSION_TYPES[ext] || DEFAULT_CONTENT_TYPE;
}

/** Would serving this file consult the byte probe? Lets the route skip a read. */
function needsContentProbe(filename) {
  if (typeof filename !== 'string') return false;
  const dot = filename.lastIndexOf('.');
  return AMBIGUOUS_EXTENSIONS.has(dot > 0 ? filename.slice(dot).toLowerCase() : '');
}

// ─── Range ───────────────────────────────────────────────────────────────────

// `bytes = <first>-<last>`, either side optionally absent. Anything else — a
// different unit, a multi-range list, a non-numeric bound — is not something this
// route answers, and degrades to serving the whole entity.
const RANGE_UNIT_RE = /^bytes\s*=\s*(.+)$/i;
const RANGE_SPEC_RE = /^(\d*)-(\d*)$/;

/**
 * Which byte window to serve.
 *
 * Returns `{ status, start, end }` where status is 200 (send everything), 206 (send
 * `[start, end]` inclusive) or 416 (the range cannot be satisfied).
 *
 * TOTAL AND NEVER THROWS, deliberately. `Range` is a header any client may send in
 * any shape; a media route that 500s on a malformed one would be a worse bug than
 * the one this change fixes. Anything unparseable degrades to a plain 200.
 *
 * The containment and traversal guards run in the route BEFORE this and are not its
 * business — this only ever narrows a window inside an already-validated file.
 */
function parseRange(rangeHeader, totalBytes) {
  const whole = { status: 200, start: 0, end: Math.max(0, (totalBytes || 0) - 1) };
  if (typeof rangeHeader !== 'string') return whole;
  if (!Number.isInteger(totalBytes) || totalBytes < 0) return whole;

  const unit = RANGE_UNIT_RE.exec(rangeHeader.trim());
  if (!unit) return whole;
  const spec = unit[1].trim();
  // A multi-range request is legal HTTP, but answering it honestly needs a
  // multipart/byteranges body. Serving only the first part while claiming to have
  // satisfied the request would be a lie, so serve the whole entity instead.
  if (spec.indexOf(',') !== -1) return whole;

  const m = RANGE_SPEC_RE.exec(spec);
  if (!m) return whole;
  const firstRaw = m[1];
  const lastRaw = m[2];
  if (firstRaw === '' && lastRaw === '') return whole;

  // A range against an empty object can never name a byte that exists.
  if (totalBytes === 0) return { status: 416, start: 0, end: 0 };

  let start;
  let end;
  if (firstRaw === '') {
    // Suffix form: the LAST n bytes. `bytes=-0` asks for nothing, which is
    // unsatisfiable rather than empty.
    const suffix = Number(lastRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return { status: 416, start: 0, end: 0 };
    start = Math.max(0, totalBytes - suffix);
    end = totalBytes - 1;
  } else {
    start = Number(firstRaw);
    if (!Number.isFinite(start) || start >= totalBytes) return { status: 416, start: 0, end: 0 };
    end = lastRaw === '' ? totalBytes - 1 : Number(lastRaw);
    if (!Number.isFinite(end)) return whole;
    if (end > totalBytes - 1) end = totalBytes - 1;
    if (end < start) return { status: 416, start: 0, end: 0 };
  }
  return { status: 206, start, end };
}

// ─── Content-Disposition ─────────────────────────────────────────────────────

const FALLBACK_DOWNLOAD_NAME = 'download';
const MAX_DOWNLOAD_NAME_CHARS = 120;

const CODE_QUOTE = 34;
const CODE_BACKSLASH = 92;
const CODE_SLASH = 47;
const CODE_DEL = 127;

// Deliberately a code-point predicate rather than a character class. Every
// character this has to reject is one that a regex literal must itself escape —
// the backslash, the quote, the C0 controls — which is exactly the situation
// CLAUDE.md records a real defect for: a mis-escaped class silently matches
// nothing and the sanitizer passes while sanitizing nothing. A numeric comparison
// cannot be mis-escaped.
function isUnsafeNameCode(code) {
  return code <= 31 || code === CODE_DEL || code === CODE_QUOTE || code === CODE_BACKSLASH;
}
function isPathSeparatorCode(code) {
  return code === CODE_SLASH || code === CODE_BACKSLASH;
}

/** Split on both path separators without a regex. */
function pathSegments(value) {
  const out = [];
  let current = '';
  for (let i = 0; i < value.length; i++) {
    if (isPathSeparatorCode(value.charCodeAt(i))) { out.push(current); current = ''; continue; }
    current += value[i];
  }
  out.push(current);
  return out;
}

/** Drop every character that could break out of a quoted header value. */
function stripUnsafeNameChars(value) {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (!isUnsafeNameCode(value.charCodeAt(i))) out += value[i];
  }
  return out;
}

/**
 * The `Content-Disposition` value that makes a browser SAVE the object.
 *
 * The filename is attacker-influenced — a participant names their own upload — so
 * this is a security boundary, not formatting. A CR or LF reaching a response
 * header is header injection.
 *
 * Falls back to a safe constant whenever the input does not reduce to a plain
 * basename, including when it carries a traversal segment: the route's own guard
 * already refuses those, so one arriving here means something upstream disagrees
 * with us, and offering a name derived from it buys nothing.
 */
function contentDispositionAttachment(filename) {
  const raw = typeof filename === 'string' ? filename : '';
  const segments = pathSegments(raw);
  const traversal = segments.some((s) => s === '.' || s === '..');
  const base = segments[segments.length - 1] || '';
  const stripped = stripUnsafeNameChars(base).trim();
  const safe = (!traversal && stripped && stripped !== '.' && stripped !== '..')
    ? stripped.slice(0, MAX_DOWNLOAD_NAME_CHARS)
    : FALLBACK_DOWNLOAD_NAME;
  return `attachment; filename="${safe}"`;
}

// ─── The route ───────────────────────────────────────────────────────────────

/**
 * `GET /uploads/*` — thin I/O over the three decisions above.
 *
 * Takes its upload directory by injection so a test can mount it on a bare
 * express app against a temp directory, mirroring `createUploadHandler` in
 * uploadRoute.js. Every guard runs BEFORE any file access and is unchanged from
 * the original route; the range only ever narrows a window inside an
 * already-validated path.
 */
function createUploadsGetHandler(deps) {
  const uploadDir = deps.uploadDir;
  const fsImpl = deps.fs || fs;
  const resolvedRoot = fsPath.resolve(uploadDir);

  return function serveUpload(req, res) {
    const relativePath = req.params[0];
    // ── Guards, unchanged, and BEFORE any file access ────────────────────────
    if (!relativePath || relativePath.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    const fullPath = fsPath.join(uploadDir, relativePath);
    // Ensure we don't escape UPLOAD_DIR
    if (!fullPath.startsWith(resolvedRoot)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!fsImpl.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Not found' });
    }

    let totalBytes;
    try {
      const stat = fsImpl.statSync(fullPath);
      if (!stat.isFile()) return res.status(404).json({ error: 'Not found' });
      totalBytes = stat.size;
    } catch (e) {
      return res.status(404).json({ error: 'Not found' });
    }

    // The byte probe costs a read, so it runs ONLY for an extension the filename
    // genuinely cannot decide (today: .webm, which this product uses for both
    // audio and video submissions). A failed probe is inconclusive, not audio.
    let prefix;
    if (needsContentProbe(fullPath) && totalBytes > 0) {
      try {
        const fd = fsImpl.openSync(fullPath, 'r');
        try {
          const want = Math.min(PROBE_PREFIX_BYTES, totalBytes);
          const buf = Buffer.alloc(want);
          const read = fsImpl.readSync(fd, buf, 0, want, 0);
          prefix = read === want ? buf : buf.subarray(0, read);
        } finally { fsImpl.closeSync(fd); }
      } catch (e) { prefix = undefined; }
    }

    res.set('Content-Type', resolveContentType(fullPath, prefix));
    // nosniff is load-bearing here, not boilerplate. Content-Type is derived from
    // the FILENAME (upgraded by a container probe only where the name is genuinely
    // ambiguous), while the upload validated the declared Content-Type HEADER —
    // two different things, so the two can disagree. Without nosniff a browser may
    // ignore our declared type, sniff the bytes and render an uploaded file as
    // HTML on this origin. An unknown extension is served as octet-stream, and
    // nosniff is what makes that verdict stick. It must stay on EVERY response
    // path below, including the 206 and the 416.
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    // Allow cross-origin (play-web fetches from api.rush-point.com).
    res.set('Access-Control-Allow-Origin', '*');
    // A cross-origin reader cannot see these without being told to. A <video>
    // element does not need it, but anything measuring progress in JS does.
    res.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    res.set('Accept-Ranges', 'bytes');
    // Opt-in, because the SAME url renders inline in the review queue and the
    // gallery; sending `attachment` unconditionally would turn every review
    // thumbnail into a download prompt.
    if (req.query && req.query.download) {
      res.set('Content-Disposition', contentDispositionAttachment(fullPath));
    }

    const range = parseRange(req.headers && req.headers.range, totalBytes);

    if (range.status === 416) {
      res.set('Content-Range', `bytes */${totalBytes}`);
      return res.status(416).end();
    }

    const partial = range.status === 206;
    const start = partial ? range.start : 0;
    const end = partial ? range.end : totalBytes - 1;
    res.set('Content-Length', String(totalBytes === 0 ? 0 : end - start + 1));
    if (partial) res.set('Content-Range', `bytes ${start}-${end}/${totalBytes}`);
    res.status(partial ? 206 : 200);

    // Express routes HEAD to the GET handler; answer it with the headers alone so
    // a player can learn the size and that ranges are supported without a transfer.
    if (req.method === 'HEAD') return res.end();
    if (totalBytes === 0) return res.end();

    const stream = fsImpl.createReadStream(fullPath, { start, end });
    // Once headers are sent a read error cannot become a status code, so destroy
    // the response rather than attempting a late res.status() — which would throw
    // and leave the socket hanging.
    stream.on('error', () => { res.destroy(); });
    stream.pipe(res);
    return undefined;
  };
}

module.exports = {
  createUploadsGetHandler,
  EXTENSION_TYPES,
  DEFAULT_CONTENT_TYPE,
  AMBIGUOUS_EXTENSIONS,
  AMBIGUOUS_VIDEO_TYPES,
  PROBE_PREFIX_BYTES,
  VIDEO_CODEC_MARKERS,
  probeWebmHasVideo,
  needsContentProbe,
  resolveContentType,
  parseRange,
  FALLBACK_DOWNLOAD_NAME,
  contentDispositionAttachment,
};
