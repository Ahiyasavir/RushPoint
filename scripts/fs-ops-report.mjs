// Report Firestore operation cost from a captured log (change: spark-tier-location-load).
//
//   node scripts/fs-ops-report.mjs <logfile>
//   node scripts/fs-ops-report.mjs <logfile> --participants=120 --pings-per-participant=225 \
//        --measured-pings=30
//
// Reads the per-invocation `fsops` records emitted by functions/src/obs/log.ts, totals
// them, and — when told how the measurement maps onto a real run — projects the cost to a
// target participant count and judges it against the Spark daily ceilings.
//
// The projection always prints the DENOMINATOR it used. A bare "does not fit" is
// unfalsifiable; "30 pings measured at 2.00 writes each, x225 pings x120 participants" is
// a claim a human can check and disagree with.
import { readFileSync } from 'node:fs';
import { parseFsOpsRecords, aggregateFsOps, formatFsOps } from './lib/fsOpsAggregate.mjs';
import { SPARK_DAILY_QUOTA } from '../packages/shared/dist/firestoreOpBudget.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const num = (name) => {
  const raw = (args.find((a) => a.startsWith(`--${name}=`)) ?? '').split('=')[1];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

if (!file) {
  console.error('usage: node scripts/fs-ops-report.mjs <logfile> [--participants=N] ' +
    '[--pings-per-participant=N] [--measured-pings=N]');
  process.exit(2);
}

const text = readFileSync(file, 'utf8');
const { records, unparsed } = parseFsOpsRecords(text);
const agg = aggregateFsOps(records);

console.log(`\n── Firestore cost from ${file} ──\n`);
console.log(formatFsOps(agg));

// Never let a silent parse failure masquerade as a clean, low number.
if (unparsed > 0) {
  console.log(`\n⚠  ${unparsed} line(s) carried the fsops marker but could not be parsed.`);
  console.log('   The totals above are therefore a LOWER BOUND, not a measurement.');
}
if (records.length === 0) {
  console.log('\n⚠  No fsops records found. Was RUSHPOINT_FS_OPCOUNT=1 set for the API/emulator?');
  console.log('   A run that counted nothing prints the same zeroes as a run that cost nothing.');
}

// ── Optional projection ──────────────────────────────────────────────────────
const participants = num('participants');
const pingsPerParticipant = num('pings-per-participant');
const measuredPings = num('measured-pings');

const loc = agg.byCallable.updateLocation;
if (participants && pingsPerParticipant && measuredPings && loc) {
  const readsPerPing = loc.reads / measuredPings;
  const writesPerPing = loc.writes / measuredPings;
  const projReads = Math.round(readsPerPing * pingsPerParticipant * participants);
  const projWrites = Math.round(writesPerPing * pingsPerParticipant * participants);

  console.log('\n── Projection: location alone ──\n');
  console.log(`  measured:   ${loc.reads} reads / ${loc.writes} writes over ${measuredPings} pings`);
  console.log(`              = ${readsPerPing.toFixed(2)} reads and ${writesPerPing.toFixed(2)} writes per ping`);
  console.log(`  scaled by:  ${pingsPerParticipant} pings/participant x ${participants} participants`);
  console.log(`  projected:  ${projReads} reads / ${projWrites} writes`);
  console.log(`  quota:      ${SPARK_DAILY_QUOTA.reads} reads / ${SPARK_DAILY_QUOTA.writes} writes (Spark, daily)`);
  console.log(`  headroom:   ${SPARK_DAILY_QUOTA.reads - projReads} reads / ` +
    `${SPARK_DAILY_QUOTA.writes - projWrites} writes`);

  const fits = projReads <= SPARK_DAILY_QUOTA.reads && projWrites <= SPARK_DAILY_QUOTA.writes;
  console.log(`\n  ⇒ location alone ${fits ? 'FITS' : 'DOES NOT FIT'} inside the free tier` +
    `${fits ? ' — before missions, feed, chat and leaderboard are counted.' : '.'}`);
} else if (participants || pingsPerParticipant || measuredPings) {
  console.log('\n⚠  Projection skipped: it needs --participants, --pings-per-participant and ' +
    '--measured-pings, plus at least one updateLocation record.');
}
