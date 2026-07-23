// Pure-logic tests for emulator-gate-isolation (change: emulator-gate-isolation).
//
// Two decisions are covered:
//   1. scripts/lib/emulatorIsolation.mjs — whether an emulator run gets its own temp
//      directory (and therefore its own firebase-tools hub locator), and which
//      environment variables carry it.
//   2. scripts/lib/staleHelperSweep.mjs — which stale-helper processes free-ports.mjs
//      may terminate, given a process snapshot, the recorded emulator-exec sessions and
//      the port block actually being swept.
//
// SAFETY: this file decides over in-memory fixtures. It never opens a socket, never
// enumerates a real process, never signals anything and never starts an emulator. The
// only filesystem access is reading the two modules' own source text to assert they
// import nothing. It must stay that way — a live playtest stack serves from this tree.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  ISOLATION_DISABLE_ENV,
  TEMP_DIR_ENV_KEYS,
  HUB_LOCATOR_MISSING_PROJECT,
  hubLocatorFileName,
  planEmulatorIsolation,
  describeEmulatorIsolation,
} from './lib/emulatorIsolation.mjs';
import {
  OFFSET_MARKER_PATTERNS,
  MAX_RUNNING_SESSION_AGE_MS,
  commandLinePort,
  isRunningSession,
  planStaleHelperSweep,
} from './lib/staleHelperSweep.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = 'C:\\repo\\RushPoint';

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — emulatorIsolation
// ─────────────────────────────────────────────────────────────────────────────

// 1.1 The firebase-tools contract, pinned as a LITERAL.
// firebase-tools@15.18.0 lib/emulator/hub.js:24-32
//   const dir = os.tmpdir();
//   if (!projectId) projectId = EmulatorHub.MISSING_PROJECT_PLACEHOLDER;  // "demo-no-project"
//   const filename = `hub-${projectId}.json`;
// If a CLI upgrade ever changes this, THIS assertion is what must fail — not a 2am run.
ok(hubLocatorFileName('rushpoint-pwa-7daaa') === 'hub-rushpoint-pwa-7daaa.json',
  'the hub locator file name is hub-<projectId>.json');
ok(HUB_LOCATOR_MISSING_PROJECT === 'demo-no-project',
  'the missing-project placeholder matches the CLI constant');
for (const missing of [undefined, null, '', '   ', 0 as unknown]) {
  ok(hubLocatorFileName(missing as never) === 'hub-demo-no-project.json',
    `a missing project id (${JSON.stringify(missing)}) falls back to the placeholder name`);
}

// 1.2 The temp-directory variables we must set. Windows Node reads TEMP then TMP;
// Windows GetTempPath (java.io.tmpdir) reads TMP then TEMP; POSIX reads TMPDIR first.
ok(Array.isArray(TEMP_DIR_ENV_KEYS)
  && ['TEMP', 'TMP', 'TMPDIR'].every((k) => TEMP_DIR_ENV_KEYS.includes(k)),
  'TEMP, TMP and TMPDIR are all covered');

// 1.3 No offset ⇒ NO isolation and, critically, an EMPTY override map. The default
// (offset 0) gate path must spawn its child with an unmodified environment.
const NO_ISOLATION_CASES: Array<[string, unknown]> = [
  ['offset 0', 0],
  ['offset undefined', undefined],
  ['offset null', null],
  ['offset NaN', Number.NaN],
  ['offset negative', -1000],
  ['offset text', '1000'],           // the planner takes a resolved NUMBER, not raw env text
  ['offset object', {}],
  ['offset Infinity', Number.POSITIVE_INFINITY],
  ['offset fractional', 12.5],
];
for (const [label, offset] of NO_ISOLATION_CASES) {
  const plan = planEmulatorIsolation({ offset: offset as never, repoRoot: REPO, env: {} });
  ok(plan.isolated === false, `${label} ⇒ not isolated`);
  ok(plan.tmpDir === null, `${label} ⇒ no private directory`);
  ok(plan.envOverrides && Object.keys(plan.envOverrides).length === 0,
    `${label} ⇒ no environment override at all`);
}

