// Pure-logic test for run-email scope + the daily digest
// (change: run-email-scope-and-digest). No emulator, no network, no mailer.
//
//   npx tsx scripts/test-run-email-scope.ts
//
// WHY THIS EXISTS. Two independent defects converged into "the review emails
// stopped arriving":
//
//  1. The per-run summary email is sent from `onRunFinalized`, a Firestore
//     TRIGGER — and the self-hosted VPS host (`functions/server.js`) mounts
//     CALLABLES ONLY. So since 2026-07-27 the email (plus player-profile folds
//     and the benchmark contribution) simply never ran. That half is proven by
//     `functions/src/runs/postFinalize.test.ts`, not here.
//  2. Once delivery is restored, the email is actively UNWANTED for two run
//     classes: self-guided demo runs (potentially many a day) and the
//     simulations run while checking the app. Both burn provider quota and bury
//     the one email that matters — a real organizer's event. `shouldEmailRunSummary`
//     is that filter, and it is tested here.
//
// The digest half covers the two things most likely to silently rot: the
// day-boundary timezone (a Docker container is UTC even when the host is
// Asia/Jerusalem, which would shift the reported day by 2-3 hours and split an
// evening's runs across two digests) and the quiet-day rule (silence must mean
// "nothing happened", never "the job broke").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldEmailRunSummary } from '../packages/shared/src/runEmailEligibility';
import {
  previousLocalDayBounds,
  buildRunDigest,
  type DigestRunRow,
} from '../packages/shared/src/runDigest';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── shouldEmailRunSummary ────────────────────────────────────────────────────
// A run emails only when it is neither a rehearsal nor a self-guided demo.
// ABSENT fields must read as "normal run" the way every other consumer treats
// them, so runs written before this change keep emailing.
console.log('\n── shouldEmailRunSummary ──');

const realOwner = { hasEmail: true };
const anonOwner = { hasEmail: false };

check('a normal organizer run emails',
  shouldEmailRunSummary({ isTestDrive: false, selfGuided: false }, realOwner) === true);
check('a run with NO flags at all emails (legacy doc)',
  shouldEmailRunSummary({}, realOwner) === true);
check('a test-drive rehearsal does NOT email',
  shouldEmailRunSummary({ isTestDrive: true }, realOwner) === false);
check('a self-guided demo/instant-play run does NOT email',
  shouldEmailRunSummary({ selfGuided: true }, realOwner) === false);
check('both flags set does NOT email',
  shouldEmailRunSummary({ isTestDrive: true, selfGuided: true }, realOwner) === false);
// Guard against a truthiness bug: only an EXPLICIT true excludes. A stray
// non-boolean must not silently suppress a real organizer's email.
check('explicit false values email',
  shouldEmailRunSummary({ isTestDrive: false, selfGuided: false }, realOwner) === true);
check('undefined values email',
  shouldEmailRunSummary({ isTestDrive: undefined, selfGuided: undefined }, realOwner) === true);

// THE SIMULATION RULE. Sims (and e2e) create their creator with
// signInAnonymously, so the owner profile has no email. Keying on that — rather
// than on testDrive, which caps a run at 2 participants and would break an
// 8-team load sim — is what keeps a sim pointed at production from mailing.
check('an anonymous-owner run does NOT email even when otherwise normal',
  shouldEmailRunSummary({ isTestDrive: false, selfGuided: false }, anonOwner) === false);
check('an anonymous-owner run with no flags does NOT email',
  shouldEmailRunSummary({}, anonOwner) === false);
check('owner identifiability is required, not merely preferred',
  shouldEmailRunSummary({}, { hasEmail: false }) === false);

// ── previousLocalDayBounds ───────────────────────────────────────────────────
// The timer fires at 03:30, so "today" is 3.5h old and nearly empty — the digest
// must cover the PREVIOUS complete local day.
console.log('\n── previousLocalDayBounds ──');

const jer = 'Asia/Jerusalem';

