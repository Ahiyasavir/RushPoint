// ─── The Firebase callable HTTP protocol, re-implemented verbatim ────────────
//
// WHY THIS FILE EXISTS
//   MIGRATION_PLAN §1 non-goal 2 (restated in docs/migration/DEPLOYMENT.md §4.2):
//   "the callable API contract does not change". The client change is ONE line —
//   `getFunctions(app, VITE_API_ORIGIN)` — and `apps/*/src/services/calls.ts`
//   changes ZERO characters. That is only true if this server speaks the exact
//   wire format the @firebase/functions client already speaks.
//
// WHERE THE FORMAT WAS VERIFIED (read, not guessed)
//   SERVER side — node_modules/firebase-functions/lib/common/providers/https.js
//     * `errorCodeMap` (lines 47-65)     → code → {canonicalName, HTTP status}
//     * `HttpsError.toJSON()` (84-91)    → `{ ...details?, message, status }`
//                                          where `status` is the CANONICAL NAME
//     * `isValidRequest` (96-131)        → POST + Content-Type: application/json
//                                          + a `data` key + NO other top-level key
//     * `wrapOnCallHandler` (401-487)    → success is `res.status(200).send({result})`;
//                                          a non-HttpsError throw becomes
//                                          `internal` / "INTERNAL"; the error body is
//                                          `{ error: httpErr.toJSON() }` at the mapped
//                                          HTTP status.
//   CLIENT side — node_modules/@firebase/functions/dist/index.node.cjs.js
//     * `errorCodeMap` (160-178)         → the client maps UPPER_SNAKE → code.
//     * `_errorForResponse` (246-280)    → 🔴 if `error.status` is a string that is
//                                          NOT in that UPPER_SNAKE map, the client
//                                          returns `internal` and DISCARDS the real
//                                          code. So the body MUST carry
//                                          "PERMISSION_DENIED", not "permission-denied".
//                                          (docs/migration/DEPLOYMENT.md §4.2's example
//                                          shows the lowercase form — the doc example is
//                                          wrong; the SDK is the contract.)
//     * `callAtURL` (633-690)            → posts `{data}` with
//                                          `Authorization: Bearer <ID token>`, then
//                                          reads `json.data ?? json.result`.
//
// THIS FILE IS FRAMEWORK-FREE ON PURPOSE. `server.ts` is a thin Fastify binding
// over `handleCallableRequest`, so the protocol can be gated
// (scripts/test-api-contract.ts) with no HTTP server, no port and no node_modules.

// ─── Status map ──────────────────────────────────────────────────────────────

export type CallableErrorCode =
  | 'ok'
  | 'cancelled'
  | 'unknown'
  | 'invalid-argument'
  | 'deadline-exceeded'
  | 'not-found'
  | 'already-exists'
  | 'permission-denied'
  | 'unauthenticated'
  | 'resource-exhausted'
  | 'failed-precondition'
  | 'aborted'
  | 'out-of-range'
  | 'unimplemented'
  | 'internal'
  | 'unavailable'
  | 'data-loss';

export interface CanonicalError {
  /** The UPPER_SNAKE name the client's `errorCodeMap` keys on. */
  canonicalName: string;
  /** The HTTP status the client's `codeForHTTPStatus` fallback keys on. */
  status: number;
}

/**
 * Copied verbatim from firebase-functions `common/providers/https.js:47-65`.
 * Do not "tidy" a row: each pair is simultaneously a client-visible code and an
 * HTTP status, and the client uses BOTH (the status is the fallback when the
 * body is unparseable).
 */
export const ERROR_CODE_MAP: Readonly<Record<CallableErrorCode, CanonicalError>> = Object.freeze({
  ok: { canonicalName: 'OK', status: 200 },
  cancelled: { canonicalName: 'CANCELLED', status: 499 },
  unknown: { canonicalName: 'UNKNOWN', status: 500 },
  'invalid-argument': { canonicalName: 'INVALID_ARGUMENT', status: 400 },
  'deadline-exceeded': { canonicalName: 'DEADLINE_EXCEEDED', status: 504 },
  'not-found': { canonicalName: 'NOT_FOUND', status: 404 },
  'already-exists': { canonicalName: 'ALREADY_EXISTS', status: 409 },
  'permission-denied': { canonicalName: 'PERMISSION_DENIED', status: 403 },
  unauthenticated: { canonicalName: 'UNAUTHENTICATED', status: 401 },
  'resource-exhausted': { canonicalName: 'RESOURCE_EXHAUSTED', status: 429 },
  'failed-precondition': { canonicalName: 'FAILED_PRECONDITION', status: 400 },
  aborted: { canonicalName: 'ABORTED', status: 409 },
  'out-of-range': { canonicalName: 'OUT_OF_RANGE', status: 400 },
  unimplemented: { canonicalName: 'UNIMPLEMENTED', status: 501 },
  internal: { canonicalName: 'INTERNAL', status: 500 },
  unavailable: { canonicalName: 'UNAVAILABLE', status: 503 },
  'data-loss': { canonicalName: 'DATA_LOSS', status: 500 },
});

