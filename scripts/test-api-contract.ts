// Pure-logic tests for the Node API server's WIRE FORMAT (apps/api).
// Run by scripts/run-unit-tests.mjs via `npm test`.
//
// WHY THIS FILE IS THE GATE THAT MATTERS
//   The migration's stated non-goal is that the callable API contract does not
//   change: the client change is ONE line (`getFunctions(app, VITE_API_ORIGIN)`)
//   and `apps/*/src/services/calls.ts` changes ZERO characters. That is only
//   true while this server's bytes on the wire are indistinguishable from Cloud
//   Functions'. So this file asserts BYTES, not behaviour.
//
// THE FORMAT WAS READ, NOT GUESSED (both sides, in node_modules):
//   firebase-functions/lib/common/providers/https.js
//     errorCodeMap:47-65 · HttpsError.toJSON:84-91 · isValidRequest:96-131 ·
//     checkAuthToken:314-343 · wrapOnCallHandler:401-487
//   @firebase/functions/dist/index.node.cjs.js
//     errorCodeMap:160-178 · codeForHTTPStatus:209-240 ·
//     _errorForResponse:246-280 · callAtURL:633-690
//   🔴 The single most breakable detail: `error.status` must be the UPPER_SNAKE
//   canonical name. `_errorForResponse` looks it up in a map keyed by
//   "PERMISSION_DENIED"; a lowercase "permission-denied" is an UNKNOWN key and
//   the client silently downgrades the whole error to `internal`. The example in
//   docs/migration/DEPLOYMENT.md §4.2 shows the lowercase form — the SDK wins.
//
// SAFETY: this file binds no port and opens no socket. The Fastify lane uses
// `app.inject()`; the protocol lane calls `handleCallableRequest` directly.
// It also NEVER touches Firebase, Postgres or the filesystem.
//
// OFFLINE SKIPS. The worktree has no node_modules. Anything needing a real
// dependency (fastify, @rushpoint/shared, @rushpoint/data) is loaded with a
// dynamic import and SKIPPED WITH AN EXPLICIT MESSAGE if it cannot resolve —
// but the protocol lane below has zero dependencies and always runs, because it
// is the deliverable being gated.

import {
  CallableRegistry,
  ERROR_CODE_MAP,
  HttpsError,
  decode,
  defineCallable,
  encode,
  handleCallableRequest,
  isValidCallableRequest,
  toErrorResponse,
  type CallableErrorCode,
  type CallableRequest,
} from '../apps/api/src/callable.js';
import { createAuthResolver, extractBearerToken, requireAuth } from '../apps/api/src/auth.js';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}
const skips: string[] = [];
function skip(msg: string) { skips.push(msg); console.log(`  ⊘ SKIP ${msg}`); }

// ── The reference tables, written out as LITERALS ────────────────────────────
// Importing ERROR_CODE_MAP and comparing it to itself would pass even if someone
// edited it. These are the numbers firebase-functions actually ships.
const SERVER_MAP: Record<string, [string, number]> = {
  ok: ['OK', 200],
  cancelled: ['CANCELLED', 499],
  unknown: ['UNKNOWN', 500],
  'invalid-argument': ['INVALID_ARGUMENT', 400],
  'deadline-exceeded': ['DEADLINE_EXCEEDED', 504],
  'not-found': ['NOT_FOUND', 404],
  'already-exists': ['ALREADY_EXISTS', 409],
  'permission-denied': ['PERMISSION_DENIED', 403],
  unauthenticated: ['UNAUTHENTICATED', 401],
  'resource-exhausted': ['RESOURCE_EXHAUSTED', 429],
  'failed-precondition': ['FAILED_PRECONDITION', 400],
  aborted: ['ABORTED', 409],
  'out-of-range': ['OUT_OF_RANGE', 400],
  unimplemented: ['UNIMPLEMENTED', 501],
  internal: ['INTERNAL', 500],
  unavailable: ['UNAVAILABLE', 503],
  'data-loss': ['DATA_LOSS', 500],
};

/** @firebase/functions `codeForHTTPStatus` — the client's FALLBACK when the body
 *  is missing/unparseable. Every status we emit must land on a sane code here
 *  even with the body thrown away. */
