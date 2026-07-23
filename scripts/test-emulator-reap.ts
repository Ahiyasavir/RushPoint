// Pure-logic tests for emulator-exec-orphan-reap — WHICH processes a finished
// `firebase emulators:exec` run may reap, and (far more importantly) which it may NEVER.
// Run by scripts/run-unit-tests.mjs via `npm test`.
//
// SAFETY: every fixture below is a synthetic object literal. This file never enumerates,
// reads or signals a real process, and never touches the filesystem. It must stay that
// way — a live playtest stack serves from this working tree.
import { planEmulatorExecReap } from './lib/emulatorReap.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

type Proc = {
  pid: number;
  ppid?: number;
  commandLine: string;
  startedAt?: number;
  ports?: number[];
};
type Verdict = { pid: number; reason: string; commandLine?: string };
type Plan = { reap: Verdict[]; keep: Verdict[] };

const REPO = 'C:\\Users\\savir\\Projects\\Rushpoint';
const NOW = 1_800_000_000_000;
const MIN_AGE = 5_000;

const CACHE_JAR = 'C:\\Users\\savir\\.cache\\firebase\\emulators\\cloud-firestore-emulator-v1.19.11.jar';
const RUNTIME = 'node C:\\Users\\savir\\Projects\\Rushpoint\\node_modules\\firebase-tools\\lib\\emulator\\functionsEmulatorRuntime.js';
const EXEC_CMD = 'npx --yes firebase-tools@15.18.0 emulators:exec --only firestore,auth,functions,storage --project rushpoint-pwa-7daaa "node scripts/e2e-verify.mjs"';

// ── Sessions this repo recorded ──────────────────────────────────────────────
// S1 finished (its root process is GONE — the classic orphan case)
// S2 still running
// S3 finished, root process somehow still alive
// S4 finished, deep surviving chain
const SESSIONS = [
  { rootPid: 1000, startedAt: NOW - 600_000, endedAt: NOW - 300_000, cmd: EXEC_CMD },
  { rootPid: 2000, startedAt: NOW - 100_000, endedAt: null, cmd: EXEC_CMD },
  { rootPid: 7000, startedAt: NOW - 900_000, endedAt: NOW - 800_000, cmd: EXEC_CMD },
  { rootPid: 8000, startedAt: NOW - 700_000, endedAt: NOW - 650_000, cmd: EXEC_CMD },
  // S5 finished moments ago — the age floor, not attribution, is what protects its child.
  { rootPid: 5500, startedAt: NOW - 30_000, endedAt: NOW - 2_000, cmd: EXEC_CMD },
];

