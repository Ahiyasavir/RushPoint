// The single source of truth for WHICH ports the Firebase Emulator Suite binds, and
// which ports every emulator-bound gate connects to (change: emulator-port-offset).
//
// Why this exists
// ---------------
// `npm run playtest:forever` boots a long-lived stack that owns the whole default
// emulator block (UI 4000 · hub 4400 · logging 4500 · Functions 5001 · Firestore 8080 ·
// Auth 9099 · Storage 9199) plus the dev servers on 5180/5181. Every gate hardcoded
// those numbers, so `npm run verify:emulator` was unrunnable whenever a playtest was up
// — and killing a playtest that may be serving a live event is not an option. One env
// var, RUSHPOINT_EMULATOR_PORT_OFFSET, now moves the ENTIRE gate block to a second,
// provably non-overlapping range.
//
// Purity, same discipline as scripts/lib/tunnelRestart.mjs and scripts/lib/emulatorReap.mjs:
// this module imports nothing. No `fs`, no `child_process`, no `process.env` read of its
// own — the environment is passed in, so every decision is testable without a socket, a
// file or a running emulator (scripts/test-emulator-ports.ts).
//
// TWO GUARANTEES, both load-bearing:
//   1. No offset configured (unset / empty / '0' / garbage) ⇒ EXACTLY today's ports, and
//      scripts/emulator-exec.mjs does not even pass --config. The no-op is structural.
//   2. A configured offset is snapped UP to a multiple of 1000. Not cosmetic: see the
//      OFFSET_STEP comment — a naive offset can silently park one emulator on another
//      LIVE emulator's port.

/** The env var an operator sets to move the gate's emulator block. */
export const PORT_OFFSET_ENV = 'RUSHPOINT_EMULATOR_PORT_OFFSET';

/**
 * Every port the suite binds — not only the five declared in firebase.json.
 *
 * ui/hub/logging/firestoreWebsocket are absent from firebase.json today and the CLI
 * "helpfully" auto-finds a free port for them when the default is taken. That silent
 * drift is worse than a hard failure during a playtest: the Emulator UI appears on an
 * unpredictable port and the hub would answer for the OTHER stack's session. So they are
 * resolved and pinned here too. `hosting` is never started by the gate's
 * `--only firestore,auth,functions,storage`, and is included so a future `--only hosting`
 * cannot reintroduce the bug.
 *
 * Values match firebase-tools@15.18.0 `lib/emulator/constants.js` DEFAULT_PORTS and this
 * repo's committed firebase.json. Changing a number here changes the DEFAULT block for
 * every gate — scripts/test-emulator-ports.ts pins all nine as literals so that can never
 * happen silently.
 */
export const BASE_EMULATOR_PORTS = Object.freeze({
  ui: 4000,
  hub: 4400,
  logging: 4500,
  functions: 5001,
  hosting: 5002,
  firestore: 8080,
  firestoreWebsocket: 9150,
  auth: 9099,
  storage: 9199,
});

/**
 * Offsets are snapped UP to a multiple of this.
 *
 * The reason is arithmetic, not taste. Shifting by an arbitrary N can land a shifted port
 * exactly on a DIFFERENT service's port in the still-running default block:
 *
 *     firestore 8080 + 1019 = 9099   ← the live playtest stack's Auth emulator
 *     firestore 8080 + 1070 = 9150   ← its Firestore UI websocket
 *     firestore 8080 + 1119 = 9199   ← its Storage emulator
 *
 * No pairwise difference between two ports in BASE_EMULATOR_PORTS is a multiple of 1000
 * (the full difference table is enumerated in the change's design.md §2), so a
 * multiple-of-1000 offset is PROVABLY disjoint from the default block. It also preserves
 * the last three digits of every port, which keeps the shifted block clear of the dev
 * servers on 5180/5181 and the tunnel proxy on 3000 for free.
 */
export const OFFSET_STEP = 1000;

/** Smallest separation we will hand out. Anything positive is raised to this. */
export const MIN_PORT_OFFSET = OFFSET_STEP;

/** Lowest / highest legal TCP port we will ever emit. */
export const MIN_LEGAL_PORT = 1024;
export const MAX_LEGAL_PORT = 65535;

const HIGHEST_BASE_PORT = Math.max(...Object.values(BASE_EMULATOR_PORTS));

/** Largest multiple of OFFSET_STEP that keeps the highest port inside the legal range. */
export const MAX_PORT_OFFSET =
  Math.floor((MAX_LEGAL_PORT - HIGHEST_BASE_PORT) / OFFSET_STEP) * OFFSET_STEP;

/** Digits with an optional sign. Deliberately narrow, see resolveEmulatorPortOffset. */
const INTEGER_TEXT = /^[+-]?\d+$/;

function readEnvValue(env) {
  if (!env || typeof env !== 'object') return undefined;
  return env[PORT_OFFSET_ENV];
}