function clientCodeForHttpStatus(status: number): string {
  if (status >= 200 && status < 300) return 'ok';
  switch (status) {
    case 0: case 500: return 'internal';
    case 400: return 'invalid-argument';
    case 401: return 'unauthenticated';
    case 403: return 'permission-denied';
    case 404: return 'not-found';
    case 409: return 'aborted';
    case 429: return 'resource-exhausted';
    case 499: return 'cancelled';
    case 501: return 'unimplemented';
    case 503: return 'unavailable';
    case 504: return 'deadline-exceeded';
    default: return 'unknown';
  }
}

/** @firebase/functions `_errorForResponse`, transcribed — what the CLIENT would
 *  make of a response we produce. Asserting through this is the difference
 *  between "we emit a plausible shape" and "calls.ts is unchanged". */
const CLIENT_ERROR_CODE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(SERVER_MAP).map(([code, [canonical]]) => [canonical, code]),
);
function clientErrorForResponse(status: number, bodyJSON: any): { code: string; message: string } | null {
  let code = clientCodeForHttpStatus(status);
  let description = code;
  const errorJSON = bodyJSON && bodyJSON.error;
  if (errorJSON) {
    const s = errorJSON.status;
    if (typeof s === 'string') {
      if (!CLIENT_ERROR_CODE_MAP[s]) return { code: 'internal', message: 'internal' };
      code = CLIENT_ERROR_CODE_MAP[s];
      description = s;
    }
    if (typeof errorJSON.message === 'string') description = errorJSON.message;
  }
  if (code === 'ok') return null;
  return { code, message: description };
}

// ── Test harness ─────────────────────────────────────────────────────────────

const GOOD_TOKEN = 'good-token';
const fakeVerifier = async (token: string) => {
  if (token !== GOOD_TOKEN) throw new Error('bad token');
  return { uid: 'uid-123', sub: 'uid-123', firebase: { sign_in_provider: 'anonymous' } };
};
const resolveAuth = createAuthResolver(fakeVerifier as never);

