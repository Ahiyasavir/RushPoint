// ═══════════════════════════════════════════════════════════════════════════════
// Measure what ONE location ping costs in Firestore reads and writes
// (change: spark-tier-location-load).
//
//   node scripts/emulator-exec.mjs "node scripts/measure-location-cost.mjs" > /tmp/loc.log 2>&1
//   node scripts/fs-ops-report.mjs /tmp/loc.log
//
// WHY A DEDICATED SCRIPT AND NOT simulate-run.mjs: the load simulator never calls
// `updateLocation` at all, so it cannot measure the very thing this change is about. Its
// numbers are about missions and scoring.
//
// WHY MEASURING PER-PING IS ENOUGH: `updateLocation`'s cost per call is deterministic —
// it does the same reads and writes every time. Cost-per-ping x pings-per-run x
// participants IS the projection, so there is no need to simulate 120 phones for 75
// minutes to learn it. That is what `projectRunCost` exists to do with these numbers.
//
// The script drives three deliberately-different ping patterns, because after this change
// they must diverge and today they must not:
//   • STATIONARY  — the same point, repeatedly. Today: full cost every ping.
//   • DRIFTING    — jitter within GPS error. Today: full cost every ping.
//   • WALKING     — real movement between points. Today and after: writes.
// Reported separately so the "after" run can be compared pattern by pattern.
// ═══════════════════════════════════════════════════════════════════════════════
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { resolveEmulatorPorts } from './lib/emulatorPorts.mjs';

const PROJECT = 'rushpoint-pwa-7daaa';
const EMU = resolveEmulatorPorts(process.env);
const arg = (name, dflt) =>
  Number((process.argv.find((a) => a.startsWith(`--${name}=`)) ?? '').split('=')[1] || dflt);

/** Pings per pattern. Small on purpose — the per-call cost is deterministic. */
const PINGS = Math.max(3, arg('pings', 10));
/** Seconds between pings assumed when projecting to a full run (play-web's real cadence). */
const PING_INTERVAL_S = Math.max(1, arg('interval', 20));

/**
 * REAL milliseconds to wait between pings. Default 0 (fire as fast as possible).
 *
 * ⚠️ THIS MATTERS FOR HONESTY, NOT JUST SPEED. The pin write is rate-limited on the SERVER's
 * clock, so firing pings back-to-back suppresses almost all of them and makes the saving
 * look far larger than a real run would ever see. A truthful write-rate measurement has to
 * space pings at the cadence real phones use — `--cadence-ms=20000`. Read counts are
 * unaffected by spacing, so the fast mode is fine for those.
 */
const CADENCE_MS = Math.max(0, arg('cadence-ms', 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE = { lat: 31.78, lng: 35.21 };
const metersToLat = (m) => m / 111_320;

function makeParty(name) {
  const app = initializeApp(
    { apiKey: 'emulator-key', projectId: PROJECT, appId: `meas-${name}` },
    name,
  );
  const auth = getAuth(app);
  const functions = getFunctions(app);
  connectAuthEmulator(auth, `http://127.0.0.1:${EMU.auth}`, { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', EMU.functions);
  return {
    auth,
    call: async (fn, data) => (await httpsCallable(functions, fn)(data)).data,
  };
}

async function main() {
  console.log('── updateLocation cost measurement ──\n');
  console.log(`pings per pattern: ${PINGS}   projected ping interval: ${PING_INTERVAL_S}s`);
  console.log(`real cadence between pings: ${CADENCE_MS}ms` +
    (CADENCE_MS === 0
      ? '  ⚠ WRITE counts will be UNREALISTICALLY LOW (server-side interval never elapses).'
      : ''));
  console.log('');

  const creator = makeParty('meas-creator');
  const ownerUid = (await signInAnonymously(creator.auth)).user.uid;

  const { gameId } = await creator.call('createGame', {
    title: 'Location cost measurement',
    mode: 'individual',
  });

  // A safe zone is configured on purpose: it is what makes updateLocation read the game
  // doc AND the team doc. Measuring without one would understate the real cost of the
  // configuration most outdoor runs actually use.
  await creator.call('updateGame', {
    gameId,
    scoringPreset: 'time_only',
    safeZone: { center: BASE, radiusMeters: 5_000 },
    stages: [{
      id: 'meas-s1',
      title: 'Stage 1',
      isFinal: true,
      tasks: [{
        id: 'meas-t1',
        title: 'Anywhere',
        type: 'self_report',
        locationless: true,
        points: 10,
      }],
    }],
  });

  const { runId, accessCode } = await creator.call('launchRun', { gameId });
  console.log(`game=${gameId} run=${runId} code=${accessCode}\n`);

  const team = makeParty('meas-team');
  await signInAnonymously(team.auth);
  await team.call('joinRun', { code: accessCode, displayName: 'Measurement Team' });
  await creator.call('startTeams', { gameId, runId });

  let pingIndex = 0;
  const ping = async (lat, lng, accuracyMeters) => {
    // Space pings at the requested cadence so the server-side write interval is exercised
    // the way a real run exercises it. Skipped before the first ping of the process.
    if (CADENCE_MS > 0 && pingIndex > 0) await sleep(CADENCE_MS);
    pingIndex++;
    return team.call('updateLocation', { lat, lng, accuracyMeters, ownerUid, gameId, runId });
  };

  // Each pattern is announced on its own line so the aggregator's operator can segment the
  // log by pattern when comparing before/after.
  console.log(`PATTERN stationary (${PINGS} pings at one point)`);
  for (let i = 0; i < PINGS; i++) await ping(BASE.lat, BASE.lng, 12);

  console.log(`PATTERN drifting (${PINGS} pings jittering within GPS error)`);
  for (let i = 0; i < PINGS; i++) {
    // ±8 m — well inside a typical 12 m accuracy radius, i.e. NOT real movement.
    const d = metersToLat(((i % 2 === 0 ? 1 : -1) * 8));
    await ping(BASE.lat + d, BASE.lng, 12);
  }

  console.log(`PATTERN walking (${PINGS} pings, ~28 m apart)`);
  for (let i = 0; i < PINGS; i++) {
    // 28 m per ping ~ walking pace over a 20 s interval.
    await ping(BASE.lat + metersToLat(28 * (i + 1)), BASE.lng, 12);
  }

  const totalPings = PINGS * 3;
  const runMinutes = 75;
  const pingsPerRun = Math.round((runMinutes * 60) / PING_INTERVAL_S);

  console.log(`\n── measurement complete ──`);
  console.log(`pings issued: ${totalPings}`);
  console.log(`a ${runMinutes}-minute run at ${PING_INTERVAL_S}s pings = ${pingsPerRun} pings per participant`);
  // NB: this hint deliberately avoids writing the cost-record marker as a bare word — the
  // aggregator scans for it, and a line that carries the marker without a payload is
  // (correctly) reported as unparsed. Tripping our own warning on every run would teach
  // the operator to ignore it, which is exactly what that warning must never become.
  console.log(`\nAggregate this log with:  node scripts/fs-ops-report.mjs <this-log> ` +
    `--participants=120 --pings-per-participant=${pingsPerRun} --measured-pings=${totalPings}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