/**
 * Resolve the EFFECTIVE offset from an environment mapping.
 *
 * Returns `{ requested, offset, notice }`:
 *   requested — what the operator asked for as a number, or null when nothing/garbage.
 *   offset    — what will actually be used. Always a multiple of OFFSET_STEP, or 0.
 *   notice    — null | 'invalid' | 'negative' | 'snapped' | 'clamped'. The caller prints
 *               it, so an operator whose typo was ignored finds out immediately instead of
 *               wondering why the gate still fought the live stack.
 *
 * TOTAL — never throws, for any input at all (a non-object env, a number, an object
 * value, undefined). This runs at the top of every gate script before an emulator exists;
 * turning a typo in an env var into an unexplained crash would be strictly worse than
 * falling back.
 *
 * Garbage falls back to 0, NOT to some arbitrary offset. At worst the gate then refuses to
 * start because the live stack holds the ports, which is loud and obvious. Silently
 * choosing an offset nobody requested would be quiet and confusing.
 *
 * '1e3' and '0x10' are rejected rather than read as 1000 and 16: `Number()` would accept
 * them, but widening the accepted surface buys an operator nothing and costs clarity.
 */
export function resolveEmulatorPortOffset(env) {
  const raw = readEnvValue(env);

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
 * The port map every gate uses: `{ ui, hub, logging, functions, hosting, firestore,
 * firestoreWebsocket, auth, storage }`.
 *
 * Total by construction — the offset resolver above never throws and never yields a
 * non-integer, so every value here is a finite integer, no two collide (the whole block
 * shifts by one constant), and every value stays inside MIN_LEGAL_PORT..MAX_LEGAL_PORT.
 * The bounds are asserted anyway rather than argued: a future edit to BASE_EMULATOR_PORTS
 * could invalidate the reasoning, and an out-of-range port must fail the unit gate, not a
 * gate run at 2am.
 */
export function resolveEmulatorPorts(env) {
  const { offset } = resolveEmulatorPortOffset(env);
  const out = {};
  for (const [name, base] of Object.entries(BASE_EMULATOR_PORTS)) {
    const port = base + offset;
    out[name] = port >= MIN_LEGAL_PORT && port <= MAX_LEGAL_PORT ? port : base;
  }
  return out;
}

/** `host:port`, the shape every FIREBASE_*_EMULATOR_HOST env var wants. */
export function emulatorAddress(port, host = '127.0.0.1') {
  return `${host}:${port}`;
}

/**
 * The three `*_EMULATOR_HOST` variables the Admin SDK and the rules-unit-testing helpers
 * read. Gate scripts assign these with `??=` so the values the Firebase CLI already
 * exported into an `emulators:exec` child always win; this only fills the gap, which is
 * what lets a gate also run standalone against an already-running offset stack.
 *
 * Note the loopback literal: client configs connect over 127.0.0.1, never `localhost`,
 * to avoid the Windows IPv6 mismatch (see CLAUDE.md).
 */
export function resolveEmulatorHostEnv(env) {
  const ports = resolveEmulatorPorts(env);
  return {
    FIRESTORE_EMULATOR_HOST: emulatorAddress(ports.firestore),
    FIREBASE_AUTH_EMULATOR_HOST: emulatorAddress(ports.auth),
    FIREBASE_STORAGE_EMULATOR_HOST: emulatorAddress(ports.storage),
  };
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Derive a firebase.json-shaped object with ONLY the emulator port block replaced.
 *
 * Pure: the input is never mutated (a crashed gate must not be able to leave the repo's
 * committed firebase.json rewritten), and every non-emulator section — `functions.source`,
 * the rules and index paths, the hosting targets — is carried over verbatim, because the
 * generated file is what the CLI resolves all of those relative paths against.
 *
 * `hub` and `logging` are written even though the committed config omits them: without an
 * explicit port the CLI auto-finds one, and an auto-found hub would answer for whichever
 * stack grabbed the port first.
 *
 * Tolerates a missing / non-object `emulators` block and a null base config, so a
 * malformed firebase.json degrades to "ports set, nothing else" instead of throwing inside
 * the launcher.
 */
export function buildOffsetFirebaseConfig(baseConfig, ports) {
  const base = isPlainObject(baseConfig) ? baseConfig : {};
  const emulators = isPlainObject(base.emulators) ? base.emulators : {};
  const section = (name, extra = {}) => ({
    ...(isPlainObject(emulators[name]) ? emulators[name] : {}),
    ...extra,
  });

  return {
    ...base,
    emulators: {
      ...emulators,
      ui: section('ui', { port: ports.ui }),
      hub: section('hub', { port: ports.hub }),
      logging: section('logging', { port: ports.logging }),
      functions: section('functions', { port: ports.functions }),
      hosting: section('hosting', { port: ports.hosting }),
      firestore: section('firestore', {
        port: ports.firestore,
        websocketPort: ports.firestoreWebsocket,
      }),
      auth: section('auth', { port: ports.auth }),
      storage: section('storage', { port: ports.storage }),
    },
  };
}

/** One-line human summary for the launcher's banner. */
export function describeEmulatorPorts(ports, offsetInfo = { offset: 0, notice: null }) {
  const list = ['firestore', 'auth', 'functions', 'storage', 'ui', 'hub', 'logging']
    .map((k) => `${k} ${ports[k]}`)
    .join(' · ');
  return `offset ${offsetInfo.offset} :: ${list}`;
}
