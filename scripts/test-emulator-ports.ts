// Pure-logic tests for emulator-port-offset — WHICH ports every emulator-bound gate
// binds and connects to, and (far more importantly) the guarantee that with no offset
// configured the answer is byte-for-byte what it was before the feature existed.
// Run by scripts/run-unit-tests.mjs via `npm test`.
//
// SAFETY: this file resolves numbers. It never opens a socket, never reads the
// filesystem, never enumerates a process and never starts an emulator. It must stay
// that way — a live playtest stack serves from this working tree.
import {
  BASE_EMULATOR_PORTS,
  PORT_OFFSET_ENV,
  MIN_PORT_OFFSET,
  MAX_PORT_OFFSET,
  OFFSET_STEP,
  resolveEmulatorPortOffset,
  resolveEmulatorPorts,
  resolveEmulatorHostEnv,
  emulatorAddress,
  buildOffsetFirebaseConfig,
} from './lib/emulatorPorts.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

type Ports = Record<string, number>;

// ── The no-op pin ────────────────────────────────────────────────────────────
// Written out as LITERALS on purpose. Importing BASE_EMULATOR_PORTS and comparing it
// to itself would pass even if someone edited the base table; these nine numbers are
// the ports the tooling used before this change existed, and they are the contract.
const TODAY: Ports = {
  ui: 4000,
  hub: 4400,
  logging: 4500,
  functions: 5001,
  hosting: 5002,
  firestore: 8080,
  firestoreWebsocket: 9150,
  auth: 9099,
  storage: 9199,
};
const KEYS = Object.keys(TODAY).sort();

function sameMap(a: Ports, b: Ports): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => a[k] === b[k]);
}

// ── 1. Default behaviour is unchanged ────────────────────────────────────────
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
  ['env is a string', 'RUSHPOINT_EMULATOR_PORT_OFFSET=1000'],
  ['env is a number', 42],
];
for (const [label, env] of NO_OFFSET_ENVS) {
  let ports: Ports | null = null;
  let threw = false;
  try { ports = resolveEmulatorPorts(env as never) as Ports; } catch { threw = true; }
  ok(!threw, `${label}: resolveEmulatorPorts does not throw`);
  ok(!!ports && sameMap(ports, TODAY), `${label}: resolves to today's exact ports`);
  ok(resolveEmulatorPortOffset(env as never).offset === 0, `${label}: effective offset is 0`);
}

ok(sameMap(BASE_EMULATOR_PORTS as unknown as Ports, TODAY), 'BASE_EMULATOR_PORTS is the pinned table');

// A well-formed but unrequested value must not be silently "helpful".
ok(resolveEmulatorPortOffset({ [PORT_OFFSET_ENV]: 'abc' }).notice === 'invalid', 'garbage is reported as invalid');
ok(resolveEmulatorPortOffset({ [PORT_OFFSET_ENV]: '-5' }).notice === 'negative', 'a negative offset is reported');
ok(resolveEmulatorPortOffset({}).notice === null, 'an absent offset produces no notice (the normal case)');

// ── 2. A positive offset shifts the whole block together ─────────────────────
for (const raw of ['1000', '2000', '7000', 1000, 25000, MAX_PORT_OFFSET]) {
  const info = resolveEmulatorPortOffset({ [PORT_OFFSET_ENV]: raw });
  const ports = resolveEmulatorPorts({ [PORT_OFFSET_ENV]: raw }) as Ports;
  const shiftedByExactly = KEYS.every((k) => ports[k] === TODAY[k] + info.offset);
  ok(shiftedByExactly, `offset ${String(raw)}: every port shifts by exactly ${info.offset}`);
  ok(info.offset % OFFSET_STEP === 0, `offset ${String(raw)}: effective offset is a multiple of ${OFFSET_STEP}`);
}

