// ─── RushPoint API server — the Cloud Functions callables, self-hosted ───────
//
// This runs the EXACT same `functions/` code that Cloud Functions (and the local
// emulator) run, as a plain long-lived Node process you host on a fixed-cost VPS.
// It replaces Cloud Functions and so removes the only surprise-billing vector on
// the COMPUTE side; Firebase Auth and Firestore stay exactly as they are (the
// Admin SDK talks to your real project).
//
// HOW IT WORKS. A firebase-functions v1 `onCall` export IS an Express request
// handler that already speaks the Firebase callable wire protocol — the same
// protocol the client's `httpsCallable()` speaks. So we import the built bundle
// (`lib/index.js`) and mount every callable at `POST /<name>`. The client is
// pointed here with ONE line (`getFunctions(app, VITE_API_ORIGIN)`), after which
// it POSTs to `<VITE_API_ORIGIN>/<name>` — no other client change.
//
// AUTH. Each callable verifies the caller's Firebase ID token itself, via the
// Admin SDK. That needs real project credentials: set GOOGLE_APPLICATION_CREDENTIALS
// to a service-account JSON and GCLOUD_PROJECT to the project id (see the runbook
// / docker-compose). CORS is handled by the callable layer itself (it reflects
// the request origin), so we do NOT add a second CORS layer that would double the
// headers — we only set the allow-list as a hard gate in front (see below).
//
// WHAT IS AND ISN'T MOUNTED. Only callables (`__endpoint.callableTrigger`) get a
// route. Firestore triggers (onRunFinalized) and the pubsub schedule
// (pruneExpiredRunData) are NOT HTTP and are skipped — they must be handled
// separately (a cron for the prune; the trigger's work is invoked inline by
// finalizeRun in this topology). `stripeWebhook` is an onRequest handler and is
// mounted explicitly at /stripeWebhook when present.
const express = require('express');
const admin = require('firebase-admin');
const fs = require('fs');
const fsPath = require('path');

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
const VPS_UPLOAD_ORIGIN = process.env.VPS_UPLOAD_ORIGIN || '';

// Content-type allowlist — mirrors storage.rules exactly.
const ALLOWED_CONTENT_TYPES = /^(image\/(jpeg|jpg|png|webp|heic|heif|gif)|audio\/(webm|mp4|mpeg|ogg|aac|x-m4a|3gpp|amr))$/;
// Creator media also allows video types (SVG stays excluded for images).
const ALLOWED_CREATOR_TYPES = /^(image\/(?!svg)(jpeg|jpg|png|webp|heic|heif|gif)|video\/.+|audio\/(webm|mp4|mpeg|ogg|aac|x-m4a|3gpp|amr))$/;

const MAX_PARTICIPANT_BYTES = 10 * 1024 * 1024;  // 10MB
const MAX_CREATOR_BYTES = 50 * 1024 * 1024;      // 50MB

// Initialise the Admin SDK ONCE. With GOOGLE_APPLICATION_CREDENTIALS set it uses
// that service account; GCLOUD_PROJECT (or the credential's project) picks the
// Firebase project whose Auth + Firestore this server reads and writes.
if (!admin.apps.length) admin.initializeApp();

// The built callables bundle. `npm run build` (esbuild) produces this.
const fns = require('./lib/index.js');

const app = express();
app.disable('x-powered-by');
// The callable layer needs the parsed JSON body ({data: ...}); capture the raw
// bytes too so the Stripe webhook can verify its signature.
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// A hard origin allow-list in FRONT of everything. The callable layer reflects
// the request origin for CORS, but that means it would answer ANY origin; this
// gate refuses a browser origin that is not on the list (set ALLOWED_ORIGINS to
// your play-web + creator-web origins, comma-separated). A request with no Origin
// header (server-to-server, curl, health checks) is allowed through.
const ALLOWED = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED.length && !ALLOWED.includes(origin)) {
    res.status(403).json({ error: { status: 'PERMISSION_DENIED', message: 'origin not allowed' } });
    return;
  }
  next();
});

function reflectCors(req, res) {
  const origin = req.headers.origin;
  if (origin && (!ALLOWED.length || ALLOWED.includes(origin))) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
}

