// Issue 55 (QA 7.10) was NOT a bug: a mission that needs every phone asks for
// min(required, phones attached), so a one-phone team is never blocked, and "1 of 2" appears only
// when a second phone IS attached and has not done its part. What the QA run did surface was the
// stop counter's wording: "עצור" reads as "Stop!" (a command) where it means a stop on the route.
//   npx tsx scripts/test-every-phone-rule.ts
import { readFileSync } from 'node:fs';
import { effectiveContributorRequirement, contributionView } from '../packages/shared/src/teamParticipation';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
check('one phone attached, mission wants 2 → needs 1 (never blocked)', effectiveContributorRequirement(2, 1) === 1);
check('one phone: no "1 of 2" box at all', contributionView({ need: effectiveContributorRequirement(2, 1), contributors: [], myUid: 'a', isSender: true }).show === false);
check('two phones attached → needs 2', effectiveContributorRequirement(2, 2) === 2);
const i18n = readFileSync(new URL('../apps/play-web/src/i18n.ts', import.meta.url), 'utf8');
check('the stop counter does not say "עצור"', !/stopOf: [^\n]*`עצור /.test(i18n));

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}  (test-every-phone-rule)`);
process.exit(failures === 0 ? 0 : 1);
