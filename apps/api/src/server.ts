// ─── The Fastify app factory ─────────────────────────────────────────────────
//
// DEPLOYMENT.md §4.1 picks Fastify; §4.5 says ONE process, no `cluster`, under
// systemd with `Restart=always`.
//
// This file is deliberately THIN. All protocol decisions live in `callable.ts`
// (framework-free, gated offline by scripts/test-api-contract.ts); everything
// here is adapting Fastify's request/reply to `CallableRequest`/`CallableResponse`.
// If you find yourself writing a status code or an error shape in this file,
// it belongs in `callable.ts` instead.
//
// It EXPORTS A FACTORY and never listens on import — `index.ts` owns the socket.
// That is what lets the contract gate use `app.inject()` with no port bound.

import Fastify, { type FastifyInstance } from 'fastify';
import {
  CallableRegistry,
  handleCallableRequest,
  toErrorResponse,
  HttpsError,
  type CallableDefinition,
  type CallableLogger,
} from './callable.js';
import { createAuthResolver, type IdTokenVerifier } from './auth.js';
import { withDefaults, type PartialApiDeps, type ApiDeps } from './deps.js';

export interface CreateServerOptions {
  /** Everything a handler may reach for. See deps.ts. */
  deps: PartialApiDeps;
  /**
   * Verifies a Firebase ID token. INJECTED — see auth.ts. `index.ts` passes the
   * real firebase-admin verifier; a test passes a fake and stays offline.
   */
  verifyIdToken: IdTokenVerifier;
  /** Defaults to `ALL_CALLABLES`; a test may mount its own set. */
  callables?: ReadonlyArray<CallableDefinition<ApiDeps>>;
  /**
   * Allowed browser origins. DEPLOYMENT.md §4.2: this is a CROSS-ORIGIN
   * deployment now, and a missed preflight presents as a total client outage.
   * Empty list ⇒ reflect any origin (dev only — `index.ts` refuses that in prod).
   */
  allowedOrigins?: string[];
  /** Passed straight to Fastify. `false` silences logs in a test. */
  logger?: boolean | Record<string, unknown>;
}

/** Headers the browser must be allowed to send on the real request. */
const ALLOWED_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'x-firebase-appcheck',
  'firebase-instance-id-token',
].join(', ');

export async function createServer(opts: CreateServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? 'info' },
    // Keep Fastify's own error/404 bodies from ever reaching a client: every
    // response this server produces must be a callable envelope (see below).
    disableRequestLogging: false,
  });

  const deps = withDefaults(opts.deps);
  const registry = new CallableRegistry<ApiDeps>();
  const callables = opts.callables ?? (await import('./callables/index.js')).ALL_CALLABLES;
  registry.registerAll(callables);
  const resolveAuth = createAuthResolver(opts.verifyIdToken);

  // ── Body parsing ───────────────────────────────────────────────────────────
  // Fastify's stock JSON parser answers malformed JSON with its OWN 400 body,
  // which is not a callable envelope. Parse permissively instead and let
  // `isValidCallableRequest` produce the `invalid-argument` envelope, exactly as
  // firebase-functions does.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string | Buffer, done) => {
      try {
        done(null, JSON.parse(String(body) || 'null'));
      } catch {
        done(null, undefined);
      }
    },
  );
  // Any other content type is not a callable request. Swallow the body so the
  // validity check (not a parser crash) is what rejects it.
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, _body, done) => done(null, undefined));

  // ── CORS ───────────────────────────────────────────────────────────────────
  const allowed = opts.allowedOrigins ?? [];
  const originAllowed = (origin: string | undefined): string | null => {
    if (!origin) return null;
    if (allowed.length === 0) return origin; // dev-only wildcard-by-reflection
    return allowed.includes(origin) ? origin : null;
  };

  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin as string | undefined;
    const echo = originAllowed(origin);
    if (echo) {
      reply.header('access-control-allow-origin', echo);
      reply.header('vary', 'Origin');
      reply.header('access-control-allow-credentials', 'false');
    }
  });

  // Preflight. The Firebase SDK sends `Authorization` + `Content-Type`, so both
  // MUST be listed or every call fails before it is made.
  app.options('/*', async (req, reply) => {
    reply
      .header('access-control-allow-methods', 'POST, OPTIONS')
      .header('access-control-allow-headers', ALLOWED_REQUEST_HEADERS)
      .header('access-control-max-age', '3600')
      .code(204)
      .send();
  });

  // ── Health ─────────────────────────────────────────────────────────────────
  // Plain JSON, NOT a callable envelope: this is for systemd/Caddy/uptime, and
  // nothing in `calls.ts` ever reads it.
  app.get('/healthz', async () => ({
    ok: true,
    callables: registry.names().length,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  // ── The callable surface ───────────────────────────────────────────────────
  // `POST /<callableName>` — one path segment, exactly what
  // `getFunctions(app, VITE_API_ORIGIN)` + `httpsCallable(name)` produces.
  app.post<{ Params: { name: string } }>('/:name', async (req, reply) => {
    const logger: CallableLogger = {
      info: (o, m) => req.log.info(o, m),
      warn: (o, m) => req.log.warn(o, m),
      error: (o, m) => req.log.error(o, m),
    };
    const started = Date.now();
    const res = await handleCallableRequest(
      {
        method: req.method,
        name: req.params.name,
        headers: req.headers as Record<string, string | string[] | undefined>,
        body: req.body,
      },
      { registry, deps, resolveAuth, logger },
    );
    // Structured, one line per call — the shape §4.5 wants in journald, and the
    // shape the p99 alert (>5 s, against the client's 20 s timeout) reads.
    req.log.info(
      { callable: req.params.name, status: res.status, ms: Date.now() - started },
      'callable',
    );
    for (const [k, v] of Object.entries(res.headers)) reply.header(k, v);
    return reply.code(res.status).send(res.body);
  });

  // ── Everything else still speaks the envelope ──────────────────────────────
  app.setNotFoundHandler(async (req, reply) => {
    const res = toErrorResponse(
      new HttpsError('not-found', `Unknown callable: ${req.url.replace(/^\//, '')}`),
    );
    return reply.code(res.status).send(res.body);
  });

  app.setErrorHandler(async (err, req, reply) => {
    req.log.error({ err: String(err) }, 'unhandled');
    const res = toErrorResponse(err);
    return reply.code(res.status).send(res.body);
  });

  return app;
}