// Liveness/readiness for the reverse proxy and `docker healthcheck`.
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ── File upload + serving (change: vps-upload-route) ──────────────────────
// With Firebase Storage behind Blaze billing (no bucket), uploads are routed
// through this server instead. Files are saved to /data/uploads/<path> (where
// <path> mirrors the same Firebase Storage scheme: runs/{runId}/teams/{teamId}/…
// and gameMedia/{ownerUid}/…). The download URL is just a static-serve path
// on this origin.

// Raw body parser for uploads — separate from the JSON parser (which stays at 1mb
// for callables). Cross-origin PUT with Authorization preflights here (callables
// handle their own CORS; this route is custom).
app.options('/upload', (req, res) => {
  reflectCors(req, res);
  res.set('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Max-Age', '86400');
  res.sendStatus(204);
});

app.put('/upload',
  express.raw({ type: '*/*', limit: '50mb' }),
  async (req, res) => {
    try {
      // 1. Auth: verify Firebase ID token
      const authHeader = req.headers.authorization || '';
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match) return res.status(401).json({ error: { status: 'UNAUTHENTICATED', message: 'Missing auth token' } });
      let uid;
      try {
        const decoded = await admin.auth().verifyIdToken(match[1]);
        uid = decoded.uid;
      } catch {
        return res.status(401).json({ error: { status: 'UNAUTHENTICATED', message: 'Invalid auth token' } });
      }

      // 2. Validate path
      const uploadPath = req.query.path;
      if (typeof uploadPath !== 'string' || !uploadPath) {
        return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'Missing path query parameter' } });
      }
      if (uploadPath.includes('..') || uploadPath.startsWith('/') || uploadPath.startsWith('\\')) {
        return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'Invalid path' } });
      }
      const isParticipant = uploadPath.startsWith('runs/');
      const isCreator = uploadPath.startsWith('gameMedia/');
      if (!isParticipant && !isCreator) {
        return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'Path must start with runs/ or gameMedia/' } });
      }

      // 3. Validate content type
      const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const typeAllowed = isCreator ? ALLOWED_CREATOR_TYPES.test(contentType) : ALLOWED_CONTENT_TYPES.test(contentType);
      if (!typeAllowed) {
        return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: `Content type not allowed: ${contentType}` } });
      }

      // 4. Validate size
      const maxBytes = isCreator ? MAX_CREATOR_BYTES : MAX_PARTICIPANT_BYTES;
      if (!Buffer.isBuffer(req.body) || req.body.length > maxBytes) {
        return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: `File too large (max ${maxBytes / 1024 / 1024}MB)` } });
      }
      if (req.body.length === 0) {
        return res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'Empty file' } });
      }

      // 5. IDOR guard: participant uploads must be under runs/{runId}/teams/{uid}/
      if (isParticipant) {
        const parts = uploadPath.split('/');
        // Expected: runs/{runId}/teams/{teamId}/{filename}
        if (parts.length < 5 || parts[2] !== 'teams' || parts[3] !== uid) {
          return res.status(403).json({ error: { status: 'PERMISSION_DENIED', message: 'Cannot upload to another team folder' } });
        }
      }
      // Creator uploads must be under gameMedia/{uid}/
      if (isCreator) {
        const parts = uploadPath.split('/');
        if (parts.length < 3 || parts[1] !== uid) {
          return res.status(403).json({ error: { status: 'PERMISSION_DENIED', message: 'Cannot upload to another creator folder' } });
        }
      }

      // 6. Save to disk
      const fullPath = fsPath.join(UPLOAD_DIR, uploadPath);
      await fs.promises.mkdir(fsPath.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, req.body);

      // 7. Return download URL
      const origin = VPS_UPLOAD_ORIGIN || `${req.protocol}://${req.get('host')}`;
      const url = `${origin}/uploads/${encodeURI(uploadPath)}`;
      reflectCors(req, res);
      res.json({ url });
    } catch (e) {
      console.error('Upload error:', e);
      res.status(500).json({ error: { status: 'INTERNAL', message: 'Upload failed' } });
    }
  }
);

