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
// The origin the callables accept unconditionally. Minting URLs here means a missing
// VPS_UPLOAD_ORIGIN can no longer produce a URL our own validator refuses — which is how
// stored task media got deleted (change: task-media-durability).
//
// MUST equal RUSHPOINT_UPLOAD_ORIGINS[0] in packages/shared/src/validation.ts. It is
// duplicated rather than imported because this file is plain CJS loaded before the
// bundle, and requiring the bundle here would run it ahead of admin.initializeApp().
// scripts/test-upload-origin-parity.ts fails if the two ever drift.
const CANONICAL_UPLOAD_ORIGIN = 'https://api.rush-point.com';

// The upload route (content-type allowlists, size caps and the streaming write)
// lives in uploadRoute.js so it can be tested without this file's built-bundle
// and Admin-SDK dependencies.
const { createUploadHandler, sweepStaleTempUploads } = require('./uploadRoute.js');

// The marketing CMS's GitHub token exchange. Same reasoning: a self-contained
// route factored out so it can be tested without this file's dependencies.
const { createOAuthHandlers } = require('./oauthRoute.js');

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

// ── The marketing CMS's GitHub sign in (change: marketing-cms-oauth) ──────
//
// Decap CMS is a static page; the token it needs can only be minted with a client
// secret, so the exchange lives here. See oauthRoute.js for the whole handshake.
//
// The redirect URI must match the GitHub OAuth application's "Authorization
// callback URL" byte for byte, so it is derived from the same canonical origin
// the uploads use rather than from the request, which is behind a proxy.
const oauth = createOAuthHandlers({
  clientId: process.env.OAUTH_GITHUB_CLIENT_ID || '',
  clientSecret: process.env.OAUTH_GITHUB_CLIENT_SECRET || '',
  redirectUri: process.env.OAUTH_GITHUB_REDIRECT_URI
    || `${VPS_UPLOAD_ORIGIN || CANONICAL_UPLOAD_ORIGIN}/oauth/callback`,
  // Which pages may be handed a GitHub token. Falls back to the API's own origin
  // allow-list, which already names the marketing site — a SEPARATE variable
  // exists so the CMS can be limited to fewer origins than the API serves, never
  // more. Unset and empty both mean "not configured", and refuse every sign in.
  allowedOrigins: (process.env.OAUTH_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
});
app.get('/oauth/callback', (req, res) => oauth.callback(req, res));
app.get('/oauth', (req, res) => oauth.begin(req, res));

// ── File upload + serving (change: vps-upload-route) ──────────────────────
// With Firebase Storage behind Blaze billing (no bucket), uploads are routed
// through this server instead. Files are saved to /data/uploads/<path> (where
// <path> mirrors the same Firebase Storage scheme: runs/{runId}/teams/{teamId}/…
// and gameMedia/{ownerUid}/…). The download URL is just a static-serve path
// on this origin.

// Cross-origin PUT with Authorization preflights here (callables handle their own
// CORS; this route is custom). The upload body is NOT parsed by middleware — the
// handler streams it to disk itself (change: stream-upload-write); see
// uploadRoute.js for why buffering it was a memory hazard.
app.options('/upload', (req, res) => {
  reflectCors(req, res);
  res.set('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Max-Age', '86400');
  res.sendStatus(204);
});

app.put('/upload', createUploadHandler({
  verifyIdToken: (token) => admin.auth().verifyIdToken(token),
  uploadDir: UPLOAD_DIR,
  // The request-derived form is the LAST resort (change: task-media-durability).
  // Express has no `trust proxy` here, so behind Caddy `req.protocol` reads 'http'
  // — and an http:// URL is both mixed content in the browser AND unrecognised by
  // every accept-set mode, which meant the next autosave silently deleted the
  // creator's picture from Firestore. Prefer the configured origin, then the
  // compiled-in canonical one, and read x-forwarded-proto if we ever get that far.
  resolveOrigin: (req) => {
    const fwdProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    return VPS_UPLOAD_ORIGIN
      || CANONICAL_UPLOAD_ORIGIN
      || `${fwdProto || req.protocol}://${req.get('host')}`;
  },
  onResponse: reflectCors,
}));

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

// Clear temp files orphaned by a process that died mid-upload (change:
// stream-upload-write). Best-effort and non-blocking — a failure here must never
// stop the API from booting.
sweepStaleTempUploads(UPLOAD_DIR)
  .then((n) => {
    // eslint-disable-next-line no-console
    if (n > 0) console.log(`Swept ${n} stale upload temp file(s)`);
  })
  .catch(() => {});

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`RushPoint API listening on ${host}:${port} — ${mounted.length} callables mounted`);
});

module.exports = { app };
