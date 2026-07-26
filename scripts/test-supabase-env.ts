// Pure-logic tests for supabase-local-dev — WHICH ports the local Supabase stack binds,
// the URLs derived from them, the required-env validator, and (the whole point of the
// file) the guarantee that NO Supabase port can ever collide with the Firebase Emulator
// Suite, the Vite dev servers or the tunnel proxy — at ANY supported offset of EITHER
// stack. Run by scripts/run-unit-tests.mjs via `npm test`.
//
// SAFETY: this file resolves numbers and strings. It never opens a socket, never reads
// the filesystem, never starts a container and never touches Docker. It must stay that
// way — a live playtest stack serves from this working tree.
import {
  BASE_SUPABASE_PORTS,
  PORT_OFFSET_ENV,
  MIN_PORT_OFFSET,
  MAX_PORT_OFFSET,
  OFFSET_STEP,
  REQUIRED_ENV,
  LOOPBACK,
  resolveSupabasePortOffset,
  resolveSupabasePorts,
  buildSupabaseUrls,
  buildComposeEnv,
  supabaseProjectName,
  supabaseVolumeName,
  validateSupabaseEnv,
  orderMigrationFiles,
  describeSupabasePorts,
} from './lib/supabaseEnv.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

type Ports = Record<string, number>;

// ── The no-op pin ────────────────────────────────────────────────────────────
// Written out as LITERALS on purpose. Importing BASE_SUPABASE_PORTS and comparing it
// to itself would pass even if someone edited the base table; these seven numbers are
// the documented contract of docker-compose.supabase.yml and .env.supabase.example.
const TODAY: Ports = {
  kong: 54321,
  db: 54322,
  studio: 54323,
  auth: 54324,
  rest: 54325,
  realtime: 54326,
  storage: 54327,
};
const KEYS = Object.keys(TODAY).sort();

function sameMap(a: Ports, b: Ports): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => a[k] === b[k]);
}

// ── 1. Default behaviour: the documented block, whatever the env looks like ───
const NO_OFFSET_ENVS: Array<[string, unknown]> = [
  ['undefined env', undefined],
  ['null env', null],
  ['empty env', {}],
  ['empty string', { [PORT_OFFSET_ENV]: '' }],
  ['whitespace', { [PORT_OFFSET_ENV]: '   ' }],
  ['literal zero', { [PORT_OFFSET_ENV]: '0' }],
  ['numeric zero', { [PORT_OFFSET_ENV]: 0 }],
  ['garbage text', { [PORT_OFFSET_ENV]: 'abc' }],
  ['NaN text', { [PORT_OFFSET_ENV]: 'NaN' }],
  ['Infinity text', { [PORT_OFFSET_ENV]: 'Infinity' }],
  ['negative', { [PORT_OFFSET_ENV]: '-5' }],
  ['exponent text', { [PORT_OFFSET_ENV]: '1e3' }],
  ['fractional', { [PORT_OFFSET_ENV]: '12.5' }],
  ['hex text', { [PORT_OFFSET_ENV]: '0x10' }],
  ['object value', { [PORT_OFFSET_ENV]: { nope: true } }],
  ['array value', { [PORT_OFFSET_ENV]: [1, 2] }],
  ['boolean value', { [PORT_OFFSET_ENV]: true }],
  ['env is a string', 'RUSHPOINT_SUPABASE_PORT_OFFSET=1000'],
  ['env is a number', 42],
  ['env is an array', ['RUSHPOINT_SUPABASE_PORT_OFFSET=1000']],
];
for (const [label, env] of NO_OFFSET_ENVS) {
  let ports: Ports | null = null;
  let threw = false;
  try { ports = resolveSupabasePorts(env as never) as Ports; } catch { threw = true; }
  ok(!threw, `${label}: resolveSupabasePorts does not throw`);
  ok(!!ports && sameMap(ports, TODAY), `${label}: resolves to the documented ports`);
  ok(resolveSupabasePortOffset(env as never).offset === 0, `${label}: effective offset is 0`);
  ok(supabaseProjectName(env as never) === 'rushpoint-supabase', `${label}: default project name`);
}

ok(sameMap(BASE_SUPABASE_PORTS as unknown as Ports, TODAY), 'BASE_SUPABASE_PORTS is the pinned table');

// A well-formed but unrequested value must not be silently "helpful".
ok(resolveSupabasePortOffset({ [PORT_OFFSET_ENV]: 'abc' }).notice === 'invalid', 'garbage is reported as invalid');
ok(resolveSupabasePortOffset({ [PORT_OFFSET_ENV]: '-5' }).notice === 'negative', 'a negative offset is reported');
ok(resolveSupabasePortOffset({}).notice === null, 'an absent offset produces no notice (the normal case)');

