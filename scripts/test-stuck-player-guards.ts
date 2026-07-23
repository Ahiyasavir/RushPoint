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
  gpsRetryDelayMs, offlineSubmitGate, helpAlreadySent, blockedGuidance,
  GPS_RETRY_BASE_MS, GPS_RETRY_MAX_MS, BLOCKED_HELP_KEY,
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

// ─── 4. blockedGuidance — a blocked player is told something ACTIONABLE ───────
// The server already ships a rich verdict (`evaluateSafeZoneStatus`): `outside` is
// the ONLY reason that means "you left". Every other reason means "we cannot prove
// anything right now" — and the app rendered all of them as the same accusatory
// "head back into the play area", with no distance, no re-check and no human.
//
// Three properties are asserted over EVERY fixture:
//   a. there is no input for which the player loses the route to a human;
//   b. only `outside` is blamed on the player;
//   c. a distance is NEVER shown from a fix the server itself refused to trust.
function blockedCases(world: string): void {
  const KINDS: Array<[unknown, string]> = [
    ['outside', 'outside'],
    ['low_confidence', 'unconfirmed'],
    ['stale_fix', 'unconfirmed'],
    ['no_fix', 'unconfirmed'],
    ['invalid_fix', 'unconfirmed'],
    ['unverifiable', 'unconfirmed'],   // evaluateTeamOutOfBounds' catch branch
    ['override', 'released'],          // staff already let them back in
    ['inside', 'released'],
    ['no_zone', 'released'],
    // A reason we cannot substantiate must never be rendered as a violation.
    [undefined, 'unknown'],
    [null, 'unknown'],
    ['', 'unknown'],
    ['quantum_fix', 'unknown'],        // a server one version ahead
    [42, 'unknown'],
    [{}, 'unknown'],
  ];
  for (const [reason, kind] of KINDS) {
    const g = blockedGuidance({ reason: reason as string | null | undefined });
    check(`[${world}] reason ${JSON.stringify(reason)} → kind ${kind}`, g.kind === kind, g.kind);
    // (a) the escape hatch is unconditional.
    check(`[${world}] reason ${JSON.stringify(reason)} keeps the help affordance`, g.offerHelp === true);
    check(`[${world}] reason ${JSON.stringify(reason)} keeps the server re-check`, g.offerRecheck === true);
    // (b) only a confident, fresh, out-of-zone fix is the player's doing.
    check(`[${world}] reason ${JSON.stringify(reason)} blame flag`, g.blameless === (kind !== 'outside'), String(g.blameless));
  }

  // Distance — shown for `outside` only, rounded, and only when it is a real number.
  check(`[${world}] outside + 120 m → 120`, blockedGuidance({ reason: 'outside', metersOutside: 120 }).metersBack === 120);
  check(`[${world}] outside + 119.6 m rounds`, blockedGuidance({ reason: 'outside', metersOutside: 119.6 }).metersBack === 120);
  check(`[${world}] outside + 0.4 m rounds to nothing → null`, blockedGuidance({ reason: 'outside', metersOutside: 0.4 }).metersBack === null);
  for (const bad of [null, undefined, NaN, Infinity, -Infinity, -5, 0, '120' as unknown as number]) {
    const g = blockedGuidance({ reason: 'outside', metersOutside: bad as number | null | undefined });
    check(`[${world}] outside + invalid distance ${String(bad)} → null`, g.metersBack === null, String(g.metersBack));
  }
  // (c) THE case that sends a player walking the wrong way: the server computed a
  // distance but does not trust the fix it came from.
  for (const reason of ['low_confidence', 'stale_fix', 'no_fix', 'invalid_fix', 'override', 'inside', 'no_zone']) {
    const g = blockedGuidance({ reason, metersOutside: 500 });
    check(`[${world}] ${reason} + a distance → no distance shown`, g.metersBack === null, String(g.metersBack));
  }
  const unknownWithDist = blockedGuidance({ reason: undefined, metersOutside: 500 });
  check(`[${world}] unknown reason + a distance → no distance shown`, unknownWithDist.metersBack === null);

  // Total: no input throws, including a missing argument object.
  let threw = false;
  try {
    blockedGuidance({});
    blockedGuidance(undefined as unknown as { reason?: string | null });
  } catch { threw = true; }
  check(`[${world}] blockedGuidance never throws`, threw === false);

  // The blocked card has no task to latch the help affordance onto, so it uses a
  // stable key — which must NOT collide with a real task id and must re-arm once a
  // task is assigned.
  check(`[${world}] the blocked help key is a non-empty constant`, typeof BLOCKED_HELP_KEY === 'string' && BLOCKED_HELP_KEY.length > 0);
  check(`[${world}] help sent while blocked shows as sent on the blocked card`, helpAlreadySent(BLOCKED_HELP_KEY, BLOCKED_HELP_KEY) === true);
  check(`[${world}] help sent while blocked re-arms on a real task`, helpAlreadySent(BLOCKED_HELP_KEY, 'task-a') === false);
}

// ─── 5. Every case, in three clock worlds ─────────────────────────────────────
function runAllCases(world: string): void {
  gpsCases(world);
  offlineCases(world);
  helpCases(world);
  blockedCases(world);
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

// ─── 6. Wiring guards — the component must actually USE the guards ────────────
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

// The blocked-player card must be built from the SERVER's reason, and must carry
// both affordances. Without these the pure function is decoration.
check('the blocked card is decided by blockedGuidance', runner.includes('blockedGuidance('));
check('the blocked card reads the server reason off the routing response', /outOfBounds/.test(runner));
check('the blocked card can raise the host alert', runner.includes('BLOCKED_HELP_KEY'));
check(
  'requestHelp latches the id it is given (the blocked card has no task)',
  /function requestHelp\(\s*forId/.test(runner) && !/setHelpSentFor\(task!\.id\)/.test(runner),
);
check(
  'the geofence escape hatch no longer needs a distance to appear',
  !/const stuckOutside = dist != null && dist > radius && stuckTooLong/.test(runner),
);

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