// 2026-07-30 03:30 IDT == 2026-07-30T00:30Z. The day that just completed is the 29th.
const at0330 = previousLocalDayBounds(new Date('2026-07-30T00:30:00Z'), jer);
check('a 03:30 run reports the PREVIOUS local day',
  at0330.label === '2026-07-29', at0330.label);
check('the window starts at local midnight of that day',
  at0330.startIso === '2026-07-28T21:00:00.000Z', at0330.startIso);
check('the window ends at the next local midnight (exclusive)',
  at0330.endIso === '2026-07-29T21:00:00.000Z', at0330.endIso);
check('the window is exactly 24h on a non-DST day',
  new Date(at0330.endIso).getTime() - new Date(at0330.startIso).getTime() === 86_400_000);

// Month + year rollover: 2027-01-01 03:30 local ⇒ the 31st of December 2026.
const rollover = previousLocalDayBounds(new Date('2027-01-01T01:30:00Z'), jer);
check('rolls over a month AND a year boundary',
  rollover.label === '2026-12-31', rollover.label);

// THE REGRESSION THAT MATTERS: the same instant must yield a DIFFERENT window
// under UTC. If these ever match, the zone argument is being ignored and the
// container clock has taken over.
const utc = previousLocalDayBounds(new Date('2026-07-30T00:30:00Z'), 'UTC');
check('UTC and Asia/Jerusalem disagree for the same instant (zone is honored)',
  utc.startIso !== at0330.startIso, `${utc.startIso} vs ${at0330.startIso}`);
check('the UTC window reports the 29th at 00:00Z',
  utc.startIso === '2026-07-29T00:00:00.000Z', utc.startIso);

// DST: Israel leaves DST in late October. Crossing that boundary the local day
// is 25h long, so a naive "start minus 24h" would clip an hour of runs.
const dst = previousLocalDayBounds(new Date('2026-10-26T02:30:00Z'), jer);
check('a DST-transition day is not assumed to be 24h',
  new Date(dst.endIso).getTime() - new Date(dst.startIso).getTime() !== 86_400_000,
  `${(new Date(dst.endIso).getTime() - new Date(dst.startIso).getTime()) / 3_600_000}h`);

// ── buildRunDigest ───────────────────────────────────────────────────────────
console.log('\n── buildRunDigest ──');

const OPERATOR = 'operator-uid';
const row = (over: Partial<DigestRunRow>): DigestRunRow => ({
  runId: 'r1', ownerUid: OPERATOR, gameTitle: 'Old City Hunt',
  selfGuided: false, isTestDrive: false, teamCount: 4, playerNames: [], ...over,
});

const mixed = buildRunDigest([
  row({ runId: 'd1', selfGuided: true, teamCount: 1, playerNames: ['Yael'] }),
  row({ runId: 'd2', selfGuided: true, teamCount: 1, playerNames: ['Noam'] }),
  row({ runId: 'd3', selfGuided: true, teamCount: 1, playerNames: ['Dana'] }),
  row({ runId: 'real1', gameTitle: 'Sansana Night' }),
], OPERATOR);
check('a mixed day yields a digest', mixed !== null);
check('demo runs are counted', mixed?.demoCount === 3, String(mixed?.demoCount));
check('real runs are itemized', mixed?.realRuns.length === 1, String(mixed?.realRuns.length));
check('the real run carries its title',
  mixed?.realRuns[0]?.gameTitle === 'Sansana Night', mixed?.realRuns[0]?.gameTitle);
// "which user played the demo" — the demo player's display name must be reported.
// There is deliberately NO email field: participants are anonymous and no email
// registration field type exists, so an `email` key here could only ever be a lie.
check('each demo run names the player who played it',
  mixed?.demoRuns.some((d) => d.playerNames.includes('Yael')) === true);
check('no participant email field is emitted at all',
  !JSON.stringify(mixed).toLowerCase().includes('"email"'));