const PROCESSES: Proc[] = [
  // ── S1 orphans: parent 1000 is absent, born inside the session window ──────
  { pid: 1101, ppid: 1000, commandLine: `java -Xmx4g -jar ${CACHE_JAR}`, startedAt: NOW - 550_000, ports: [8080] },
  { pid: 1102, ppid: 1101, commandLine: RUNTIME, startedAt: NOW - 540_000, ports: [5001] },
  { pid: 1103, ppid: 1101, commandLine: RUNTIME, startedAt: NOW - 535_000, ports: [] },
  // …but a JVM born long AFTER S1 ended is pid-reuse, not an orphan.
  { pid: 1105, ppid: 1000, commandLine: RUNTIME, startedAt: NOW - 10_000, ports: [] },
  // …and one with an unusable start time can never be attributed.
  { pid: 1106, ppid: 1000, commandLine: `java -jar ${CACHE_JAR}`, startedAt: Number.NaN, ports: [] },
  // ── A perfectly attributable orphan of a JUST-finished session (S5), too young ──
  { pid: 1104, ppid: 5500, commandLine: `java -jar ${CACHE_JAR}`, startedAt: NOW - 1_000, ports: [] },

  // ── S2 is still running: nothing under it may be touched ──────────────────
  { pid: 2000, ppid: 0, commandLine: EXEC_CMD, startedAt: NOW - 100_000, ports: [] },
  { pid: 2001, ppid: 2000, commandLine: `java -Xmx4g -jar ${CACHE_JAR}`, startedAt: NOW - 95_000, ports: [] },

  // ── The CURRENTLY-LIVE dev/playtest stack — identical binaries, must survive ─
  { pid: 3000, ppid: 0, commandLine: `node ${REPO}\\scripts\\dev-emulator.mjs`, startedAt: NOW - 3_600_000, ports: [] },
  { pid: 3001, ppid: 3000, commandLine: 'npx firebase-tools emulators:start --import=.firebase/emulator-data --export-on-exit', startedAt: NOW - 3_590_000, ports: [4000, 4400] },
  { pid: 3002, ppid: 3001, commandLine: `java -Xmx4g -jar ${CACHE_JAR}`, startedAt: NOW - 3_580_000, ports: [8080, 9099] },
  { pid: 3003, ppid: 3002, commandLine: RUNTIME, startedAt: NOW - 3_570_000, ports: [5001] },

  // ── Another repository's emulator-exec session ────────────────────────────
  { pid: 4000, ppid: 0, commandLine: 'node D:\\Work\\OtherRepo\\scripts\\emulator-exec.mjs "node scripts/e2e-verify.mjs"', startedAt: NOW - 400_000, ports: [] },
  { pid: 4001, ppid: 4000, commandLine: 'npx --yes firebase-tools@15.18.0 emulators:exec --only firestore --project other-project "node scripts/e2e-verify.mjs"', startedAt: NOW - 395_000, ports: [] },
  { pid: 4002, ppid: 4001, commandLine: `java -Xmx4g -jar ${CACHE_JAR}`, startedAt: NOW - 390_000, ports: [] },

  // ── Unrelated processes ───────────────────────────────────────────────────
  { pid: 5000, ppid: 0, commandLine: 'java -jar C:\\tools\\some-unrelated-app.jar', startedAt: NOW - 5_000_000, ports: [] },
  { pid: 5001, ppid: 0, commandLine: 'C:\\Users\\savir\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', startedAt: NOW - 9_000_000, ports: [] },
  { pid: 5002, ppid: 0, commandLine: 'C:\\Program Files\\JetBrains\\IntelliJ\\bin\\idea64.exe', startedAt: NOW - 9_000_000, ports: [] },
  { pid: 5003, ppid: 5001, commandLine: `node ${REPO}\\node_modules\\typescript\\lib\\tsserver.js`, startedAt: NOW - 8_000_000, ports: [] },

  // ── The reaper itself, inside its own exec wrapper's tree ─────────────────
  { pid: 6000, ppid: 0, commandLine: `node ${REPO}\\scripts\\emulator-exec.mjs "node scripts/test-rules.mjs"`, startedAt: NOW - 60_000, ports: [] },
  { pid: 6001, ppid: 6000, commandLine: `node ${REPO}\\scripts\\lib\\reapEmulatorExec.mjs`, startedAt: NOW - 30_000, ports: [] },
  { pid: 6002, ppid: 6001, commandLine: `java -jar ${CACHE_JAR}`, startedAt: NOW - 25_000, ports: [] },

  // ── S3: the exec root itself survived a finished session ──────────────────
  { pid: 7000, ppid: 0, commandLine: EXEC_CMD, startedAt: NOW - 900_000, ports: [] },

  // ── S4: a deep chain whose root is gone but whose middle + leaf survive ───
  { pid: 8002, ppid: 8000, commandLine: 'npx --yes firebase-tools@15.18.0 emulators:exec --only firestore,auth --project rushpoint-pwa-7daaa "node scripts/test-rules.mjs"', startedAt: NOW - 690_000, ports: [4000] },
  { pid: 8003, ppid: 8002, commandLine: RUNTIME, startedAt: NOW - 685_000, ports: [] },

  // ── Degenerate shapes ─────────────────────────────────────────────────────
  { pid: 9000, ppid: 1000, commandLine: '', startedAt: NOW - 500_000, ports: [] },
  { pid: 9001, commandLine: `java -jar ${CACHE_JAR}`, startedAt: NOW - 500_000, ports: [] },
  { pid: 9100, ppid: 9101, commandLine: `java -jar ${CACHE_JAR}`, startedAt: NOW - 500_000, ports: [] },
  { pid: 9101, ppid: 9100, commandLine: RUNTIME, startedAt: NOW - 500_000, ports: [] },
  { pid: 9102, ppid: 9102, commandLine: `java -jar ${CACHE_JAR}`, startedAt: NOW - 500_000, ports: [] },
];

const PLAN_ARGS = {
  repoRoot: REPO,
  selfPid: 6001,
  protectedPids: [],
  sessions: SESSIONS,
  nowMs: NOW,
  minAgeMs: MIN_AGE,
};