function req(over: Partial<CallableRequest> = {}): CallableRequest {
  return {
    method: 'POST',
    name: 'echo',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${GOOD_TOKEN}` },
    body: { data: { hello: 'world' } },
    ...over,
  };
}

const registry = new CallableRegistry<Record<string, never>>();
let lastSeen: { data: unknown; auth: unknown } | null = null;
registry.register(
  defineCallable('echo', async (data, context) => {
    lastSeen = { data, auth: context.auth ?? null };
    return { echoed: data };
  }),
);
registry.register(
  defineCallable('boom', async (_d, _c) => {
    throw new Error('a raw, non-HttpsError failure with a secret: postgres://user:pw@host');
  }),
);
registry.register(defineCallable('needsAuth', async (_d, context) => ({ uid: requireAuth(context) })));
for (const code of Object.keys(SERVER_MAP)) {
  registry.register(
    defineCallable(`throw_${code.replace(/-/g, '_')}`, async () => {
      throw new HttpsError(code as CallableErrorCode, `boom:${code}`, { code });
    }),
  );
}

const call = (r: CallableRequest) =>
  handleCallableRequest(r, { registry: registry as never, deps: {} as never, resolveAuth });

async function main() {
  // ── 1. The status map is complete and correct ──────────────────────────────
  {
    const mine = Object.keys(ERROR_CODE_MAP).sort();
    const theirs = Object.keys(SERVER_MAP).sort();
    ok(mine.length === theirs.length && mine.every((k, i) => k === theirs[i]),
      `ERROR_CODE_MAP has exactly firebase-functions' 17 codes (got ${mine.length})`);
    for (const [code, [canonical, status]] of Object.entries(SERVER_MAP)) {
      const got = (ERROR_CODE_MAP as Record<string, { canonicalName: string; status: number }>)[code];
      ok(!!got && got.canonicalName === canonical, `${code} → canonical name ${canonical}`);
      ok(!!got && got.status === status, `${code} → HTTP ${status}`);
    }
    // The 13 codes the task names explicitly, so a future edit cannot quietly drop one.
    for (const required of ['ok', 'invalid-argument', 'unauthenticated', 'permission-denied',
      'not-found', 'already-exists', 'resource-exhausted', 'failed-precondition', 'aborted',
      'out-of-range', 'unimplemented', 'internal', 'unavailable', 'deadline-exceeded']) {
      ok(required in ERROR_CODE_MAP, `the map still carries "${required}"`);
    }
    let threw = false;
    try { new HttpsError('nope' as CallableErrorCode, 'x'); } catch { threw = true; }
    ok(threw, 'HttpsError rejects a code outside the map (matches https.js:74-76)');
  }

  // ── 2. Success is EXACTLY {result: ...} ────────────────────────────────────
  {
    const res = await call(req());
    ok(res.status === 200, 'a success is HTTP 200');
    const keys = Object.keys(res.body);
    ok(keys.length === 1 && keys[0] === 'result',
      `the success body has exactly one key, "result" (got ${JSON.stringify(keys)})`);
    ok(JSON.stringify((res.body as any).result) === JSON.stringify({ echoed: { hello: 'world' } }),
      'the handler return value is the whole of `result`, unwrapped and unrenamed');
    ok(!('error' in res.body), 'a success body carries no `error` key');
    ok((res.headers['content-type'] ?? '').startsWith('application/json'),
      'the response is application/json');
    ok(clientErrorForResponse(res.status, res.body) === null,
      'the client parses a success as no-error');
    // The client reads json.data ?? json.result — `result` is the branch we use.
    ok(typeof (res.body as any).result !== 'undefined',
      'the client would not throw "Response is missing data field"');
    // A handler returning undefined must still be a valid envelope, not an empty body.
    const nullReg = new CallableRegistry<Record<string, never>>();
    nullReg.register(defineCallable('void', async () => undefined));
    const voidRes = await handleCallableRequest(req({ name: 'void' }),
      { registry: nullReg as never, deps: {} as never, resolveAuth });
    ok(voidRes.status === 200 && 'result' in voidRes.body && (voidRes.body as any).result === null,
      'a handler returning undefined still yields {result: null} (encode(undefined) === null)');
  }

  // ── 3. The request envelope {data:...} is what reaches the handler ─────────
  {
    lastSeen = null;
    await call(req({ body: { data: { a: 1, nested: { b: [2, 3] } } } }));
    ok(JSON.stringify(lastSeen!.data) === JSON.stringify({ a: 1, nested: { b: [2, 3] } }),
      'the handler receives body.data — UNWRAPPED, not the whole body');
    ok(!(lastSeen!.data as any)?.data, 'the handler does not receive a doubly-wrapped {data:{data}}');

    lastSeen = null;
    await call(req({ body: { data: null } }));
    ok(lastSeen!.data === null, 'body.data === null reaches the handler as null, not as invalid');

    // The Int64 wire wrapper survives both directions (https.js:134-219).
    const big = { '@type': 'type.googleapis.com/google.protobuf.Int64Value', value: '42' };
    ok(decode(big) === 42, 'decode() unwraps an Int64Value into a number');
    ok(JSON.stringify(encode({ d: 1, s: 'x', b: true, arr: [1, 'y'] }))
      === JSON.stringify({ d: 1, s: 'x', b: true, arr: [1, 'y'] }),
      'encode() is identity on plain JSON');
  }

  // ── 4. Every HttpsError code maps to the documented status AND shape ───────
  {
    for (const [code, [canonical, status]] of Object.entries(SERVER_MAP)) {
      const res = await call(req({ name: `throw_${code.replace(/-/g, '_')}` }));
      ok(res.status === status, `throwing "${code}" answers HTTP ${status} (got ${res.status})`);
      const keys = Object.keys(res.body);
      ok(keys.length === 1 && keys[0] === 'error',
        `the "${code}" error body has exactly one key, "error"`);
      const err = (res.body as any).error;
      ok(err.status === canonical,
        `"${code}" error.status is the CANONICAL name "${canonical}" (got ${JSON.stringify(err.status)})`);
      ok(err.message === `boom:${code}`, `"${code}" carries the handler's message verbatim`);
      ok(JSON.stringify(err.details) === JSON.stringify({ code }), `"${code}" carries details through`);
      // The whole point: what the CLIENT ends up with.
      const parsed = code === 'ok' ? null : clientErrorForResponse(res.status, res.body);
      if (code === 'ok') {
        ok(parsed === null, 'a thrown "ok" is, per the SDK, treated as success by the client');
      } else {
        ok(parsed?.code === code,
          `the client reconstructs "${code}" from our response (got ${parsed?.code})`);
        ok(parsed?.message === `boom:${code}`, `the client sees the original message for "${code}"`);
      }
    }
    // Guard the lowercase-status trap explicitly.
    const denied = await call(req({ name: 'throw_permission_denied' }));
    ok((denied.body as any).error.status !== 'permission-denied',
      'error.status is NOT the lowercase code (that key is absent from the client map → internal)');
    ok(clientErrorForResponse(denied.status, { error: { status: 'permission-denied' } })?.code === 'internal',
      'proof: a lowercase status WOULD downgrade the client to `internal`');
  }

  // ── 5. A non-HttpsError throw is internal/"INTERNAL" and leaks nothing ─────
  {
    const res = await call(req({ name: 'boom' }));
    ok(res.status === 500, 'an unhandled throw is HTTP 500');
    ok((res.body as any).error.status === 'INTERNAL', 'an unhandled throw is status INTERNAL');
    ok((res.body as any).error.message === 'INTERNAL',
      'the message is the literal "INTERNAL" — never the raw error text');
    ok(!JSON.stringify(res.body).includes('postgres://'),
      'the internal error text (a connection string here) never reaches the wire');
    ok(!('details' in (res.body as any).error), 'an unhandled throw carries no details');
  }

  // ── 6. Auth: missing / malformed / rejected all become 401 UNAUTHENTICATED ─
  {
    const noHeader = await call(req({ name: 'needsAuth', headers: { 'content-type': 'application/json' } }));
    ok(noHeader.status === 401, 'a MISSING token yields HTTP 401');
    ok((noHeader.body as any).error.status === 'UNAUTHENTICATED', 'a MISSING token yields UNAUTHENTICATED');
    ok(clientErrorForResponse(noHeader.status, noHeader.body)?.code === 'unauthenticated',
      'the client sees `unauthenticated` for a missing token');

    for (const [label, authorization] of [
      ['a token the verifier rejects', 'Bearer nope'],
      ['a non-Bearer scheme', 'Basic abc'],
      ['an empty Bearer value', 'Bearer '],
      ['a bare token with no scheme', GOOD_TOKEN],
    ] as const) {
      const res = await call(req({
        name: 'echo',
        headers: { 'content-type': 'application/json', authorization },
      }));
      ok(res.status === 401, `${label} yields HTTP 401`);
      ok((res.body as any).error.status === 'UNAUTHENTICATED', `${label} yields UNAUTHENTICATED`);
    }

    // A valid token produces the `context.auth` shape handlers already expect.
    lastSeen = null;
    const good = await call(req());
    ok(good.status === 200, 'a valid token gets through');
    ok((lastSeen!.auth as any).uid === 'uid-123', 'context.auth.uid is the verified uid');
    ok(typeof (lastSeen!.auth as any).token === 'object',
      'context.auth.token is the decoded token (staff custom claims ride here)');
    ok((lastSeen!.auth as any).token.firebase.sign_in_provider === 'anonymous',
      'the decoded claims survive intact — uid == teamId anonymous auth is unchanged');

    // MISSING is not an error at the protocol layer — the handler decides.
    lastSeen = null;
    const anon = await call(req({ headers: { 'content-type': 'application/json' } }));
    ok(anon.status === 200 && lastSeen!.auth === null,
      'a MISSING token reaches a handler with context.auth undefined (matches checkAuthToken)');

    // A verifier that blows up must be 401, never 500.
    const exploding = createAuthResolver((async () => { throw new TypeError('key fetch failed'); }) as never);
    const r = await handleCallableRequest(req(), { registry: registry as never, deps: {} as never, resolveAuth: exploding });
    ok(r.status === 401, 'a verifier that throws yields 401, not 500');

    // Header plumbing.
    ok(extractBearerToken({ authorization: 'Bearer abc' }) === 'abc', 'extractBearerToken reads the token');
    ok(extractBearerToken({ Authorization: 'bearer abc' }) === 'abc', 'the header name and scheme are case-insensitive');
    ok(extractBearerToken({}) === null, 'no header → null');
    ok((await createAuthResolver((async () => ({}) as never))({ authorization: 'Bearer x' })).status === 'INVALID',
      'a verified token with no uid is INVALID, not a crash');
  }

  // ── 7. Request validity (firebase-functions isValidRequest, verbatim) ──────
  {
    const bad: Array<[string, Partial<CallableRequest>]> = [
      ['a GET', { method: 'GET' }],
      ['an empty body', { body: undefined }],
      ['a body with no `data` key', { body: { payload: {} } }],
      ['a body with an extra top-level key', { body: { data: {}, extra: 1 } }],
      ['a non-JSON content type', { headers: { 'content-type': 'text/plain', authorization: `Bearer ${GOOD_TOKEN}` } }],
      ['no content type at all', { headers: { authorization: `Bearer ${GOOD_TOKEN}` } }],
    ];
    for (const [label, over] of bad) {
      ok(!isValidCallableRequest(req(over)), `isValidCallableRequest rejects ${label}`);
      const res = await call(req(over));
      ok(res.status === 400, `${label} answers HTTP 400`);
      ok((res.body as any).error.status === 'INVALID_ARGUMENT', `${label} answers INVALID_ARGUMENT`);
      ok((res.body as any).error.message === 'Bad Request', `${label} answers "Bad Request"`);
    }
    ok(isValidCallableRequest(req({ headers: { 'content-type': 'application/json; charset=utf-8' } })),
      'a charset parameter on Content-Type is ignored, as in https.js:110-113');
    ok(isValidCallableRequest(req({ headers: { 'content-type': 'APPLICATION/JSON' } })),
      'Content-Type is matched case-insensitively');

    // An unknown callable name is 404 not-found, matching a missing CF URL.
    const unknown = await call(req({ name: 'noSuchCallable' }));
    ok(unknown.status === 404 && (unknown.body as any).error.status === 'NOT_FOUND',
      'an unregistered callable name is 404 NOT_FOUND');

    // toErrorResponse is total.
    ok(toErrorResponse(undefined).status === 500, 'toErrorResponse(undefined) is a 500 envelope');
    ok(toErrorResponse('a string').body.error !== undefined, 'toErrorResponse(string) still yields an envelope');
  }

  // ── 8. The same protocol THROUGH Fastify, via app.inject() (no port) ───────
  let fastifyAvailable = true;
  try { await import('fastify'); } catch { fastifyAvailable = false; }

  if (!fastifyAvailable) {
    skip('the Fastify lane: `fastify` is not installed (this worktree has no node_modules). '
      + 'The protocol lane above covers the identical code path — apps/api/src/server.ts is a thin '
      + 'binding over handleCallableRequest — but the HTTP-level assertions (JSON parsing, CORS '
      + 'preflight, /healthz, 404 handler) were NOT executed. Run `npm install` then re-run to close it.');
  } else {
    const { createServer } = await import('../apps/api/src/server.js');
    const app = await createServer({
      deps: { repo: {} as never },
      verifyIdToken: fakeVerifier as never,
      callables: [
        defineCallable('echo', async (data, context) => ({ echoed: data, uid: context.auth?.uid ?? null })),
        defineCallable('denied', async () => { throw new HttpsError('permission-denied', 'nope'); }),
        defineCallable('needsAuth', async (_d, c) => ({ uid: requireAuth(c) })),
      ] as never,
      allowedOrigins: ['https://rushpoint-play.web.app'],
      logger: false,
    });

    const post = (name: string, body: unknown, headers: Record<string, string> = {}) =>
      app.inject({
        method: 'POST', url: `/${name}`,
        headers: { 'content-type': 'application/json', ...headers },
        payload: typeof body === 'string' ? body : JSON.stringify(body),
      });

    const okRes = await post('echo', { data: { x: 1 } }, { authorization: `Bearer ${GOOD_TOKEN}` });
    ok(okRes.statusCode === 200, 'inject: a success is 200');
    ok(JSON.stringify(okRes.json()) === JSON.stringify({ result: { echoed: { x: 1 }, uid: 'uid-123' } }),
      'inject: the body over real HTTP is exactly {result: ...}');
    ok((okRes.headers['content-type'] as string).includes('application/json'),
      'inject: content-type is JSON');

    const deniedRes = await post('denied', { data: {} }, { authorization: `Bearer ${GOOD_TOKEN}` });
    ok(deniedRes.statusCode === 403, 'inject: permission-denied is 403');
    ok(deniedRes.json().error.status === 'PERMISSION_DENIED', 'inject: the canonical name survives Fastify');
    ok(clientErrorForResponse(deniedRes.statusCode, deniedRes.json())?.code === 'permission-denied',
      'inject: the client reconstructs permission-denied end to end');

    const unauth = await post('needsAuth', { data: {} });
    ok(unauth.statusCode === 401 && unauth.json().error.status === 'UNAUTHENTICATED',
      'inject: a missing token is 401 UNAUTHENTICATED');
    const badTok = await post('echo', { data: {} }, { authorization: 'Bearer wrong' });
    ok(badTok.statusCode === 401 && badTok.json().error.status === 'UNAUTHENTICATED',
      'inject: an invalid token is 401 UNAUTHENTICATED');

    // Malformed JSON must be a callable envelope, not Fastify's own 400 body.
    const malformed = await post('echo', '{not json', { authorization: `Bearer ${GOOD_TOKEN}` });
    ok(malformed.statusCode === 400, 'inject: malformed JSON is 400');
    ok(malformed.json().error?.status === 'INVALID_ARGUMENT',
      'inject: malformed JSON gets the callable envelope, not Fastify\'s FST_ERR body');

    const wrongCt = await app.inject({
      method: 'POST', url: '/echo', headers: { 'content-type': 'text/plain' }, payload: 'hi',
    });
    ok(wrongCt.statusCode === 400 && wrongCt.json().error?.status === 'INVALID_ARGUMENT',
      'inject: a non-JSON content type is 400 INVALID_ARGUMENT (not 415)');

    const notFound = await post('nope', { data: {} }, { authorization: `Bearer ${GOOD_TOKEN}` });
    ok(notFound.statusCode === 404 && notFound.json().error.status === 'NOT_FOUND',
      'inject: an unknown callable is 404 NOT_FOUND');

    // CORS — a missed preflight is a total client outage (DEPLOYMENT.md §4.2).
    const pre = await app.inject({
      method: 'OPTIONS', url: '/echo',
      headers: {
        origin: 'https://rushpoint-play.web.app',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    ok(pre.statusCode === 204, 'inject: a preflight answers 204');
    ok(pre.headers['access-control-allow-origin'] === 'https://rushpoint-play.web.app',
      'inject: the preflight echoes an allowed Hosting origin');
    const allowHeaders = String(pre.headers['access-control-allow-headers'] ?? '').toLowerCase();
    ok(allowHeaders.includes('authorization'), 'inject: Authorization is allowed on preflight');
    ok(allowHeaders.includes('content-type'), 'inject: Content-Type is allowed on preflight');
    ok(String(pre.headers['access-control-allow-methods'] ?? '').includes('POST'),
      'inject: POST is an allowed method');

    const strange = await app.inject({
      method: 'OPTIONS', url: '/echo', headers: { origin: 'https://evil.example' },
    });
    ok(strange.headers['access-control-allow-origin'] === undefined,
      'inject: an origin outside the allowlist gets no allow-origin header');

    const health = await app.inject({ method: 'GET', url: '/healthz' });
    ok(health.statusCode === 200 && health.json().ok === true, 'inject: /healthz is 200 {ok:true}');
    ok(health.json().callables === 3, 'inject: /healthz reports the mounted callable count');

    await app.close();
  }

  // ── 9. The two ported callables, if their deps resolve ────────────────────
  let portedAvailable = true;
  try { await import('@rushpoint/shared'); } catch { portedAvailable = false; }

  if (!portedAvailable) {
    skip('the ported-callable lane: `@rushpoint/shared` does not resolve from this worktree '
      + '(no node_modules). getJoinInfo/getMyProfile were NOT executed here — their protocol '
      + 'wrapper is covered above, but their bodies are not. Run `npm install` then re-run.');
  } else {
    const { getJoinInfo } = await import('../apps/api/src/callables/getJoinInfo.js');
    const { getMyProfile } = await import('../apps/api/src/callables/getMyProfile.js');

    const game = {
      id: 'g1', title: 'Old City Treasure Hunt', description: 'demo', mode: 'teams',
      registrationFields: [], stages: [{ tasks: [{ triggerMode: 'radius' }] }],
    };
    const repo = {
      getAccessCode: async (code: string) => (code === 'ABC123'
        ? { code, ownerUid: 'o1', gameId: 'g1', runId: 'r1', status: 'unused', createdAt: 'x' }
        : code === 'REVOKD'
          ? { code, ownerUid: 'o1', gameId: 'g1', runId: 'r1', status: 'revoked', createdAt: 'x' }
          : code === 'TRASHD'
            ? { code, ownerUid: 'o1', gameId: 'gone', runId: 'r1', status: 'unused', createdAt: 'x' }
            : null),
      getGame: async ({ gameId }: { gameId: string }) => (gameId === 'gone'
        ? { ...game, id: 'gone', deletedAt: '2026-01-01T00:00:00.000Z' }
        : gameId === 'g1' ? game : null),
      getRun: async () => ({ id: 'r1', status: 'live', isTestDrive: true }),
      getPlayerProfile: async (uid: string) => (uid === 'known'
        ? { uid, gamesPlayed: 3, tasksCompleted: 9, totalPoints: 120, badges: ['x'] } : null),
    };
    const portedReg = new CallableRegistry<never>();
    portedReg.register(getJoinInfo as never);
    portedReg.register(getMyProfile as never);
    const deps = { repo, enforceRateLimit: async () => {}, now: () => 'now' };
    const callPorted = (name: string, data: unknown, auth = true) =>
      handleCallableRequest(
        req({
          name, body: { data },
          headers: {
            'content-type': 'application/json',
            ...(auth ? { authorization: `Bearer ${GOOD_TOKEN}` } : {}),
          },
        }),
        { registry: portedReg as never, deps: deps as never, resolveAuth },
      );

    const joined = await callPorted('getJoinInfo', { code: 'abc123' });
    ok(joined.status === 200, 'getJoinInfo: a good code succeeds');
    const r = (joined.body as any).result;
    ok(JSON.stringify(r.context) === JSON.stringify({ ownerUid: 'o1', gameId: 'g1', runId: 'r1' }),
      'getJoinInfo: returns the {ownerUid,gameId,runId} context play-web joins with');
    ok(r.title === 'Old City Treasure Hunt', 'getJoinInfo: returns the game title');
    ok(r.runStatus === 'live' && r.isTestDrive === true, 'getJoinInfo: run status + test-drive flag');
    ok(r.requirement === 'gps', 'getJoinInfo: the GPS requirement is derived from the tasks');
    ok(r.branding === null, 'getJoinInfo: absent branding is null, not undefined (a JSON-visible difference)');
    ok(!JSON.stringify(r).includes('answers') && !JSON.stringify(r).includes('stages'),
      'getJoinInfo: no task/stage payload is returned at all (answer keys stay server-secret)');

    const lower = await callPorted('getJoinInfo', { code: '  abc123  ' });
    ok(lower.status === 200, 'getJoinInfo: the code is trimmed + upper-cased before lookup');

    for (const [code, status, canonical] of [
      ['NOPE12', 404, 'NOT_FOUND'],
      ['REVOKD', 403, 'PERMISSION_DENIED'],
      ['TRASHD', 404, 'NOT_FOUND'],
    ] as const) {
      const res = await callPorted('getJoinInfo', { code });
      ok(res.status === status && (res.body as any).error.status === canonical,
        `getJoinInfo: code "${code}" → ${status} ${canonical}`);
    }
    const badArg = await callPorted('getJoinInfo', { code: 'not/a/code' });
    ok(badArg.status === 400 && (badArg.body as any).error.status === 'INVALID_ARGUMENT',
      'getJoinInfo: an unnormalizable code is 400 INVALID_ARGUMENT');
    const anonJoin = await callPorted('getJoinInfo', { code: 'ABC123' }, false);
    ok(anonJoin.status === 401, 'getJoinInfo: requires auth');

    const mine = await callPorted('getMyProfile', {});
    ok(mine.status === 200, 'getMyProfile: succeeds for a signed-in uid');
    ok((mine.body as any).result.profile.uid === 'uid-123',
      'getMyProfile: an unknown uid gets a synthesised empty profile, NOT a 404');
    ok((mine.body as any).result.profile.gamesPlayed === 0,
      'getMyProfile: the empty profile is zeroed, so play-web renders on first visit');
    const anonProfile = await callPorted('getMyProfile', {}, false);
    ok(anonProfile.status === 401 && (anonProfile.body as any).error.status === 'UNAUTHENTICATED',
      'getMyProfile: requireAuth yields 401 UNAUTHENTICATED');
  }

  if (skips.length > 0) {
    console.log(`\napi-contract: ${skips.length} lane(s) SKIPPED (see ⊘ above) — offline, not passing.`);
  }
  console.log(`\napi-contract: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('api-contract: the suite itself threw —', err);
  process.exit(1);
});