// 1.4 A positive offset ⇒ a private, per-offset directory under .firebase/, on all three vars.
{
  const plan = planEmulatorIsolation({ offset: 1000, repoRoot: REPO, env: {} });
  ok(plan.isolated === true, 'a positive offset isolates the run');
  ok(typeof plan.tmpDir === 'string' && plan.tmpDir.length > 0, 'a private directory is produced');
  ok(plan.tmpDir!.includes('.firebase'), 'the private directory lives under .firebase/');
  ok(plan.tmpDir!.includes('1000'), 'the private directory is keyed by the offset');
  ok(plan.tmpDir!.startsWith(REPO), 'the private directory is inside the repository');
  ok(plan.tmpDir!.includes('\\') && !plan.tmpDir!.includes('/'),
    'the separator follows the repo root flavour (backslash in, backslash out)');
  for (const key of TEMP_DIR_ENV_KEYS) {
    ok(plan.envOverrides[key] === plan.tmpDir, `${key} is set to the private directory`);
  }
  ok(Object.keys(plan.envOverrides).length === TEMP_DIR_ENV_KEYS.length,
    'nothing beyond the temp-directory variables is overridden');
  ok(typeof describeEmulatorIsolation(plan) === 'string'
    && describeEmulatorIsolation(plan).length > 0, 'the plan describes itself for the banner');
}

// A POSIX-flavoured repo root must produce forward slashes.
{
  const plan = planEmulatorIsolation({ offset: 2000, repoRoot: '/home/me/RushPoint', env: {} });
  ok(plan.tmpDir === '/home/me/RushPoint/.firebase/emulator-offset-tmp/offset-2000',
    'a POSIX repo root yields a POSIX private directory path');
}

// 1.5 Two different offsets are isolated from EACH OTHER too.
{
  const a = planEmulatorIsolation({ offset: 1000, repoRoot: REPO, env: {} });
  const b = planEmulatorIsolation({ offset: 2000, repoRoot: REPO, env: {} });
  ok(a.tmpDir !== b.tmpDir, 'two different offsets resolve two different directories');
}

// 1.6 One-variable rollback.
for (const raw of ['1', 'true', 'TRUE']) {
  const plan = planEmulatorIsolation({ offset: 1000, repoRoot: REPO, env: { [ISOLATION_DISABLE_ENV]: raw } });
  ok(plan.isolated === false, `${ISOLATION_DISABLE_ENV}=${raw} disables isolation`);
  ok(Object.keys(plan.envOverrides).length === 0, `${ISOLATION_DISABLE_ENV}=${raw} overrides nothing`);
  ok(plan.reason === 'disabled', `${ISOLATION_DISABLE_ENV}=${raw} says why`);
}
for (const raw of ['0', '', 'no', 'false']) {
  const plan = planEmulatorIsolation({ offset: 1000, repoRoot: REPO, env: { [ISOLATION_DISABLE_ENV]: raw } });
  ok(plan.isolated === true, `${ISOLATION_DISABLE_ENV}=${JSON.stringify(raw)} does NOT disable isolation`);
}

