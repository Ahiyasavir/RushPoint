// Pure-logic tests for the participant "can I still act?" guards
// (change: stuck-player-guards).
//
// The motivating bug: the wrong-answer retry lockout shipped an ABSOLUTE server
// instant and TaskRunner counted it down against the DEVICE clock, so a phone
// running hours behind disabled its own answer controls for hours — and a reload
// re-read the same instant and re-froze it. This suite guards the SIBLINGS of that
// class: every client-side decision that can block a player's progress.
//
// Two properties are asserted throughout:
//   1. FAIL OPEN — no input makes the app stop trying / stop letting the player try.
//      The server is the authority; the client's job is to let them reach it.
//   2. NO CLOCK — these guards take counters and identities, never an instant. The
//      whole suite is re-run under a stubbed Date.now (±6h) and must not budge.
//
//   npx tsx scripts/test-stuck-player-guards.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  gpsRetryDelayMs, offlineSubmitGate, helpAlreadySent,
  GPS_RETRY_BASE_MS, GPS_RETRY_MAX_MS,
} from '../apps/play-web/src/lib/stuckGuards';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const here = dirname(fileURLToPath(import.meta.url));

// ─── 1. gpsRetryDelayMs — the geofence watcher must never give up ─────────────
function gpsCases(world: string): void {
  check(`[${world}] 1st retry is the 3s base`, gpsRetryDelayMs(1) === GPS_RETRY_BASE_MS, String(gpsRetryDelayMs(1)));
  check(`[${world}] 2nd retry doubles`, gpsRetryDelayMs(2) === 6_000, String(gpsRetryDelayMs(2)));
  check(`[${world}] 3rd retry doubles again`, gpsRetryDelayMs(3) === 12_000, String(gpsRetryDelayMs(3)));
  // Cap boundary, both sides.
  check(`[${world}] 4th retry is the last value below the cap`, gpsRetryDelayMs(4) === 24_000, String(gpsRetryDelayMs(4)));
  check(`[${world}] 5th retry is capped`, gpsRetryDelayMs(5) === GPS_RETRY_MAX_MS, String(gpsRetryDelayMs(5)));
  check(`[${world}] a long outage stays capped`, gpsRetryDelayMs(100) === GPS_RETRY_MAX_MS, String(gpsRetryDelayMs(100)));

  // Missing / nonsense inputs fall back to the base rather than to Infinity/NaN —
  // a NaN delay would make setTimeout fire immediately in a tight loop, and an
  // Infinite one would never fire at all: both are stuck states.
  for (const bad of [0, -1, -999, NaN, Infinity, -Infinity, undefined as unknown as number, null as unknown as number, '3' as unknown as number]) {
    check(`[${world}] invalid input ${String(bad)} → base`, gpsRetryDelayMs(bad) === GPS_RETRY_BASE_MS, String(gpsRetryDelayMs(bad)));
  }

  // Sweep invariants — this IS the fail-open property for the watcher.
  let prev = -1;
  let sweepOk = true;
  let sweepDetail = '';
  for (let n = 0; n <= 200; n++) {
    const d = gpsRetryDelayMs(n);
    if (!Number.isFinite(d) || d <= 0 || d > GPS_RETRY_MAX_MS) { sweepOk = false; sweepDetail = `n=${n} d=${d}`; break; }
    if (n >= 1 && d < prev) { sweepOk = false; sweepDetail = `n=${n} d=${d} < prev=${prev}`; break; }
    if (n >= 1) prev = d;
  }
  check(`[${world}] every retry delay is finite, positive, capped and non-decreasing`, sweepOk, sweepDetail);
}

