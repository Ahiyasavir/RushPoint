# `@rushpoint/api` — the Node API server that replaces Cloud Functions

> Target: one Node 20 process on `127.0.0.1:8080` behind Caddy on the IONOS box.
> Design: [`docs/migration/DEPLOYMENT.md`](../../docs/migration/DEPLOYMENT.md) §4.
> Gate: [`scripts/test-api-contract.ts`](../../scripts/test-api-contract.ts) (`npm test`).

---

## 1. The one thing this package exists to guarantee

The migration's stated **non-goal** is that *the callable API contract does not change*.
Concretely:

- `apps/*/src/services/firebase.ts` changes **one line**:
  `getFunctions(app)` → `getFunctions(app, import.meta.env.VITE_API_ORIGIN)`.
- `apps/*/src/services/calls.ts` changes **zero characters** — all ~96 typed wrappers,
  every `Req`/`Res` type and every call site are untouched.

That is only true while this server's **bytes on the wire** are indistinguishable from Cloud
Functions'. So the protocol is implemented verbatim, from the source, not from memory.

### The wire format (and where each rule was read from)

```
POST <VITE_API_ORIGIN>/<callableName>
Authorization: Bearer <Firebase ID token>          ← optional; the handler decides
Content-Type: application/json

  { "data": { ...args } }                          ← exactly one top-level key
→ 200 { "result": ... }
→ 4xx/5xx { "error": { "status": "NOT_FOUND", "message": "…", "details": … } }
```

| Rule | Source |
|---|---|
| code → `{canonicalName, HTTP status}` (17 rows) | `firebase-functions/lib/common/providers/https.js:47-65` |
| error body is `{...details?, message, status}` | same file, `HttpsError.toJSON()` `:84-91` |
| POST + `application/json` + a `data` key + **no other top-level key** | same file, `isValidRequest` `:96-131` |
| missing header ⇒ `MISSING` (not an error); non-Bearer or rejected ⇒ `INVALID` ⇒ 401 | same file, `checkAuthToken` `:314-343` |
| success is `200 {result}`; a non-`HttpsError` throw becomes `internal` / `"INTERNAL"` | same file, `wrapOnCallHandler` `:401-487` |
| client maps `UPPER_SNAKE` → code; **an unknown key silently becomes `internal`** | `@firebase/functions/dist/index.node.cjs.js:160-178, 246-280` |
| client posts `{data}` + `Authorization: Bearer`, then reads `json.data ?? json.result` | same file, `callAtURL:633-690` |

> 🔴 **`error.status` must be the UPPER_SNAKE canonical name** (`"PERMISSION_DENIED"`), not the
> lowercase code. `_errorForResponse` looks the string up in a map keyed by the canonical names;
> a lowercase `"permission-denied"` is an unknown key and the client **discards the real code and
> reports `internal`**. `DEPLOYMENT.md` §4.2's illustrative snippet shows the lowercase form — the
> SDK is the contract, and `test-api-contract.ts` pins it with an explicit counter-example.

Three client behaviours are now **server obligations** (DEPLOYMENT.md §4.2):

- **Retries.** The client retries up to 3× on `internal` / `unavailable` / `deadline-exceeded` /
  `aborted`. A *transient* Postgres failure (serialization failure, pool exhaustion, `57P01`) must
  map to **`unavailable`**; a permanent one must not, or the client burns three attempts.
  `DataError.retriable` (`@rushpoint/data`) is the input to that mapping — **not yet wired**, see §5.
- **20 s timeout is hard.** `CALLABLE_TIMEOUT_MS = 20_000`. Alert on p99 > 5 s.
- **Retry-safety is per-callable.** `opts.retry === false` exists because some callables are not
  idempotent (`triggerSOS`). Changing an endpoint's idempotency is a client change in disguise.

---

## 2. Layout