// 1.7 Totality — no input at all may throw, and a missing repo root may not isolate
// (a private directory with no anchor would land somewhere unpredictable).
{
  let threw = false;
  const inputs: unknown[] = [
    undefined, null, {}, { offset: 1000 }, { offset: 1000, repoRoot: '' },
    { offset: 1000, repoRoot: null, env: null }, { offset: '1000', repoRoot: REPO },
    { offset: 1000, repoRoot: REPO, env: 'nope' }, { offset: 1000, repoRoot: 42 },
  ];
  for (const input of inputs) {
    try {
      const plan = planEmulatorIsolation(input as never);
      ok(!!plan && typeof plan.isolated === 'boolean' && !!plan.envOverrides,
        `planEmulatorIsolation(${JSON.stringify(input)}) returns a complete plan`);
    } catch { threw = true; }
  }
  ok(!threw, 'planEmulatorIsolation never throws');
  const noRoot = planEmulatorIsolation({ offset: 1000, repoRoot: '', env: {} });
  ok(noRoot.isolated === false && noRoot.reason === 'no-repo-root',
    'without a repo root the plan refuses to isolate rather than guess a path');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — staleHelperSweep
// ─────────────────────────────────────────────────────────────────────────────

type Proc = { pid: number; ppid: number; commandLine: string };

// The patterns free-ports.mjs actually sweeps by (a representative subset).
const PATTERNS = [
  'scripts/emulator-backup.mjs',
  'functionsEmulatorRuntime',
  'emulators:exec',
  '.cache\\firebase\\emulators',
  '.cache/firebase/emulators',
  'scripts/emulator-exec.mjs',
  'scripts\\emulator-exec.mjs',
];
const SWEPT = [4000, 4400, 4500, 5001, 8080, 9099, 9199];

function verdicts(plan: { kill: Array<{ pid: number }>; keep: Array<{ pid: number; reason: string }> }) {
  const m = new Map<number, string>();
  for (const k of plan.keep) m.set(k.pid, `keep:${k.reason}`);
  for (const k of plan.kill) m.set(k.pid, 'kill');
  return m;
}

function assertTotal(plan: { kill: Array<{ pid: number }>; keep: Array<{ pid: number }> }, procs: Proc[], label: string) {
  const kill = new Set(plan.kill.map((p) => p.pid));
  const keep = new Set(plan.keep.map((p) => p.pid));
  const overlap = [...kill].filter((p) => keep.has(p));
  ok(overlap.length === 0, `${label}: keep ∩ kill is empty`);
  ok(kill.size + keep.size === procs.length, `${label}: keep ∪ kill covers every input process`);
}

// 2.1 The whole point: an in-flight OFFSET gate survives a sweep, and the default-block
// playtest emulator in the SAME snapshot still dies.
{
  const procs: Proc[] = [
    // --- the live playtest stack (default block) — must still be swept
    { pid: 100, ppid: 1, commandLine: 'node scripts/dev-emulator.mjs' },
    { pid: 101, ppid: 100, commandLine: 'java -jar C:\\Users\\me\\.cache\\firebase\\emulators\\cloud-firestore-emulator-v1.19.jar --host 127.0.0.1 --port 8080' },
    { pid: 102, ppid: 100, commandLine: 'node ...functionsEmulatorRuntime.js' },
    { pid: 103, ppid: 1, commandLine: 'node scripts/emulator-backup.mjs' },
    // --- the in-flight offset gate — must survive
    { pid: 200, ppid: 2, commandLine: 'node scripts/emulator-exec.mjs "node scripts/e2e-verify.mjs"' },
    { pid: 201, ppid: 200, commandLine: 'npx --yes firebase-tools@15.18.0 emulators:exec --only firestore,auth --project rushpoint-pwa-7daaa --config firebase.emulator-offset.json "node scripts/e2e-verify.mjs"' },
    { pid: 202, ppid: 201, commandLine: 'java -jar C:\\Users\\me\\.cache\\firebase\\emulators\\cloud-firestore-emulator-v1.19.jar --host 127.0.0.1 --port 9080' },
    { pid: 203, ppid: 201, commandLine: 'node ...functionsEmulatorRuntime.js' },
    // --- the sweeper itself
    { pid: 900, ppid: 2, commandLine: 'node scripts/free-ports.mjs' },
  ];
  const plan = planStaleHelperSweep({
    processes: procs,
    patterns: PATTERNS,
    sessions: [{ rootPid: 201, startedAt: 1_000, endedAt: null }],
    sweptPorts: SWEPT,
    selfPid: 900,
  });
  const v = verdicts(plan);
  ok(v.get(101) === 'kill', 'the default-block Firestore JVM is still swept');
  ok(v.get(102) === 'kill', 'the default-block functions worker is still swept');
  ok(v.get(103) === 'kill', 'the stale backup loop is still swept');
  ok(v.get(200) === 'keep:live-exec-session', 'the gate launcher (an ancestor of the live root) survives');
  ok(v.get(201) === 'keep:live-exec-session', 'the live emulators:exec root survives');
  ok(v.get(202) === 'keep:live-exec-session', 'the gate Firestore JVM survives');
  ok(v.get(203) === 'keep:live-exec-session', 'the gate functions worker survives');
  ok(v.get(900) === 'keep:self', 'the sweeper never targets itself');
  ok(v.get(100) === 'keep:no-pattern-match', 'a process matching no pattern is untouched');
  assertTotal(plan, procs, 'mixed live snapshot');
}

// 2.2 With NO session record at all, the offset marker alone still protects the gate,
// and so does a --port outside the swept block.
{
  const procs: Proc[] = [
    { pid: 301, ppid: 1, commandLine: 'npx firebase-tools emulators:exec --config firebase.emulator-offset.json "x"' },
    { pid: 302, ppid: 1, commandLine: 'java -jar .cache/firebase/emulators/cloud-firestore-emulator.jar --port 9080' },
    { pid: 303, ppid: 1, commandLine: 'java -jar .cache/firebase/emulators/cloud-firestore-emulator.jar --port 8080' },
    { pid: 304, ppid: 1, commandLine: 'npx firebase-tools emulators:exec "x"' },
    { pid: 305, ppid: 1, commandLine: 'node scripts/e2e-verify.mjs RUSHPOINT_EMULATOR_PORT_OFFSET=1000 emulators:exec' },
  ];
  const plan = planStaleHelperSweep({ processes: procs, patterns: PATTERNS, sessions: [], sweptPorts: SWEPT, selfPid: 999 });
  const v = verdicts(plan);
  ok(v.get(301) === 'keep:offset-port-block', 'an offset --config marker protects a session-less gate root');
  ok(v.get(302) === 'keep:foreign-port-block', 'an emulator on a port outside the swept block is spared');
  ok(v.get(303) === 'kill', 'an emulator on a port INSIDE the swept block is swept');
  ok(v.get(304) === 'kill', 'an unattributed default-block exec root is still swept');
  ok(v.get(305) === 'keep:offset-port-block', 'the offset env-var marker also protects');
  assertTotal(plan, procs, 'no-session snapshot');
}

// 2.3 A FINISHED session's leftovers are still swept — that is free-ports' whole job.
{
  const procs: Proc[] = [
    { pid: 401, ppid: 1, commandLine: 'npx firebase-tools emulators:exec --config firebase.json "x"' },
    { pid: 402, ppid: 401, commandLine: 'java -jar .cache/firebase/emulators/cloud-firestore-emulator.jar --port 8080' },
  ];
  const plan = planStaleHelperSweep({
    processes: procs, patterns: PATTERNS,
    sessions: [{ rootPid: 401, startedAt: 1_000, endedAt: 2_000 }],
    sweptPorts: SWEPT, selfPid: 999,
  });
  const v = verdicts(plan);
  ok(v.get(401) === 'kill' && v.get(402) === 'kill', 'a finished session leaves killable leftovers');
  ok(isRunningSession({ rootPid: 1, startedAt: 0, endedAt: null }) === true, 'endedAt null ⇒ running');
  ok(isRunningSession({ rootPid: 1, startedAt: 0, endedAt: 0 }) === false, 'endedAt 0 ⇒ finished, not running');
  ok(isRunningSession(undefined as never) === false, 'a missing session is not running');
}

// 2.3b A session record that never got its `endedAt` (power cut, closed terminal, SIGKILL)
// must NOT protect its debris forever — free-ports exists to clear exactly that wedge.
{
  const HOUR = 60 * 60 * 1000;
  const stale = { rootPid: 451, startedAt: 0, endedAt: null };
  ok(isRunningSession(stale, { nowMs: 1 * HOUR }) === true, 'a young unfinished session is live');
  ok(isRunningSession(stale, { nowMs: 24 * HOUR }) === false, 'a day-old unfinished session has aged out');
  ok(isRunningSession(stale, {}) === true, 'with no clock supplied nothing ever expires');
  ok(isRunningSession({ rootPid: 1, startedAt: 10 * HOUR, endedAt: null }, { nowMs: 1 * HOUR }) === true,
    'a future-dated record stays live (clock skew must not unlock a kill)');
  ok(isRunningSession({ rootPid: 1, endedAt: null }, { nowMs: 99 * HOUR }) === true,
    'a record with no start time cannot be aged out');
  ok(MAX_RUNNING_SESSION_AGE_MS >= 60 * 60 * 1000, 'the bound is generous enough for any gate');

  const procs: Proc[] = [
    { pid: 451, ppid: 1, commandLine: 'npx firebase-tools emulators:exec "x"' },
    { pid: 452, ppid: 451, commandLine: 'node ...functionsEmulatorRuntime.js' },
  ];
  const young = planStaleHelperSweep({
    processes: procs, patterns: PATTERNS, sessions: [stale], sweptPorts: SWEPT, selfPid: 999, nowMs: HOUR,
  });
  ok(verdicts(young).get(452) === 'keep:live-exec-session', 'a young unfinished session still protects');
  const aged = planStaleHelperSweep({
    processes: procs, patterns: PATTERNS, sessions: [stale], sweptPorts: SWEPT, selfPid: 999, nowMs: 24 * HOUR,
  });
  ok(verdicts(aged).get(451) === 'kill' && verdicts(aged).get(452) === 'kill',
    'an aged-out unfinished session no longer protects its debris');
  assertTotal(aged, procs, 'aged-out session');
}

// 2.4 An orphan whose live root has left the snapshot (Windows keeps naming a dead ppid)
// is still attributed to that live session.
{
  const procs: Proc[] = [
    { pid: 502, ppid: 501, commandLine: 'java -jar .cache/firebase/emulators/cloud-firestore-emulator.jar' },
  ];
  const plan = planStaleHelperSweep({
    processes: procs, patterns: PATTERNS,
    sessions: [{ rootPid: 501, startedAt: 1_000, endedAt: null }],
    sweptPorts: SWEPT, selfPid: 999,
  });
  ok(verdicts(plan).get(502) === 'keep:live-exec-session',
    'an orphan naming a live (absent) session root is spared');
}

// 2.5 The sweeper's ancestors are spared even when they match a pattern.
{
  const procs: Proc[] = [
    { pid: 601, ppid: 1, commandLine: 'node scripts/emulator-exec.mjs "node scripts/free-ports.mjs"' },
    { pid: 602, ppid: 601, commandLine: 'node scripts/free-ports.mjs' },
  ];
  const plan = planStaleHelperSweep({ processes: procs, patterns: PATTERNS, sessions: [], sweptPorts: SWEPT, selfPid: 602 });
  const v = verdicts(plan);
  ok(v.get(601) === 'keep:self-ancestor', 'an ancestor of the sweeper is spared');
  ok(v.get(602) === 'keep:self', 'the sweeper is spared');
}

// 2.6 Explicit protection.
{
  const procs: Proc[] = [{ pid: 701, ppid: 1, commandLine: 'npx firebase-tools emulators:exec "x"' }];
  const plan = planStaleHelperSweep({
    processes: procs, patterns: PATTERNS, sessions: [], sweptPorts: SWEPT, selfPid: 999, protectedPids: [701],
  });
  ok(verdicts(plan).get(701) === 'keep:protected', 'an explicitly protected pid is spared');
}

// 2.7 commandLinePort.
ok(commandLinePort('java -jar x.jar --host 127.0.0.1 --port 9080 --rules r') === 9080, '--port <n> is read');
ok(commandLinePort('java --port=9080') === 9080, '--port=<n> is read');
ok(commandLinePort('java -jar x.jar') === null, 'no --port yields null');
ok(commandLinePort('java --port abc') === null, 'a non-numeric --port yields null');
ok(commandLinePort(undefined as never) === null, 'a missing command line yields null');
ok(commandLinePort('java --port 99999') === null, 'an out-of-range --port yields null');

// 2.8 Totality / adversarial input — never throws, never drops a process.
{
  let threw = false;
  const junkInputs: unknown[] = [
    undefined, null, {}, { processes: null }, { processes: 'nope' },
    { processes: [null, undefined, {}, { pid: 'x' }] },
    { processes: [{ pid: 1, ppid: 1, commandLine: 'emulators:exec' }], sessions: 'nope', patterns: null },
  ];
  for (const input of junkInputs) {
    try {
      const plan = planStaleHelperSweep(input as never);
      ok(Array.isArray(plan.kill) && Array.isArray(plan.keep),
        `planStaleHelperSweep(${JSON.stringify(input)}) returns a plan`);
    } catch { threw = true; }
  }
  ok(!threw, 'planStaleHelperSweep never throws');

  // A parent cycle must terminate and must not attribute anything.
  const cyclic: Proc[] = [
    { pid: 801, ppid: 802, commandLine: 'npx firebase-tools emulators:exec "x"' },
    { pid: 802, ppid: 801, commandLine: 'npx firebase-tools emulators:exec "x"' },
  ];
  const plan = planStaleHelperSweep({ processes: cyclic, patterns: PATTERNS, sessions: [], sweptPorts: SWEPT, selfPid: 999 });
  assertTotal(plan, cyclic, 'cyclic ppid');
  ok(verdicts(plan).get(801) === 'kill' && verdicts(plan).get(802) === 'kill',
    'a ppid cycle terminates and attributes nothing');
}

// 2.9 Sanity on the exported marker list.
ok(OFFSET_MARKER_PATTERNS.some((p) => p.includes('emulator-offset')),
  'the generated offset config is one of the markers');
ok(OFFSET_MARKER_PATTERNS.some((p) => p.toUpperCase().includes('RUSHPOINT_EMULATOR_PORT_OFFSET')),
  'the offset env var is one of the markers');

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — both modules are genuinely pure (they import nothing)
// ─────────────────────────────────────────────────────────────────────────────
for (const name of ['emulatorIsolation.mjs', 'staleHelperSweep.mjs']) {
  const raw = readFileSync(path.join(HERE, 'lib', name), 'utf8');
  // Both modules document the very APIs they must not call ("no fs, no Date.now()"), so
  // scan CODE only — strip block and line comments before asserting.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/^\s*import\s/m.test(src), `${name} contains no import statement`);
  ok(!/require\s*\(/.test(src), `${name} contains no require() call`);
  ok(!/process\.(env|pid|platform)/.test(src), `${name} never reads the process object`);
  ok(!/Date\.now\s*\(/.test(src), `${name} never reads the clock`);
  ok(/export function/.test(src), `${name} still has real code after comment stripping`);
}

console.log(`\nemulator-gate-isolation: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