// ─── 2. offlineSubmitGate — warn once, then defer to the network ──────────────
function offlineCases(world: string): void {
  const A = 'task-a';
  const B = 'task-b';

  const online = offlineSubmitGate({ online: true, nudgedForTaskId: null, taskId: A });
  check(`[${world}] online → not blocked`, online.blocked === false && online.reason === null);

  // No navigator (SSR / an exotic webview): unknown connectivity must not block.
  const unknown = offlineSubmitGate({ online: undefined, nudgedForTaskId: null, taskId: A });
  check(`[${world}] unknown connectivity → not blocked`, unknown.blocked === false);

  const first = offlineSubmitGate({ online: false, nudgedForTaskId: null, taskId: A });
  check(`[${world}] first offline attempt is blocked`, first.blocked === true && first.reason === 'offline');
  check(`[${world}] the blocked attempt records its task`, first.nudgedForTaskId === A, String(first.nudgedForTaskId));

  // THE fail-open case: the browser flag may simply be wrong, and it is cleared
  // only by an `online` event that never fires when the browser never noticed a
  // disconnect. A second attempt goes to the network.
  const second = offlineSubmitGate({ online: false, nudgedForTaskId: first.nudgedForTaskId, taskId: A });
  check(`[${world}] repeat attempt on the same task is NOT blocked`, second.blocked === false && second.reason === null);
  check(`[${world}] repeat attempt keeps the memory`, second.nudgedForTaskId === A, String(second.nudgedForTaskId));

  const otherTask = offlineSubmitGate({ online: false, nudgedForTaskId: A, taskId: B });
  check(`[${world}] a new task is nudged once more`, otherTask.blocked === true && otherTask.nudgedForTaskId === B);

  // Reload: the guard reads nothing from storage, so a fresh state is a first run.
  const afterReload = offlineSubmitGate({ online: false, nudgedForTaskId: null, taskId: A });
  check(`[${world}] a reload cannot restore an "already blocked" state`, afterReload.blocked === first.blocked);
  const afterReloadOnline = offlineSubmitGate({ online: true, nudgedForTaskId: null, taskId: A });
  check(`[${world}] a reload while online is not blocked`, afterReloadOnline.blocked === false);

  // A missing/empty task id must not make "never nudged" look like "already nudged".
  const emptyFirst = offlineSubmitGate({ online: false, nudgedForTaskId: null, taskId: '' });
  check(`[${world}] empty task id: first attempt still nudges`, emptyFirst.blocked === true);
  const emptySecond = offlineSubmitGate({ online: false, nudgedForTaskId: '', taskId: '' });
  check(`[${world}] empty task id: second attempt is allowed`, emptySecond.blocked === false);
  // Going back online clears nothing but must never block.
  const recovered = offlineSubmitGate({ online: true, nudgedForTaskId: A, taskId: B });
  check(`[${world}] back online with a stale memory → not blocked`, recovered.blocked === false);
}

// ─── 3. helpAlreadySent — the escape hatch re-arms on a new task ──────────────
function helpCases(world: string): void {
  check(`[${world}] nothing sent → affordance available`, helpAlreadySent(null, 'task-a') === false);
  check(`[${world}] sent for this task → shows "sent"`, helpAlreadySent('task-a', 'task-a') === true);
  check(`[${world}] a different task re-arms the affordance`, helpAlreadySent('task-a', 'task-b') === false);
  check(`[${world}] no current task → affordance available`, helpAlreadySent('task-a', null) === false);
  // A FAILED triggerSOS records nothing, so the request-failure path leaves no
  // latched flag — the player can simply tap again.
  check(`[${world}] a failed request leaves no latch`, helpAlreadySent(null, 'task-a') === false);
}

// ─── 4. Every case, in three clock worlds ─────────────────────────────────────
function runAllCases(world: string): void {
  gpsCases(world);
  offlineCases(world);
  helpCases(world);
}

const realNow = Date.now;
runAllCases('clock ok');
try {
  Date.now = () => 0;
  runAllCases('clock at epoch');
  Date.now = () => realNow() + 6 * 3600_000;
  runAllCases('clock +6h');
  Date.now = () => realNow() - 6 * 3600_000;
  runAllCases('clock -6h');
} finally {
  Date.now = realNow;
}

// ─── 5. Wiring guards — the component must actually USE the guards ────────────
// A pure function nobody calls fixes nothing. These assertions are what make the
// RED phase meaningful for the React side, which has no component test runner.
const runner = readFileSync(join(here, '..', 'apps', 'play-web', 'src', 'components', 'TaskRunner.tsx'), 'utf8');
check('TaskRunner imports the guards', /from '\.\.\/lib\/stuckGuards'/.test(runner));
check('the geofence watcher schedules a retry', runner.includes('gpsRetryDelayMs('));
check('blockedOffline decides via offlineSubmitGate', runner.includes('offlineSubmitGate('));
check('the help affordance is derived per task', runner.includes('helpAlreadySent('));
check('helpSent is no longer a run-wide boolean', !/const \[helpSent, setHelpSent\] = useState\(false\)/.test(runner));

const geofenceSrc = runner.slice(runner.indexOf('function GeofenceAuto'));
check(
  'GeofenceAuto restarts its watch instead of only clearing it',
  geofenceSrc.includes('setTimeout') && geofenceSrc.includes('gpsRetryDelayMs('),
);

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
