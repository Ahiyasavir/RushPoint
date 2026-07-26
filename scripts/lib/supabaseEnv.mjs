// The single source of truth for WHICH ports the local Supabase stack binds, which URLs
// point at it, and whether the environment it needs is actually present
// (change: supabase-local-dev).
//
// Why this exists
// ---------------
// This machine already runs a long-lived Firebase Emulator Suite (`playtest:forever`)
// that owns UI 4000 · hub 4400 · logging 4500 · Functions 5001 · Hosting 5002 ·
// Firestore 8080 · Auth 9099 · Firestore-websocket 9150 · Storage 9199, plus the Vite
// dev servers on 5180/5181 and the single-origin proxy on 3000. During the migration
// BOTH stacks have to be up at once, so a Supabase port that collides with any of those
// is not an inconvenience — it makes the migration untestable.
//
// Purity, the same discipline as scripts/lib/emulatorPorts.mjs and
// scripts/lib/emulatorReap.mjs: this module imports NOTHING. No `fs`, no
// `child_process`, no `process.env` read of its own — the environment is passed in, so
// every decision is testable without a socket, a container or a database
// (scripts/test-supabase-env.ts).
//
// TWO GUARANTEES, both load-bearing:
//   1. No offset configured (unset / empty / '0' / garbage) ⇒ EXACTLY the documented
//      54321-block. The no-op is structural, so `npm run supabase:dev` on a fresh
//      checkout is reproducible.
//   2. A configured offset is snapped UP to a multiple of 1000, for the same arithmetic
//      reason the emulator module does it — see OFFSET_STEP below. That is what lets a
//      gate boot a second Supabase stack beside a live one.

/** The env var an operator sets to move the whole Supabase block. */
export const PORT_OFFSET_ENV = 'RUSHPOINT_SUPABASE_PORT_OFFSET';

/**
 * Every port the local Supabase stack publishes on the host.
 *
 * WHY 54321..54327 — the collision argument, in full
 * --------------------------------------------------
 * 54321 is the port the official `supabase` CLI uses for its local API gateway, so the
 * block is already familiar and already avoided by other tooling. More importantly it is
 * PROVABLY disjoint from everything this repo runs, in both the default and the offset
 * case:
 *
 *   Firebase emulator block (scripts/lib/emulatorPorts.mjs):
 *     4000 · 4400 · 4500 · 5001 · 5002 · 8080 · 9099 · 9150 · 9199
 *   Vite dev servers: 5180 · 5181 · Tunnel proxy: 3000
 *
 *   Nothing in 54321..54327 is in that set — the whole Supabase block sits ~45000 above
 *   the highest of them.
 *
 *   And the OFFSET case, which is the one that actually bites: the Firebase gate may be
 *   shifted by any multiple of 1000 up to +56000, so a Firebase port can be as high as
 *   65199 — inside Supabase's range. It still cannot collide, because BOTH blocks only
 *   ever move by whole multiples of 1000, so every port keeps its last three digits
 *   forever:
 *       Firebase last-3:  000 · 400 · 500 · 001 · 002 · 080 · 099 · 150 · 199
 *       Vite / proxy:     180 · 181 · 000
 *       Supabase last-3:  321 · 322 · 323 · 324 · 325 · 326 · 327
 *   The two digit-sets are disjoint, therefore no offset of either stack can ever land a
 *   Supabase port on a Firebase/Vite/proxy port. This is the reason OFFSET_STEP is 1000
 *   here too, and it is asserted in scripts/test-supabase-env.ts rather than merely
 *   argued.
 *
 * `kong` is the ONLY port an application should talk to; the four service ports are
 * published for debugging (curl PostgREST directly, tail GoTrue) and `db` for psql.
 */
export const BASE_SUPABASE_PORTS = Object.freeze({
  kong: 54321,
  db: 54322,
  studio: 54323,
  auth: 54324,
  rest: 54325,
  realtime: 54326,
  storage: 54327,
});

/**
 * Offsets are snapped UP to a multiple of this.
 *
 * Arithmetic, not taste — identical reasoning to emulatorPorts.mjs OFFSET_STEP. The
 * pairwise differences inside BASE_SUPABASE_PORTS are 1..6, so no multiple of 1000 can
 * map one Supabase service onto another Supabase service's port; and preserving the last
 * three digits is exactly what keeps the shifted block clear of the Firebase block (see
 * the digit-set argument above). Shifting by an arbitrary N would forfeit both.
 */
export const OFFSET_STEP = 1000;

/** Smallest separation we will hand out. Anything positive is raised to this. */
export const MIN_PORT_OFFSET = OFFSET_STEP;

/** Lowest / highest legal TCP port we will ever emit. */
export const MIN_LEGAL_PORT = 1024;
export const MAX_LEGAL_PORT = 65535;

const HIGHEST_BASE_PORT = Math.max(...Object.values(BASE_SUPABASE_PORTS));

