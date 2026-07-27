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

// Liveness/readiness for the reverse proxy and `docker healthcheck`.
app.get('/healthz', (_req, res) => res.json({ ok: true }));

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