/**
 * The handler-throwable error. Deliberately API-compatible with
 * `functions.https.HttpsError` so a ported callable body keeps its throw sites
 * unchanged (`throw new HttpsError('not-found', 'Invalid access code')`).
 */
export class HttpsError extends Error {
  readonly code: CallableErrorCode;
  readonly details: unknown;
  readonly httpErrorCode: CanonicalError;

  constructor(code: CallableErrorCode, message: string, details?: unknown) {
    super(message);
    if (!(code in ERROR_CODE_MAP)) {
      throw new Error(`Unknown error code: ${code}.`);
    }
    this.name = 'HttpsError';
    this.code = code;
    this.details = details;
    this.httpErrorCode = ERROR_CODE_MAP[code];
  }

  /** Matches `HttpsError.toJSON()` — note `status` is the CANONICAL name. */
  toJSON(): { message: string; status: string; details?: unknown } {
    return {
      ...(this.details === undefined ? {} : { details: this.details }),
      message: this.message,
      status: this.httpErrorCode.canonicalName,
    };
  }
}

/** Structural check — an error thrown by a *different* copy of this class still maps. */
export function isHttpsError(err: unknown): err is HttpsError {
  if (err instanceof HttpsError) return true;
  const e = err as { code?: unknown; httpErrorCode?: { status?: unknown } } | null;
  return !!e && typeof e.code === 'string' && (e.code as string) in ERROR_CODE_MAP
    && typeof e.httpErrorCode === 'object' && e.httpErrorCode !== null;
}


// ─── Payload encoding ────────────────────────────────────────────────────────
//
// firebase-functions encodes the result before sending and decodes `body.data`
// before handing it to the handler, so Int64 wrappers survive. We keep both
// halves; they are cheap and dropping them would be a silent contract change.

const LONG_TYPE = 'type.googleapis.com/google.protobuf.Int64Value';
const UNSIGNED_LONG_TYPE = 'type.googleapis.com/google.protobuf.UInt64Value';

export function encode(data: unknown): unknown {
  if (data === null || typeof data === 'undefined') return null;
  if (data instanceof Number) data = data.valueOf();
  if (typeof data === 'number' && Number.isFinite(data)) return data;
  if (typeof data === 'boolean') return data;
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return data.map(encode);
  if (typeof data === 'object' || typeof data === 'function') {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as object)) obj[k] = encode(v);
    return obj;
  }
  throw new Error(`Data cannot be encoded in JSON: ${String(data)}`);
}

export function decode(data: unknown): unknown {
  if (data === null || typeof data === 'undefined') return data ?? null;
  if (typeof data === 'object' && !Array.isArray(data)) {
    const tagged = data as Record<string, unknown>;
    if (tagged['@type']) {
      const t = tagged['@type'];
      if (t === LONG_TYPE || t === UNSIGNED_LONG_TYPE) {
        const value = parseFloat(String(tagged.value));
        if (Number.isNaN(value)) throw new Error('Data cannot be decoded from JSON');
        return value;
      }
      throw new Error('Data cannot be decoded from JSON');
    }
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(tagged)) obj[k] = decode(v);
    return obj;
  }
  if (Array.isArray(data)) return data.map(decode);
  return data;
}


// ─── The registrar ───────────────────────────────────────────────────────────

/**
 * The context a handler receives. Shaped exactly like a v1
 * `functions.https.CallableContext` so a body ported out of `functions/src`
 * keeps `context.auth.uid` / `context.auth.token` working unchanged.
 */
export interface CallableContext {
  auth?: { uid: string; token: Record<string, unknown> };
  rawRequest: CallableRequest;
}

export type CallableHandler<Deps = unknown> = (
  data: any,
  context: CallableContext,
  deps: Deps,
) => unknown | Promise<unknown>;

export interface CallableDefinition<Deps = unknown> {
  name: string;
  handler: CallableHandler<Deps>;
}

/**
 * `defineCallable('getJoinInfo', handler)` — the analogue of
 * `export const getJoinInfo = loggedCallable('getJoinInfo', ...)`.
 * It only DESCRIBES the callable; mounting is `server.ts`'s job, which keeps
 * this module importable with no framework present.
 */