/** Largest multiple of OFFSET_STEP that keeps the highest port inside the legal range. */
export const MAX_PORT_OFFSET =
  Math.floor((MAX_LEGAL_PORT - HIGHEST_BASE_PORT) / OFFSET_STEP) * OFFSET_STEP;

/** Digits with an optional sign. Deliberately narrow, see resolveSupabasePortOffset. */
const INTEGER_TEXT = /^[+-]?\d+$/;

function readEnvValue(env, key) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return undefined;
  return env[key];
}

/**
 * Resolve the EFFECTIVE offset from an environment mapping.
 *
 * Returns `{ requested, offset, notice }` with `notice` in
 * `null | 'invalid' | 'negative' | 'snapped' | 'clamped'`, so an operator whose typo was
 * ignored finds out immediately instead of wondering why the stack still fought the
 * live one.
 *
 * TOTAL — never throws, for any input at all (a non-object env, a number, an array, an
 * object value, undefined). This runs at the top of the launcher before Docker is even
 * probed; turning a typo in an env var into an unexplained crash would be strictly worse
 * than falling back.
 *
 * Garbage falls back to 0, NOT to some arbitrary offset. At worst the stack then refuses
 * to start because something already holds the ports, which is loud and obvious.
 * Silently choosing an offset nobody requested would be quiet and confusing.
 *
 * '1e3' and '0x10' are rejected rather than read as 1000 and 16: `Number()` would accept
 * them, but widening the accepted surface buys an operator nothing and costs clarity.
 */
export function resolveSupabasePortOffset(env) {
  const raw = readEnvValue(env, PORT_OFFSET_ENV);

  if (raw === undefined || raw === null) return { requested: null, offset: 0, notice: null };

  let n;
  if (typeof raw === 'number') {
    n = Number.isInteger(raw) ? raw : NaN;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return { requested: null, offset: 0, notice: null };
    n = INTEGER_TEXT.test(trimmed) ? Number(trimmed) : NaN;
  } else {
    n = NaN;
  }

  if (!Number.isFinite(n)) return { requested: null, offset: 0, notice: 'invalid' };
  if (n < 0) return { requested: n, offset: 0, notice: 'negative' };
  if (n === 0) return { requested: 0, offset: 0, notice: null };

  if (n > MAX_PORT_OFFSET) return { requested: n, offset: MAX_PORT_OFFSET, notice: 'clamped' };

  const snapped = Math.max(MIN_PORT_OFFSET, Math.ceil(n / OFFSET_STEP) * OFFSET_STEP);
  return { requested: n, offset: snapped, notice: snapped === n ? null : 'snapped' };
}

/**
 * The port map the launcher and docker-compose.supabase.yml use:
 * `{ kong, db, studio, auth, rest, realtime, storage }`.
 *
 * Total by construction — the resolver above never throws and never yields a
 * non-integer, so every value here is a finite integer, no two collide (the whole block
 * shifts by one constant), and every value stays inside MIN_LEGAL_PORT..MAX_LEGAL_PORT.
 * The bounds are re-asserted rather than argued: a future edit to BASE_SUPABASE_PORTS
 * could invalidate the reasoning, and an out-of-range port must fail the unit gate, not
 * a `docker compose up` at 2am.
 */
export function resolveSupabasePorts(env) {
  const { offset } = resolveSupabasePortOffset(env);
  const out = {};
  for (const [name, base] of Object.entries(BASE_SUPABASE_PORTS)) {
    const port = base + offset;
    out[name] = port >= MIN_LEGAL_PORT && port <= MAX_LEGAL_PORT ? port : base;
  }
  return out;
}

/**
 * The Docker Compose project name. An offset stack MUST get its own project name or
 * `docker compose up` would reuse the default stack's containers, networks and — worst
 * of all — its named volume, so the "isolated" gate stack would boot on the LIVE
 * database. Moving the ports alone is not isolation; this is the same lesson as
 * scripts/lib/emulatorIsolation.mjs (a private hub locator, not just private ports).
 */
export function supabaseProjectName(env) {
  const { offset } = resolveSupabasePortOffset(env);
  return offset === 0 ? 'rushpoint-supabase' : `rushpoint-supabase-${offset}`;
}

/** The named Docker volume holding Postgres data — scoped per project, same reason. */
export function supabaseVolumeName(env) {
  return `${supabaseProjectName(env)}-db-data`;
}

/**
 * Loopback literal, never `localhost`: client configs connect over 127.0.0.1 to avoid
 * the Windows IPv6 mismatch that already bit the Firebase emulator wiring (CLAUDE.md).
 */
export const LOOPBACK = '127.0.0.1';

/**
 * Every URL a developer or a client library needs, derived from the resolved ports.
 *
 * `apiUrl` is the one an app config should use (SUPABASE_URL): everything goes through
 * Kong. The per-service URLs exist for debugging and for the launcher's readiness
 * probes; do not wire an app to them, or the gateway's CORS/routing stops being
 * exercised locally and only breaks in production.
 *
 * `dbUrl` carries the password verbatim because it is a LOCAL-ONLY development
 * credential; the launcher prints a redacted form.
 */