// ── 3. Snapping + bounds ─────────────────────────────────────────────────────
const SNAP_CASES: Array<[unknown, number, string | null]> = [
  ['1', MIN_PORT_OFFSET, 'snapped'],
  ['1', MIN_PORT_OFFSET, 'snapped'],
  ['999', MIN_PORT_OFFSET, 'snapped'],
  ['1000', 1000, null],
  ['1001', 2000, 'snapped'],
  ['1019', 2000, 'snapped'],   // the collision case: 8080+1019 == the live Auth port
  ['1070', 2000, 'snapped'],
  ['2500', 3000, 'snapped'],
  ['56000', MAX_PORT_OFFSET, null],
  ['56001', MAX_PORT_OFFSET, 'clamped'],
  ['999999999', MAX_PORT_OFFSET, 'clamped'],
];
for (const [raw, expected, notice] of SNAP_CASES) {
  const info = resolveEmulatorPortOffset({ [PORT_OFFSET_ENV]: raw });
  ok(info.offset === expected, `offset ${String(raw)} → ${expected} (got ${info.offset})`);
  ok(info.notice === notice, `offset ${String(raw)} notice is ${String(notice)} (got ${String(info.notice)})`);
  ok(info.requested === Number(raw), `offset ${String(raw)}: the requested value is reported verbatim`);
}
ok(MIN_PORT_OFFSET === 1000, 'the minimum separation is 1000');
ok(MAX_PORT_OFFSET === 56000, 'the maximum offset keeps the top port inside the legal range');
ok(MAX_PORT_OFFSET + Math.max(...Object.values(TODAY)) <= 65535, 'the maximum offset is arithmetically sound');