// Lineages that must NEVER be reaped, whatever else changes.
const LIVE_STACK = [3000, 3001, 3002, 3003];
const REAPER_TREE = [6000, 6001, 6002];

function pids(list: Verdict[]): number[] {
  return list.map((v) => v.pid).sort((a, b) => a - b);
}
function reasonOf(plan: Plan, pid: number): string {
  return (plan.keep.find((v) => v.pid === pid) ?? plan.reap.find((v) => v.pid === pid))?.reason ?? '<missing>';
}

/** Safety invariants asserted on EVERY case, so no case can forget them. */
function assertInvariants(label: string, input: Proc[], plan: Plan) {
  const all = [...plan.keep, ...plan.reap].map((v) => v.pid).sort((a, b) => a - b);
  const inputPids = input.map((p) => p.pid).sort((a, b) => a - b);
  ok(JSON.stringify(all) === JSON.stringify(inputPids), `${label}: keep ∪ reap === input`);
  const keepSet = new Set(pids(plan.keep));
  ok(plan.reap.every((v) => !keepSet.has(v.pid)), `${label}: keep ∩ reap === ∅`);
  ok(plan.reap.every((v) => typeof v.reason === 'string' && v.reason.length > 0), `${label}: every reaped entry carries a reason`);
  const reaped = new Set(pids(plan.reap));
  ok(LIVE_STACK.every((p) => !reaped.has(p)), `${label}: the live emulator stack is never reaped`);
  ok(REAPER_TREE.every((p) => !reaped.has(p)), `${label}: the reaper's own tree is never reaped`);
}

// ── The full snapshot ────────────────────────────────────────────────────────
const plan = planEmulatorExecReap({ processes: PROCESSES, ...PLAN_ARGS }) as Plan;
assertInvariants('full snapshot', PROCESSES, plan);

// ── REAPED: exactly the orphans of finished sessions, nothing else ───────────
const EXPECTED_REAP = [1101, 1102, 1103, 7000, 8002, 8003];
ok(JSON.stringify(pids(plan.reap)) === JSON.stringify(EXPECTED_REAP),
  `reaps exactly the finished-session orphans (got ${JSON.stringify(pids(plan.reap))})`);

const reapedSet = new Set(pids(plan.reap));
ok(reapedSet.has(1101), 'classic orphan JVM (parent = finished session root, now absent) → reaped');
ok(reapedSet.has(1102) && reapedSet.has(1103), 'both functionsEmulatorRuntime workers under the orphan JVM → reaped');
ok(reapedSet.has(7000), 'a surviving emulators:exec root of a finished session → reaped');
ok(reapedSet.has(8002) && reapedSet.has(8003), 'deep chain (middle + leaf) of a finished session → reaped');

// ── NEVER REAPED — each with its explicit keep reason ────────────────────────
ok(!reapedSet.has(3002), 'the live dev stack JVM is never reaped');
ok(reasonOf(plan, 3002) === 'live-emulator-session', `live JVM kept as live-emulator-session (got ${reasonOf(plan, 3002)})`);
ok(reasonOf(plan, 3003) === 'live-emulator-session', `live functions worker kept as live-emulator-session (got ${reasonOf(plan, 3003)})`);
ok(reasonOf(plan, 3001) === 'live-emulator-session', `emulators:start CLI kept as live-emulator-session (got ${reasonOf(plan, 3001)})`);

ok(!reapedSet.has(4000) && !reapedSet.has(4001) && !reapedSet.has(4002), "another repository's emulator session is never reaped");
ok(reasonOf(plan, 4002) === 'unattributed', `foreign JVM kept as unattributed (got ${reasonOf(plan, 4002)})`);

ok(!reapedSet.has(5000), 'an unrelated java process is never reaped');
ok(reasonOf(plan, 5000) === 'not-an-emulator-process', `unrelated java kept as not-an-emulator-process (got ${reasonOf(plan, 5000)})`);
ok(reasonOf(plan, 5001) === 'not-an-emulator-process', 'VS Code is never reaped');
ok(reasonOf(plan, 5002) === 'not-an-emulator-process', 'IntelliJ is never reaped');
ok(reasonOf(plan, 5003) === 'not-an-emulator-process', 'a node language server is never reaped');