// Quiet day ⇒ send NOTHING. Silence means "nothing happened".
check('a completely quiet day yields null', buildRunDigest([], OPERATOR) === null);
check('a day of ONLY test-drive/sim runs is also quiet (they are excluded)',
  buildRunDigest([row({ isTestDrive: true })], OPERATOR) === null);

// Demo-only day still sends — the demo count is the thing being reported.
const demoOnly = buildRunDigest(
  [row({ selfGuided: true, teamCount: 1, playerNames: ['Solo'] })], OPERATOR);
check('a demo-only day still sends', demoOnly !== null);
check('a demo-only day has an empty real-run list',
  demoOnly?.realRuns.length === 0, String(demoOnly?.realRuns.length));

// Multi-tenant privacy: the collection-group query spans EVERY creator, but the
// recipient is the platform operator. Other creators' runs must collapse to a
// bare count — no titles, no uids.
console.log('\n── multi-tenant privacy ──');
const crossTenant = buildRunDigest([
  row({ runId: 'mine', gameTitle: 'My Event' }),
  row({ runId: 'theirs', ownerUid: 'someone-else', gameTitle: 'Their Private Event' }),
], OPERATOR);
check('only the operator\'s own runs are itemized',
  crossTenant?.realRuns.length === 1, String(crossTenant?.realRuns.length));
check('another creator\'s run is counted, not named',
  crossTenant?.otherOwnerRunCount === 1, String(crossTenant?.otherOwnerRunCount));
check('another creator\'s game title never appears in the payload',
  !JSON.stringify(crossTenant).includes('Their Private Event'));
check('another creator\'s uid never appears in the payload',
  !JSON.stringify(crossTenant).includes('someone-else'));

// The operator is an ALLOWLIST, because the platform's own demo games are owned by
// SEEDED accounts (demo-spy-academy etc.), not the operator's personal account. A
// single-uid rule counted demo runs but hid the player names — the exact opposite
// of what the digest is for.
const SEED = 'demo-spy-academy';
const viaList = buildRunDigest([
  row({ runId: 'demo', ownerUid: SEED, selfGuided: true, teamCount: 1, playerNames: ['Yael'] }),
  row({ runId: 'mine', gameTitle: 'My Event' }),
  row({ runId: 'theirs', ownerUid: 'someone-else', gameTitle: 'Their Private Event' }),
], [OPERATOR, SEED]);
check('a seeded demo owner on the allowlist IS itemized',
  viaList?.demoRuns.length === 1, String(viaList?.demoRuns.length));
check('the demo player name survives via the allowlist',
  viaList?.demoRuns[0]?.playerNames.includes('Yael') === true);
check('a third party is still NOT itemized when an allowlist is used',
  viaList?.otherOwnerRunCount === 1 && !JSON.stringify(viaList).includes('Their Private Event'));
// The env var arrives as a comma-separated string; parsing it is part of the contract.
const viaCsv = buildRunDigest(
  [row({ runId: 'demo', ownerUid: SEED, selfGuided: true, teamCount: 1, playerNames: ['Yael'] })],
  ` ${OPERATOR} , ${SEED} `);
check('a comma-separated operator string is parsed (and trimmed)',
  viaCsv?.demoRuns.length === 1, String(viaCsv?.demoRuns.length));
check('an empty operator config itemizes nothing but still counts',
  buildRunDigest([row({ runId: 'x' })], '')?.otherOwnerRunCount === 1);

// ── build wiring ─────────────────────────────────────────────────────────────
// The digest runs from a systemd timer as `node lib/digest-cron.js`. If
// build:cron does not emit that bundle, the timer fires nightly against a
// missing file — a failure that only shows up in journalctl, at 03:30.
console.log('\n── build wiring ──');
const fnPkg = readFileSync(join(process.cwd(), 'functions/package.json'), 'utf8');
check('build:cron emits the prune bundle', /prune-cron\.ts/.test(fnPkg));
check('build:cron emits the digest bundle', /digest-cron\.ts/.test(fnPkg));

console.log(`\n${failures === 0 ? 'ALL RUN-EMAIL-SCOPE TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