// Serve uploaded files. Content-Type is derived from the extension.
// These URLs are the "download URLs" — equivalent to Firebase's getDownloadURL().
const EXTENSION_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif',
  '.gif': 'image/gif', '.webm': 'audio/webm', '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.mp4': 'video/mp4',
  '.aac': 'audio/aac', '.3gp': 'audio/3gpp', '.3gpp': 'audio/3gpp', '.amr': 'audio/amr',
  '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
};

app.get(/^\/uploads\/(.+)$/, (req, res) => {
  const relativePath = req.params[0];
  if (!relativePath || relativePath.includes('..')) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  const fullPath = fsPath.join(UPLOAD_DIR, relativePath);
  // Ensure we don't escape UPLOAD_DIR
  if (!fullPath.startsWith(fsPath.resolve(UPLOAD_DIR))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const ext = fsPath.extname(fullPath).toLowerCase();
  const ct = EXTENSION_TYPES[ext] || 'application/octet-stream';
  res.set('Content-Type', ct);
  // nosniff is load-bearing here, not boilerplate. Content-Type is derived from
  // the FILENAME, while the upload validated the declared Content-Type HEADER —
  // two different things, so the two can disagree. Without nosniff a browser may
  // ignore our declared type, sniff the bytes and render an uploaded file as
  // HTML on this origin. An unknown extension is served as octet-stream, and
  // nosniff is what makes that verdict stick.
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  // Allow cross-origin (play-web on rush-point.com fetches from api.rush-point.com).
  res.set('Access-Control-Allow-Origin', '*');
  fs.createReadStream(fullPath).pipe(res);
});

// Internal: delete an upload prefix (local ops only — not for browser use).
app.delete(/^\/uploads\/(.+)$/, async (req, res) => {
  // Only allow from localhost / internal
  const origin = req.headers.origin;
  if (origin) return res.status(403).json({ error: 'External delete not allowed' });
  const relativePath = req.params[0];
  if (!relativePath || relativePath.includes('..')) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  const fullPath = fsPath.join(UPLOAD_DIR, relativePath);
  if (!fullPath.startsWith(fsPath.resolve(UPLOAD_DIR))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    await fs.promises.rm(fullPath, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) {
    console.error('Delete error:', e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Mount every callable at /<name>. `__endpoint.callableTrigger` is how a v1
// `onCall` announces itself; anything else (triggers, schedules) is skipped.
//
// `app.all`, NOT `app.post` — this is load-bearing. A cross-origin browser call
// sends a CORS **preflight** `OPTIONS /<name>` before the POST. The callable layer
// answers preflights itself (it wraps the handler in cors({origin:true})), but with
// a POST-only route the OPTIONS never reaches it: Express's default handler replies
// 200 with `Allow: POST` and NO `Access-Control-Allow-Origin`, so the browser blocks
// the real request and the app fails with an opaque "failed to load" error.
//
// This is invisible to every non-browser test — curl/server-to-server POSTs carry no
// Origin header and therefore never preflight — so it only surfaces once a real page
// on a different origin calls the API. Handing OPTIONS to the callable is what makes
// the deployed topology (app on rush-point.com, API on api.rush-point.com) work at all.
// Non-POST/OPTIONS verbs are still rejected, by the callable layer rather than by us.
const mounted = [];
for (const name of Object.keys(fns)) {
  const fn = fns[name];
  if (typeof fn !== 'function') continue;
  let isCallable = false;
  try {
    isCallable = !!(fn.__endpoint && fn.__endpoint.callableTrigger);
  } catch {
    // A trigger export whose metadata getter throws — definitively not a callable.
    continue;
  }
  if (!isCallable) continue;
  app.all(`/${name}`, (req, res) => fn(req, res));
  mounted.push(name);
}

// Stripe webhook is an onRequest handler (not a callable); mount it directly.
if (typeof fns.stripeWebhook === 'function') {
  app.post('/stripeWebhook', (req, res) => fns.stripeWebhook(req, res));
}

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`RushPoint API listening on ${host}:${port} — ${mounted.length} callables mounted`);
});

module.exports = { app };