ok(!reapedSet.has(6001), 'the reaper itself is never reaped');
ok(reasonOf(plan, 6001) === 'self', `self kept with reason self (got ${reasonOf(plan, 6001)})`);
ok(reasonOf(plan, 6000) === 'self-ancestor', `the reaper's parent kept as self-ancestor (got ${reasonOf(plan, 6000)})`);
ok(reasonOf(plan, 6002) === 'protected-descendant', `a child of the reaper kept as protected-descendant (got ${reasonOf(plan, 6002)})`);

ok(reasonOf(plan, 2000) === 'running-exec-session', `a still-running exec root is kept (got ${reasonOf(plan, 2000)})`);
ok(reasonOf(plan, 2001) === 'running-exec-session', `a still-running exec session's JVM is kept (got ${reasonOf(plan, 2001)})`);

ok(reasonOf(plan, 1104) === 'too-young', `a process younger than minAgeMs is kept (got ${reasonOf(plan, 1104)})`);
ok(reasonOf(plan, 1105) === 'unattributed', `pid reuse (born after the session ended) is kept (got ${reasonOf(plan, 1105)})`);
ok(reasonOf(plan, 1106) === 'unknown-start-time', `an unusable start time is kept (got ${reasonOf(plan, 1106)})`);

ok(reasonOf(plan, 9000) === 'not-an-emulator-process', 'an empty command line is kept');
ok(reasonOf(plan, 9001) === 'unattributed', `a process with no ppid is kept (got ${reasonOf(plan, 9001)})`);
ok(reasonOf(plan, 9100) === 'unattributed' && reasonOf(plan, 9101) === 'unattributed', 'a ppid cycle terminates and both members are kept');
ok(reasonOf(plan, 9102) === 'unattributed', 'a self-parenting process terminates and is kept');

// ── Live stack alongside real orphans, in isolation ──────────────────────────
{
  const subset = PROCESSES.filter((p) => LIVE_STACK.includes(p.pid) || [1101, 1102, 1103].includes(p.pid));
  const p2 = planEmulatorExecReap({ processes: subset, ...PLAN_ARGS }) as Plan;
  assertInvariants('live+orphans', subset, p2);
  ok(JSON.stringify(pids(p2.reap)) === JSON.stringify([1101, 1102, 1103]),
    `only the orphans are reaped when the live stack is present (got ${JSON.stringify(pids(p2.reap))})`);
}

// ── Determinism: shuffled input → identical verdicts ─────────────────────────
{
  const shuffled = [...PROCESSES];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = (i * 7 + 3) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const p3 = planEmulatorExecReap({ processes: shuffled, ...PLAN_ARGS }) as Plan;
  assertInvariants('shuffled', shuffled, p3);
  ok(JSON.stringify(pids(p3.reap)) === JSON.stringify(EXPECTED_REAP), 'shuffled input yields the same reap set');
}

// ── No sessions recorded → nothing can be attributed ─────────────────────────
{
  const p4 = planEmulatorExecReap({ processes: PROCESSES, ...PLAN_ARGS, sessions: [] }) as Plan;
  assertInvariants('no sessions', PROCESSES, p4);
  ok(p4.reap.length === 0, `no session record → nothing is reaped (got ${JSON.stringify(pids(p4.reap))})`);
}

// ── Degenerate arguments never throw and never reap ──────────────────────────
{
  let threw = false;
  let empty: Plan | null = null;
  try { empty = planEmulatorExecReap({}) as Plan; } catch { threw = true; }
  ok(threw === false, 'empty argument object does not throw');
  ok(empty !== null && empty.reap.length === 0 && empty.keep.length === 0, 'empty argument object → empty plan');

  let threw2 = false;
  let none: Plan | null = null;
  try { none = planEmulatorExecReap() as Plan; } catch { threw2 = true; }
  ok(threw2 === false, 'no arguments at all does not throw');
  ok(none !== null && none.reap.length === 0, 'no arguments → nothing reaped');

  const p5 = planEmulatorExecReap({ processes: PROCESSES, repoRoot: REPO, sessions: SESSIONS }) as Plan;
  assertInvariants('no nowMs/minAge/self', PROCESSES, p5);
  ok(p5.reap.length > 0, 'missing nowMs/minAgeMs still produces a usable plan');
}

console.log(failed === 0
  ? `\n✅ ALL EMULATOR-REAP TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