| File | Job |
|---|---|
| `src/callable.ts` | **The protocol.** `ERROR_CODE_MAP`, `HttpsError`, `encode`/`decode`, `defineCallable`, `CallableRegistry`, and `handleCallableRequest(req) → res`. **Framework-free** — no Fastify, no firebase-admin, no `@rushpoint/*`. |
| `src/auth.ts` | Bearer extraction + `createAuthResolver(verifyIdToken)` → `context.auth = {uid, token}`. The verifier is **injected**; `createFirebaseAdminVerifier` imports firebase-admin lazily. Also `requireAuth(context)`, unchanged from `functions/src`. |
| `src/deps.ts` | Everything a handler may reach for: `repo` (a `Pick<Repository, …>` from `@rushpoint/data`), `enforceRateLimit`, `now`. **No handler touches a database directly.** |
| `src/server.ts` | The Fastify factory. Routes, CORS, `/healthz`, structured logs. **Exports a factory; never listens on import.** |
| `src/index.ts` | Reads env, builds the repository + the real verifier, listens, handles SIGINT/SIGTERM. |
| `src/callables/` | The ported callables, one file each, plus `ALL_CALLABLES`. |

**`server.ts` is deliberately thin.** Every protocol decision lives in `callable.ts` so the contract
can be gated with no HTTP server, no port and no `node_modules`. If you catch yourself writing a
status code or an error shape in `server.ts`, it belongs in `callable.ts`.

---

## 3. How this maps to the old Cloud Functions

| Cloud Functions | Here |
|---|---|
| `export const x = loggedCallable('x', handler)` | `export const x = defineCallable('x', handler)` + an entry in `src/callables/index.ts` |
| `functions.https.HttpsError(code, msg, details)` | `HttpsError(code, msg, details)` — same signature, same codes |
| `context.auth.uid` / `context.auth.token` | identical (`src/auth.ts` builds the same object) |
| `requireAuth(context)` / `assertStaffOrOwner(...)` | port **unchanged** (DEPLOYMENT.md §4.3; RLS never replaces them) |
| `db.doc(...).get()` / `.set()` | a named method on the `@rushpoint/data` repository |
| `admin.firestore().runTransaction(...)` | `repo.runInTransaction(...)` — **read `packages/data/src/transaction.ts` first; the body may re-execute** |
| the Firestore-backed `enforceRateLimit` | `deps.enforceRateLimit`, injected (§4.1 puts it in an `onRequest` hook) |
| Functions' implicit same-project CORS | explicit `ALLOWED_ORIGINS` — this is a **cross-origin** deployment now |

### Ported so far (2 of ~96)

- **`getJoinInfo`** — from `functions/src/runs/index.ts:381-421`. Exercises validation
  (`normalizeAccessCode`), three repository reads (two in parallel, as the original does), and four
  distinct error codes (`invalid-argument` / `not-found` / `permission-denied`). The order of the
  checks is preserved deliberately: `revoked` is refused before the game is read, and the
  soft-delete tombstone is still checked afterwards ("belt and braces" in the original).
- **`getMyProfile`** — from `functions/src/runs/index.ts:2530-2536`. The smallest callable that
  still crosses every layer, and it pins the "never 404, synthesise an empty aggregate" contract
  that keeps a brand-new player's first screen from showing an error toast.

Both go through the repository interface. Neither touches Postgres.

---

## 4. Running it

```bash
npm --workspace apps/api run build        # tsc → dist/
node apps/api/dist/index.js               # or: npm --workspace apps/api start
```

Env:

| Var | Default | Notes |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `8080` | loopback on purpose — Caddy terminates TLS |
| `ALLOWED_ORIGINS` | *(empty ⇒ reflect any origin)* | **required when `NODE_ENV=production`; the process refuses to boot without it** |
| `FIREBASE_PROJECT_ID` | — | with `GOOGLE_APPLICATION_CREDENTIALS` → the read-only mounted service-account JSON (never in git, never in the image) |
| `RUSHPOINT_DATASTORE` | `postgres` | `firestore` is refused here — that implementation runs in Cloud Functions |
| `LOG_LEVEL` | `info` | structured JSON to journald; rotate it |