// ── 2. A positive offset shifts the whole block together ─────────────────────
for (const raw of ['1000', '2000', '7000', 1000, 9000, MAX_PORT_OFFSET]) {
  const info = resolveSupabasePortOffset({ [PORT_OFFSET_ENV]: raw });
  const ports = resolveSupabasePorts({ [PORT_OFFSET_ENV]: raw }) as Ports;
  const shiftedByExactly = KEYS.every((k) => ports[k] === TODAY[k] + info.offset);
  ok(shiftedByExactly, `offset ${String(raw)}: every port shifts by exactly ${info.offset}`);
  ok(info.offset % OFFSET_STEP === 0, `offset ${String(raw)}: effective offset is a multiple of ${OFFSET_STEP}`);
}

// ── 3. Snapping + bounds ─────────────────────────────────────────────────────
const SNAP_CASES: Array<[unknown, number, string | null]> = [
  ['1', MIN_PORT_OFFSET, 'snapped'],
  ['999', MIN_PORT_OFFSET, 'snapped'],
  ['1000', 1000, null],
  ['1001', 2000, 'snapped'],
  ['1019', 2000, 'snapped'],
  ['2500', 3000, 'snapped'],
  ['11000', MAX_PORT_OFFSET, null],
  ['11001', MAX_PORT_OFFSET, 'clamped'],
  ['999999999', MAX_PORT_OFFSET, 'clamped'],
];
for (const [raw, expected, notice] of SNAP_CASES) {
  const info = resolveSupabasePortOffset({ [PORT_OFFSET_ENV]: raw });
  ok(info.offset === expected, `offset ${String(raw)} → ${expected} (got ${info.offset})`);
  ok(info.notice === notice, `offset ${String(raw)} notice is ${String(notice)} (got ${String(info.notice)})`);
  ok(info.requested === Number(raw), `offset ${String(raw)}: the requested value is reported verbatim`);
}
ok(MIN_PORT_OFFSET === 1000, 'the minimum separation is 1000');
ok(MAX_PORT_OFFSET === 11000, 'the maximum offset keeps the top port inside the legal range');
ok(MAX_PORT_OFFSET + Math.max(...Object.values(TODAY)) <= 65535, 'the maximum offset is arithmetically sound');

// ── 4. Legality + internal collisions, over a wide sweep ─────────────────────
const SWEEP: unknown[] = [
  undefined, null, '', '   ', '0', '1', '7', '999', '1000', '1019', '2000', '3000',
  '4999', '5000', '11000', '11001', '999999999', '-1', '-1000', 'abc', 'NaN',
  'Infinity', '1e3', '12.5', '0x10', 0, 1, 1000, 7777,
];
for (const raw of SWEEP) {
  const env = raw === undefined ? {} : { [PORT_OFFSET_ENV]: raw };
  let ports: Ports;
  try {
    ports = resolveSupabasePorts(env as never) as Ports;
  } catch {
    ok(false, `sweep ${String(raw)}: threw`);
    continue;
  }
  const values = KEYS.map((k) => ports[k]);
  ok(values.every((p) => Number.isInteger(p)), `sweep ${String(raw)}: every port is an integer`);
  ok(values.every((p) => p >= 1024 && p <= 65535), `sweep ${String(raw)}: every port is legal`);
  ok(new Set(values).size === values.length, `sweep ${String(raw)}: no two ports collide`);
  ok(Object.keys(ports).length === KEYS.length, `sweep ${String(raw)}: the map is complete`);
}

// ── 5. ⭐ THE COLLISION PROOF ⭐ ──────────────────────────────────────────────
// The single most valuable assertion in this file. The developer runs the Firebase
// Emulator Suite permanently (playtest:forever). A Supabase port landing on one of its
// ports does not fail loudly — it makes ONE of the two stacks silently unreachable
// mid-migration. So: enumerate EVERY port EITHER stack can ever bind, at EVERY supported
// offset of EITHER, and assert the two sets are disjoint.
//
// Firebase base block is copied here as LITERALS rather than imported: this test must
// fail if scripts/lib/emulatorPorts.mjs moves a port under us, and importing it would
// make the two files agree with each other while both being wrong.
const FIREBASE_BASE = [4000, 4400, 4500, 5001, 5002, 8080, 9099, 9150, 9199];
const FIREBASE_MAX_OFFSET = 56000; // pinned by scripts/test-emulator-ports.ts
const OTHER_FIXED = [3000, 5180, 5181]; // tunnel proxy · creator-web · play-web