export function defineCallable<Deps = unknown>(
  name: string,
  handler: CallableHandler<Deps>,
): CallableDefinition<Deps> {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid callable name: ${name}`);
  }
  return { name, handler };
}

export class CallableRegistry<Deps = unknown> {
  private readonly map = new Map<string, CallableDefinition<Deps>>();

  register(def: CallableDefinition<Deps>): this {
    if (this.map.has(def.name)) throw new Error(`Callable already registered: ${def.name}`);
    this.map.set(def.name, def);
    return this;
  }

  registerAll(defs: Iterable<CallableDefinition<Deps>>): this {
    for (const d of defs) this.register(d);
    return this;
  }

  get(name: string): CallableDefinition<Deps> | undefined {
    return this.map.get(name);
  }

  names(): string[] {
    return [...this.map.keys()].sort();
  }
}


// ─── The adapter ─────────────────────────────────────────────────────────────

export interface CallableRequest {
  method: string;
  /** The callable name, i.e. the single path segment. */
  name: string;
  /** Lower-cased header names → value. */
  headers: Record<string, string | string[] | undefined>;
  /** The already-JSON-parsed body, or `undefined` when it was unparseable. */
  body: unknown;
}

export interface CallableResponse {
  status: number;
  headers: Record<string, string>;
  /** The object to serialise — either `{result}` or `{error}`. */
  body: Record<string, unknown>;
}

export interface CallableLogger {
  info?(obj: Record<string, unknown>, msg?: string): void;
  warn?(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

export interface HandleOptions<Deps> {
  registry: CallableRegistry<Deps>;
  deps: Deps;
  /**
   * Resolves the caller. INJECTED so the protocol is testable offline — see
   * auth.ts. Returning `'MISSING'` is NOT an error (firebase-functions lets an
   * anonymous request through and lets the handler decide); `'INVALID'` is.
   */
  resolveAuth: (
    headers: Record<string, string | string[] | undefined>,
  ) => Promise<import('./auth.js').AuthResolution>;
  logger?: CallableLogger;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/** Mirrors firebase-functions `isValidRequest` (https.js:96-131). */
export function isValidCallableRequest(req: CallableRequest): boolean {
  if (!req.body || typeof req.body !== 'object') return false;
  if (req.method !== 'POST') return false;
  const raw = req.headers['content-type'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  let contentType = (header ?? '').toLowerCase();
  const semi = contentType.indexOf(';');
  if (semi >= 0) contentType = contentType.slice(0, semi).trim();
  if (contentType !== 'application/json') return false;
  const body = req.body as Record<string, unknown>;
  if (typeof body.data === 'undefined') return false;
  if (Object.keys(body).some((k) => k !== 'data')) return false;
  return true;
}

/** The `{error: ...}` envelope + its HTTP status, for any thrown value. */
export function toErrorResponse(err: unknown, logger?: CallableLogger): CallableResponse {
  let httpErr: HttpsError;
  if (isHttpsError(err)) {
    httpErr = err as HttpsError;
  } else {
    // Exactly as firebase-functions does: an unhandled throw is `internal` and
    // its message is the literal "INTERNAL" — never the internal error text,
    // which would leak stack/SQL detail to a participant's phone.
    logger?.error?.({ err: String(err) }, 'Unhandled error');
    httpErr = new HttpsError('internal', 'INTERNAL');
  }
  return {
    status: httpErr.httpErrorCode.status,
    headers: { ...JSON_HEADERS },
    body: { error: httpErr.toJSON() },
  };
}

/**
 * The whole protocol, as one pure-ish function: request in, response out.
 * `server.ts` does nothing but adapt Fastify's req/reply to these two shapes.
 */
export async function handleCallableRequest<Deps>(
  req: CallableRequest,
  opts: HandleOptions<Deps>,
): Promise<CallableResponse> {
  const def = opts.registry.get(req.name);
  if (!def) {
    // A name the server does not serve. `not-found` (404) is what a missing
    // Cloud Function URL produces, so the client's mapping is unchanged.
    return toErrorResponse(new HttpsError('not-found', `Unknown callable: ${req.name}`));
  }

  try {
    if (!isValidCallableRequest(req)) {
      opts.logger?.warn?.({ callable: req.name }, 'Invalid callable request');
      throw new HttpsError('invalid-argument', 'Bad Request');
    }

    const context: CallableContext = { rawRequest: req };
    const resolution = await opts.resolveAuth(req.headers);
    if (resolution.status === 'INVALID') {
      // Note: MISSING is NOT rejected here — it is rejected by the handler's own
      // `requireAuth`, exactly as today. Both paths end at 401/UNAUTHENTICATED.
      throw new HttpsError('unauthenticated', 'Unauthenticated');
    }
    if (resolution.status === 'VALID') context.auth = resolution.auth;

    const data = decode((req.body as { data: unknown }).data);
    const result = encode(await def.handler(data, context, opts.deps));
    return { status: 200, headers: { ...JSON_HEADERS }, body: { result } };
  } catch (err) {
    return toErrorResponse(err, opts.logger);
  }
}