Per DEPLOYMENT.md §4.5: **one process, no `cluster`**, under systemd with `Restart=always`,
`pg` pool max 10, statement timeout 15 s (under the client's 20 s).

---

## 5. What is **NOT** ported yet

Everything here is a known gap, not an oversight.

1. **94 of ~96 callables.** Only `getJoinInfo` and `getMyProfile` exist. The rest are the bulk of
   the work and each needs its own e2e scenario — see (6).
2. **The repository is not wired.** `src/index.ts` `createRepository()` **throws by design**:
   `packages/data/src/postgres/` is another agent's deliverable and its factory export is not
   frozen. `createServer` takes the repository by injection, so this is one import when that lands.
   Nothing above it is blocked.
3. **Transient-error mapping.** `DataError('contended' | 'unavailable')` must become
   `HttpsError('unavailable')` so the client's existing 3× retry absorbs a container restart
   (§4.2). Today a `DataError` falls through to `internal`/500 — which the client also retries, so
   this is a *quality* gap, not a correctness one, but it must be closed before the soak.
4. **`stripeWebhook`.** Not present. It is `onRequest`, not a callable, and needs the **raw body**
   preserved for signature verification — the classic Fastify porting bug (§4.6). It is dormant
   (`PAYMENTS_ENABLED = false`), so it ships as a stub with a passing test, and switching payments
   on requires a **manual Stripe dashboard URL change** that no deploy performs.
5. **`/realtimeToken`.** Realtime/Storage verify **HS256 `JWT_SECRET`** tokens; a Firebase ID token
   is **RS256 signed by Google**, so those containers cannot verify it. Something must mint a
   short-lived Supabase-shaped token after verifying the Firebase one, and this server is the
   natural place — but **the design belongs to `docs/migration/AUTH.md`**, not here.
6. **The two guards must be re-pointed, not deleted** (§4.1): `scripts/lib/callableHardening.mjs`
   (every callable carries an auth marker; every privileged one writes an `auditLogs` record) and
   the e2e **callable-coverage guard** (a new callable ships RED until a test invokes it). Both
   still read `functions/src`. Until they are re-pointed, `src/callables/index.ts` is an
   **unguarded** list.
7. **Per-route JSON Schema validation.** §4.1's stated payoff for choosing Fastify — free argument
   validation and fast serialization from the `@rushpoint/shared` types. Not started; today each
   handler validates by hand exactly as the Cloud Function did.
8. **Rate limiting, audit writes, and the Sentry seam.** `deps.enforceRateLimit` defaults to a
   **no-op**. The observability seam from the production-hardening work should be re-pointed here,
   not dropped (§4.5).
9. **Scheduled work.** `pruneExpiredRunData` (pubsub) and the `onRunFinalized` Firestore trigger
   have no home in this process yet.

---

## 6. The gate

`scripts/test-api-contract.ts`, run by `scripts/run-unit-tests.mjs` (`npm test`). It binds **no
port** — the Fastify lane uses `app.inject()` — and touches no Firebase, Postgres or filesystem.

It asserts the wire format specifically, because that is what makes the client change one line:

- the full 17-row status map, written out as **literals** (importing the map and comparing it to
  itself would pass even if someone edited it);
- a success is **exactly** `{result: …}` — one key, unwrapped, no `error`;
- every code round-trips through a **transcription of the client's `_errorForResponse`**, so the
  assertion is "the client reconstructs `permission-denied`", not merely "we emitted a 403";
- the lowercase-`status` trap, pinned with a counter-example;
- an unhandled throw is `internal`/`"INTERNAL"` and **leaks no internal text** (the fixture throws a
  connection string and the test asserts it never reaches the wire);
- missing / malformed / rejected tokens all land on **401 `UNAUTHENTICATED`**, and a verifier that
  *throws* is 401 rather than 500;
- the request envelope `{data:…}` arrives at the handler **unwrapped**;
- and, through `app.inject()`: malformed JSON returns the callable envelope rather than Fastify's
  own `FST_ERR` body, a preflight allows `Authorization` + `Content-Type`, an origin outside the
  allowlist gets no `allow-origin` header, and `/healthz` answers.

Lanes needing a real dependency (`fastify`, `@rushpoint/shared`) are loaded with a dynamic import
and **skip with an explicit message**, so the file is still useful in a worktree with no
`node_modules` — the protocol lane has zero dependencies and always runs.