export function buildSupabaseUrls(env, options = {}) {
  const ports = resolveSupabasePorts(env);
  const host = typeof options.host === 'string' && options.host.trim() !== ''
    ? options.host.trim()
    : LOOPBACK;
  const rawPassword = readEnvValue(env, 'POSTGRES_PASSWORD');
  const password =
    typeof rawPassword === 'string' && rawPassword !== '' ? rawPassword : 'postgres';
  const rawDbName = readEnvValue(env, 'POSTGRES_DB');
  const database = typeof rawDbName === 'string' && rawDbName !== '' ? rawDbName : 'postgres';

  return {
    apiUrl: `http://${host}:${ports.kong}`,
    studioUrl: `http://${host}:${ports.studio}`,
    authUrl: `http://${host}:${ports.auth}`,
    restUrl: `http://${host}:${ports.rest}`,
    realtimeUrl: `http://${host}:${ports.realtime}`,
    storageUrl: `http://${host}:${ports.storage}`,
    dbUrl: `postgresql://postgres:${encodeURIComponent(password)}@${host}:${ports.db}/${database}`,
    dbUrlRedacted: `postgresql://postgres:***@${host}:${ports.db}/${database}`,
  };
}

/**
 * The env vars the stack cannot boot without.
 *
 * `minLength` on the JWT secret is not pedantry: GoTrue signs with HS256 and a secret
 * shorter than 32 bytes produces tokens PostgREST will reject with an opaque 401, which
 * looks exactly like "my RLS policy is wrong" and costs an afternoon.
 */
export const REQUIRED_ENV = Object.freeze([
  Object.freeze({ key: 'POSTGRES_PASSWORD', minLength: 1 }),
  Object.freeze({ key: 'JWT_SECRET', minLength: 32 }),
  Object.freeze({ key: 'ANON_KEY', minLength: 1 }),
  Object.freeze({ key: 'SERVICE_ROLE_KEY', minLength: 1 }),
]);

/**
 * Validate an environment mapping against REQUIRED_ENV.
 *
 * Returns `{ ok, missing, problems }` — `missing` is the list of absent/blank keys,
 * `problems` is a list of `{ key, reason }` for present-but-unusable values. TOTAL:
 * never throws, for a null env, a string env, an array, or values of any type. The
 * launcher prints the report and exits with a readable message; a validator that throws
 * would hide the very list the developer needs.
 */
export function validateSupabaseEnv(env) {
  const missing = [];
  const problems = [];

  for (const spec of REQUIRED_ENV) {
    const raw = readEnvValue(env, spec.key);
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      missing.push(spec.key);
      continue;
    }
    if (typeof raw !== 'string') {
      problems.push({ key: spec.key, reason: `must be a string (got ${typeof raw})` });
      continue;
    }
    if (raw.length < spec.minLength) {
      problems.push({
        key: spec.key,
        reason: `must be at least ${spec.minLength} characters (got ${raw.length})`,
      });
    }
  }

  return { ok: missing.length === 0 && problems.length === 0, missing, problems };
}

/**
 * The exact `KEY=value` mapping docker-compose.supabase.yml interpolates.
 *
 * Kept here — not in the launcher — so the compose file's contract is unit-tested. Every
 * `${...}` in that file must appear as a key of this object; a port that exists in
 * BASE_SUPABASE_PORTS but is never handed to compose is a silently ignored setting.
 */
export function buildComposeEnv(env) {
  const ports = resolveSupabasePorts(env);
  return {
    SUPABASE_KONG_PORT: String(ports.kong),
    SUPABASE_DB_PORT: String(ports.db),
    SUPABASE_STUDIO_PORT: String(ports.studio),
    SUPABASE_AUTH_PORT: String(ports.auth),
    SUPABASE_REST_PORT: String(ports.rest),
    SUPABASE_REALTIME_PORT: String(ports.realtime),
    SUPABASE_STORAGE_PORT: String(ports.storage),
    COMPOSE_PROJECT_NAME: supabaseProjectName(env),
  };
}

/**
 * Order `supabase/migrations/*.sql` deterministically.
 *
 * Filename order, byte-wise (`localeCompare` would reorder under a Hebrew locale — this
 * repo's default language is Hebrew, so that is a live hazard, not a hypothetical).
 * Non-`.sql` entries are dropped rather than rejected: another agent owns that directory
 * and a stray README there must not stop the stack from booting. TOTAL — a non-array
 * input yields `[]`.
 */
export function orderMigrationFiles(names) {
  if (!Array.isArray(names)) return [];
  return names
    .filter((n) => typeof n === 'string' && /\.sql$/i.test(n))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** One-line human summary for the launcher's banner. */
export function describeSupabasePorts(ports, offsetInfo = { offset: 0, notice: null }) {
  const list = ['kong', 'db', 'studio', 'auth', 'rest', 'realtime', 'storage']
    .map((k) => `${k} ${ports[k]}`)
    .join(' · ');
  return `offset ${offsetInfo.offset} :: ${list}`;
}
