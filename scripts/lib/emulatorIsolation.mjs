// Pure decision logic for isolating an OFFSET emulator run from the live default-block
// suite (change: emulator-gate-isolation).
//
// THE PROBLEM this exists to solve
// -------------------------------
// `emulator-port-offset` moved the gate's ports out of the playtest's way, but the
// Firebase CLI has one more piece of cross-suite shared state that ports do not touch:
// the Emulator Hub LOCATOR. From the pinned firebase-tools@15.18.0,
// lib/emulator/hub.js:24-32:
//
//     static getLocatorFilePath(projectId) {
//         const dir = os.tmpdir();
//         if (!projectId) { projectId = EmulatorHub.MISSING_PROJECT_PLACEHOLDER; }
//         const filename = `hub-${projectId}.json`;
//         return path.join(dir, filename);
//     }
//
// It is keyed by the PROJECT ID and nothing else — not the port block, not the --config
// file, not the working directory. And it is the ONLY routing mechanism `firebase
// emulators:export` has: lib/emulator/controller.js:730-745 reads it through
// lib/emulator/hubClient.js:10 and POSTs /_admin/export to whichever origin it names.
// `emulators:export` has no --host and no --port flag.
//
// So the playtest's 120-second backup loop (scripts/emulator-backup.mjs:246) and its
// pre-teardown export (scripts/playtest-forever.mjs:262) can aim at the GATE's Firestore
// — the "emulators:export at the one live emulator wedges it" failure that
// scripts/free-ports.mjs:26-29 already documents. That is how an offset gate died
// mid-suite with a completely clean firestore-debug.log.
//
// THE FIX, in one variable: `os.tmpdir()` resolves from TEMP/TMP/TMPDIR, so pointing the
// offset run's temp directory at a private folder gives it a private locator. The two
// suites then cannot see, overwrite or command each other.
//
// PURITY: this module imports nothing. No `fs`, no `path`, no `process` — the offset, the
// repo root and the environment are all passed in, exactly like scripts/lib/emulatorPorts.mjs
// and scripts/lib/emulatorReap.mjs. Every decision is testable with no filesystem and no
// emulator (scripts/test-emulator-gate-isolation.ts). The impure shell (mkdir + spawn env)
// lives in scripts/emulator-exec.mjs and contains no decisions.

/** One-variable rollback, mirroring RUSHPOINT_REAP_DISABLE. */
export const ISOLATION_DISABLE_ENV = 'RUSHPOINT_EMULATOR_ISOLATE_DISABLE';

/**
 * Every variable that has to carry the private directory.
 *
 *   Windows Node   `os.tmpdir()`      → TEMP, then TMP
 *   Windows JVM    `java.io.tmpdir`   → GetTempPath: TMP, then TEMP
 *   POSIX          both               → TMPDIR, then TMP, then TEMP
 *
 * Setting all three is the only way to cover the Node CLI process AND the emulator JVMs
 * it launches on both platforms. Order is documentation, not precedence.
 */
export const TEMP_DIR_ENV_KEYS = Object.freeze(['TEMP', 'TMP', 'TMPDIR']);

/** firebase-tools EmulatorHub.MISSING_PROJECT_PLACEHOLDER (hub.js:184). */
export const HUB_LOCATOR_MISSING_PROJECT = 'demo-no-project';

/** Directory (relative to the repo root) that holds the per-offset private temp dirs. */
export const ISOLATION_DIR_SEGMENTS = Object.freeze(['.firebase', 'emulator-offset-tmp']);

/**
 * The locator file name firebase-tools derives for a project id.
 *
 * Reproduced here ONLY so a test can pin it as a literal: if a CLI upgrade ever changes
 * the scheme, scripts/test-emulator-gate-isolation.ts fails on a laptop instead of a
 * playtest failing at 2am. Nothing in the tooling parses or writes this file.
 */
export function hubLocatorFileName(projectId) {
  const id = typeof projectId === 'string' ? projectId.trim() : '';
  return `hub-${id === '' ? HUB_LOCATOR_MISSING_PROJECT : id}.json`;
}

function isTruthyFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}

/**
 * Join path segments using the separator flavour of the anchor.
 *
 * A hand-rolled join rather than `node:path` because this module imports nothing. The
 * anchor decides the flavour: a Windows repo root (`C:\repo`) yields backslashes, a POSIX
 * one yields forward slashes, so the produced path always looks native to its caller.
 */
function joinFrom(anchor, segments) {
  const sep = anchor.includes('\\') ? '\\' : '/';
  const base = anchor.replace(/[\\/]+$/, '');
  const parts = segments.map((s) => String(s).replace(/^[\\/]+|[\\/]+$/g, '')).filter(Boolean);
  const joined = [base, ...parts].join(sep);
  // Normalise any separator that arrived in a segment to the anchor's flavour.
  return sep === '\\' ? joined.replace(/\//g, '\\') : joined.replace(/\\/g, '/');
}

/**
 * THE decision. Given the ALREADY-RESOLVED port offset (from
 * scripts/lib/emulatorPorts.mjs), this repo's root and an environment mapping, decide
 * whether this run gets a private temp directory and which variables carry it.
 *
 * Returns `{ isolated, tmpDir, envOverrides, reason }`:
 *   isolated     — boolean.
 *   tmpDir       — the private directory, or `null`.
 *   envOverrides — `{}` when not isolated. THIS IS LOAD-BEARING: at offset 0 the launcher
 *                  spreads an empty object, so the child environment is byte-identical to
 *                  what it was before this change existed.
 *   reason       — 'no-offset' | 'disabled' | 'no-repo-root' | 'isolated'.
 *
 * TOTAL — never throws, for any input at all (undefined, a string offset, a numeric repo
 * root, a non-object env). This runs at the top of the launcher before an emulator exists;
 * a malformed input must degrade to "behave exactly like today", never to a crash.
 *
 * The offset must be a POSITIVE INTEGER NUMBER. A string '1000' is deliberately rejected:
 * the caller's job is to hand over the resolved offset, and silently re-parsing text here
 * would create a second, divergent parser next to resolveEmulatorPortOffset.
 *
 * Without a repo root there is no anchor for the private directory, so the plan refuses to
 * isolate rather than invent a path somewhere unpredictable. Refusing degrades to today's
 * (shared-locator) behaviour, which is survivable; guessing a path is not.
 */
export function planEmulatorIsolation(input) {
  const args = input && typeof input === 'object' ? input : {};
  const offsetRaw = args.offset;
  const env = args.env && typeof args.env === 'object' ? args.env : {};
  const repoRoot = typeof args.repoRoot === 'string' ? args.repoRoot.trim() : '';

  const none = (reason) => ({ isolated: false, tmpDir: null, envOverrides: {}, reason });

  const offset = typeof offsetRaw === 'number' && Number.isInteger(offsetRaw) ? offsetRaw : 0;
  if (offset <= 0) return none('no-offset');
  if (isTruthyFlag(env[ISOLATION_DISABLE_ENV])) return none('disabled');
  if (repoRoot === '') return none('no-repo-root');

  // Per-offset, so two gates on two different offsets are isolated from each other too.
  const tmpDir = joinFrom(repoRoot, [...ISOLATION_DIR_SEGMENTS, `offset-${offset}`]);
  const envOverrides = {};
  for (const key of TEMP_DIR_ENV_KEYS) envOverrides[key] = tmpDir;
  return { isolated: true, tmpDir, envOverrides, reason: 'isolated' };
}

/** One-line human summary for the launcher's banner. */
export function describeEmulatorIsolation(plan) {
  if (!plan || !plan.isolated) {
    return `hub locator: SHARED (${plan && plan.reason ? plan.reason : 'no-offset'})`;
  }
  return `hub locator: private — ${TEMP_DIR_ENV_KEYS.join('/')}=${plan.tmpDir}`;
}