const FIREBASE_EVER = new Set<number>();
for (const base of FIREBASE_BASE) {
  for (let off = 0; off <= FIREBASE_MAX_OFFSET; off += OFFSET_STEP) {
    const p = base + off;
    if (p <= 65535) FIREBASE_EVER.add(p);
  }
}
for (const p of OTHER_FIXED) FIREBASE_EVER.add(p);

let collisions: string[] = [];
for (let off = 0; off <= MAX_PORT_OFFSET; off += OFFSET_STEP) {
  const ports = resolveSupabasePorts({ [PORT_OFFSET_ENV]: String(off) }) as Ports;
  for (const k of KEYS) {
    if (FIREBASE_EVER.has(ports[k])) collisions.push(`supabase ${k}=${ports[k]} @offset ${off}`);
  }
}
ok(
  collisions.length === 0,
  `no Supabase port at any offset collides with any Firebase/Vite/proxy port at any offset (found: ${collisions.slice(0, 5).join(', ')})`,
);

// The structural reason it holds — pinned so a future port edit that breaks the argument
// fails HERE with an explanation, not just as an opaque collision.
const supabaseLast3 = new Set(Object.values(TODAY).map((p) => p % 1000));
const otherLast3 = new Set([...FIREBASE_BASE, ...OTHER_FIXED].map((p) => p % 1000));
ok(
  [...supabaseLast3].every((d) => !otherLast3.has(d)),
  'the last-three-digits sets are disjoint, which is WHY no multiple-of-1000 offset can ever collide',
);
ok(Object.values(TODAY).every((p) => p > Math.max(...FIREBASE_BASE, ...OTHER_FIXED)),
  'the default Supabase block sits entirely above the default Firebase/Vite/proxy ports');