// ── 4. Legality + internal collisions, over a wide sweep ─────────────────────
const SWEEP: unknown[] = [
  undefined, null, '', '   ', '0', '1', '7', '999', '1000', '1019', '1070', '1119',
  '2000', '3000', '4999', '5000', '12345', '56000', '56001', '999999999',
  '-1', '-1000', 'abc', 'NaN', 'Infinity', '1e3', '12.5', '0x10', 0, 1, 1000, 33333,
];
for (const raw of SWEEP) {
  const env = raw === undefined ? {} : { [PORT_OFFSET_ENV]: raw };
  let ports: Ports;
  try {
    ports = resolveEmulatorPorts(env) as Ports;
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

// ── 5. A shifted block never touches the live default block ──────────────────
// This is the entire point of the feature: the gate must be able to run beside a
// playtest stack that owns 4000/4400/4500/5001/5002/8080/9099/9150/9199 and the dev
// servers on 5180/5181 behind the proxy on 3000.
const LIVE = new Set<number>([...Object.values(TODAY), 3000, 5180, 5181]);
for (let offset = MIN_PORT_OFFSET; offset <= MAX_PORT_OFFSET; offset += OFFSET_STEP) {
  const ports = resolveEmulatorPorts({ [PORT_OFFSET_ENV]: String(offset) }) as Ports;
  const clash = KEYS.map((k) => ports[k]).filter((p) => LIVE.has(p));
  if (clash.length > 0) {
    ok(false, `offset ${offset} collides with the live block on ${clash.join(', ')}`);
    break;
  }
}
ok(true, 'every supported offset keeps the shifted block clear of the live block');

// ── 6. Host strings ──────────────────────────────────────────────────────────
{
  const env = { [PORT_OFFSET_ENV]: '1000' };
  const ports = resolveEmulatorPorts(env) as Ports;
  const hosts = resolveEmulatorHostEnv(env) as Record<string, string>;
  ok(hosts.FIRESTORE_EMULATOR_HOST === `127.0.0.1:${ports.firestore}`, 'FIRESTORE_EMULATOR_HOST follows the offset');
  ok(hosts.FIREBASE_AUTH_EMULATOR_HOST === `127.0.0.1:${ports.auth}`, 'FIREBASE_AUTH_EMULATOR_HOST follows the offset');
  ok(hosts.FIREBASE_STORAGE_EMULATOR_HOST === `127.0.0.1:${ports.storage}`, 'FIREBASE_STORAGE_EMULATOR_HOST follows the offset');
  const defaults = resolveEmulatorHostEnv({}) as Record<string, string>;
  ok(defaults.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080', 'the default Firestore host string is unchanged');
  ok(defaults.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099', 'the default Auth host string is unchanged');
  ok(defaults.FIREBASE_STORAGE_EMULATOR_HOST === '127.0.0.1:9199', 'the default Storage host string is unchanged');
  ok(emulatorAddress(8080) === '127.0.0.1:8080', 'emulatorAddress defaults to the loopback host');
  ok(emulatorAddress(8080, 'localhost') === 'localhost:8080', 'emulatorAddress accepts an explicit host');
}

// ── 7. The generated firebase.json ───────────────────────────────────────────
{
  const base = {
    firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' },
    storage: { rules: 'storage.rules' },
    functions: { source: 'functions', runtime: 'nodejs20', predeploy: ['npm run shared:build'] },
    hosting: [{ target: 'creator', public: 'apps/creator-web/dist' }],
    emulators: {
      singleProjectMode: true,
      auth: { port: 9099 },
      functions: { port: 5001 },
      firestore: { port: 8080 },
      storage: { port: 9199 },
      hosting: { port: 5002 },
      ui: { enabled: true, port: 4000, host: 'localhost' },
    },
  };
  const snapshot = JSON.stringify(base);
  const ports = resolveEmulatorPorts({ [PORT_OFFSET_ENV]: '1000' }) as Ports;
  const out = buildOffsetFirebaseConfig(base, ports) as any;

  ok(JSON.stringify(base) === snapshot, 'buildOffsetFirebaseConfig does not mutate its input');
  ok(out !== base, 'buildOffsetFirebaseConfig returns a new object');
  ok(out.emulators.firestore.port === ports.firestore, 'the Firestore port is written');
  ok(out.emulators.firestore.websocketPort === ports.firestoreWebsocket, 'the Firestore websocket port is pinned');
  ok(out.emulators.auth.port === ports.auth, 'the Auth port is written');
  ok(out.emulators.functions.port === ports.functions, 'the Functions port is written');
  ok(out.emulators.storage.port === ports.storage, 'the Storage port is written');
  ok(out.emulators.hosting.port === ports.hosting, 'the Hosting port is written');
  ok(out.emulators.ui.port === ports.ui, 'the UI port is written');
  ok(out.emulators.ui.enabled === true && out.emulators.ui.host === 'localhost', 'other UI settings survive');
  ok(out.emulators.hub.port === ports.hub, 'the hub port is pinned (it is absent from firebase.json)');
  ok(out.emulators.logging.port === ports.logging, 'the logging port is pinned (it is absent from firebase.json)');
  ok(out.emulators.singleProjectMode === true, 'singleProjectMode survives');
  ok(out.functions.source === 'functions', 'the functions source is carried over verbatim');
  ok(out.firestore.rules === 'firestore.rules', 'the Firestore rules path is carried over verbatim');
  ok(out.storage.rules === 'storage.rules', 'the Storage rules path is carried over verbatim');
  ok(Array.isArray(out.hosting) && out.hosting[0].target === 'creator', 'the hosting targets are carried over');

  // Defensive: a config with no emulators block at all must still produce a full one.
  const bare = buildOffsetFirebaseConfig({ functions: { source: 'functions' } }, ports) as any;
  ok(bare.emulators.firestore.port === ports.firestore, 'a config with no emulators block gains one');
  ok(bare.functions.source === 'functions', 'a bare config keeps its other sections');
  // And a non-object input must not throw.
  let bareThrew = false;
  try { buildOffsetFirebaseConfig(null as never, ports); } catch { bareThrew = true; }
  ok(!bareThrew, 'buildOffsetFirebaseConfig tolerates a null base config');
}

console.log(`\nemulator-ports: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