// ── 6. URLs ──────────────────────────────────────────────────────────────────
{
  const urls = buildSupabaseUrls({}) as Record<string, string>;
  ok(urls.apiUrl === 'http://127.0.0.1:54321', 'apiUrl is Kong on the loopback literal');
  ok(urls.studioUrl === 'http://127.0.0.1:54323', 'studioUrl points at Studio');
  ok(urls.restUrl === 'http://127.0.0.1:54325', 'restUrl points at PostgREST');
  ok(urls.dbUrl === 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', 'dbUrl defaults sensibly');
  ok(urls.dbUrlRedacted === 'postgresql://postgres:***@127.0.0.1:54322/postgres', 'the redacted dbUrl hides the password');
  ok(!urls.dbUrlRedacted.includes('postgres:postgres'), 'the redacted dbUrl really is redacted');
  ok(LOOPBACK === '127.0.0.1', 'the loopback literal is 127.0.0.1, never localhost (Windows IPv6)');

  const shifted = buildSupabaseUrls({ [PORT_OFFSET_ENV]: '1000' }) as Record<string, string>;
  ok(shifted.apiUrl === 'http://127.0.0.1:55321', 'apiUrl follows the offset');
  ok(shifted.dbUrl.includes(':55322/'), 'dbUrl follows the offset');

  const custom = buildSupabaseUrls(
    { POSTGRES_PASSWORD: 'p@ss word', POSTGRES_DB: 'rushpoint' },
  ) as Record<string, string>;
  ok(custom.dbUrl === 'postgresql://postgres:p%40ss%20word@127.0.0.1:54322/rushpoint',
    'a password with URL-unsafe characters is percent-encoded');

  const hosted = buildSupabaseUrls({}, { host: 'db.internal' }) as Record<string, string>;
  ok(hosted.apiUrl === 'http://db.internal:54321', 'an explicit host is honoured');

  let urlThrew = false;
  for (const bad of [null, undefined, 42, 'nope', []]) {
    try { buildSupabaseUrls(bad as never); } catch { urlThrew = true; }
  }
  ok(!urlThrew, 'buildSupabaseUrls tolerates every malformed env');
}

// ── 7. Compose env — the contract with docker-compose.supabase.yml ───────────
{
  const ce = buildComposeEnv({}) as Record<string, string>;
  ok(ce.SUPABASE_KONG_PORT === '54321', 'compose gets the Kong port');
  ok(ce.SUPABASE_DB_PORT === '54322', 'compose gets the DB port');
  ok(ce.SUPABASE_STUDIO_PORT === '54323', 'compose gets the Studio port');
  ok(ce.SUPABASE_AUTH_PORT === '54324', 'compose gets the Auth port');
  ok(ce.SUPABASE_REST_PORT === '54325', 'compose gets the REST port');
  ok(ce.SUPABASE_REALTIME_PORT === '54326', 'compose gets the Realtime port');
  ok(ce.SUPABASE_STORAGE_PORT === '54327', 'compose gets the Storage port');
  ok(ce.COMPOSE_PROJECT_NAME === 'rushpoint-supabase', 'compose gets the project name');
  ok(Object.values(ce).every((v) => typeof v === 'string'), 'every compose value is a string (compose interpolates text)');
  // Every port must reach compose: a resolved port compose never sees is a dead setting.
  ok(Object.keys(ce).length === KEYS.length + 1, 'every resolved port is handed to compose (+ the project name)');

  const shifted = buildComposeEnv({ [PORT_OFFSET_ENV]: '2000' }) as Record<string, string>;
  ok(shifted.SUPABASE_KONG_PORT === '56321', 'compose ports follow the offset');
  ok(shifted.COMPOSE_PROJECT_NAME === 'rushpoint-supabase-2000',
    'an offset stack gets its OWN compose project — otherwise it reuses the live stack containers + volume');
  ok(supabaseVolumeName({}) === 'rushpoint-supabase-db-data', 'the default volume name');
  ok(supabaseVolumeName({ [PORT_OFFSET_ENV]: '2000' }) === 'rushpoint-supabase-2000-db-data',
    'an offset stack gets its own volume — moving ports alone would still share the live database');
}

// ── 8. Required-env validation ───────────────────────────────────────────────
{
  const GOOD = {
    POSTGRES_PASSWORD: 'postgres',
    JWT_SECRET: 'super-secret-jwt-token-with-at-least-32-characters-long',
    ANON_KEY: 'anon.jwt.here',
    SERVICE_ROLE_KEY: 'service.jwt.here',
  };
  const good = validateSupabaseEnv(GOOD);
  ok(good.ok === true, 'a complete env validates');
  ok(good.missing.length === 0 && good.problems.length === 0, 'a complete env reports nothing');

  const empty = validateSupabaseEnv({});
  ok(empty.ok === false, 'an empty env fails');
  ok(empty.missing.length === REQUIRED_ENV.length, 'every required key is reported missing at once (not one at a time)');

  const blank = validateSupabaseEnv({ ...GOOD, ANON_KEY: '   ' });
  ok(blank.ok === false && blank.missing.includes('ANON_KEY'), 'a whitespace-only value counts as missing');

  const shortSecret = validateSupabaseEnv({ ...GOOD, JWT_SECRET: 'too-short' });
  ok(shortSecret.ok === false, 'a short JWT secret fails');
  ok(shortSecret.problems.some((p: { key: string }) => p.key === 'JWT_SECRET'),
    'a short JWT secret is a PROBLEM, not "missing" — HS256 under 32 bytes yields an opaque 401');

  const wrongType = validateSupabaseEnv({ ...GOOD, POSTGRES_PASSWORD: 12345 });
  ok(wrongType.ok === false && wrongType.problems.some((p: { key: string }) => p.key === 'POSTGRES_PASSWORD'),
    'a non-string value is reported as a problem');

  let vThrew = false;
  for (const bad of [null, undefined, 'string', 42, [], { JWT_SECRET: { nested: true } }]) {
    try { validateSupabaseEnv(bad as never); } catch { vThrew = true; }
  }
  ok(!vThrew, 'validateSupabaseEnv tolerates every malformed input');
}

// ── 9. Migration ordering ────────────────────────────────────────────────────
{
  const ordered = orderMigrationFiles([
    '20260726120000_c.sql', '20260101090000_a.sql', 'README.md', '20260315000000_b.sql', 'notes.txt',
  ]);
  ok(ordered.length === 3, 'non-.sql entries are dropped, not rejected (another agent owns that directory)');
  ok(ordered[0] === '20260101090000_a.sql' && ordered[2] === '20260726120000_c.sql', 'filename order, ascending');
  ok(orderMigrationFiles(['b.SQL', 'a.sql']).length === 2, '.SQL is accepted case-insensitively');
  ok(orderMigrationFiles([]).length === 0, 'an empty directory yields an empty plan (must not crash the launcher)');
  for (const bad of [null, undefined, 'a.sql', 42, {}]) {
    ok(orderMigrationFiles(bad as never).length === 0, `orderMigrationFiles(${String(bad)}) is []`);
  }
  ok(orderMigrationFiles([null, 1, 'a.sql'] as never).length === 1, 'non-string entries are ignored');
}

// ── 10. Banner ───────────────────────────────────────────────────────────────
{
  const line = describeSupabasePorts(resolveSupabasePorts({}) as Ports, { offset: 0, notice: null });
  ok(line.includes('kong 54321') && line.includes('storage 54327'), 'the banner names every port');
  let bThrew = false;
  try { describeSupabasePorts({} as Ports); } catch { bThrew = true; }
  ok(!bThrew, 'the banner tolerates a partial port map');
}

console.log(`\nsupabase-env: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
