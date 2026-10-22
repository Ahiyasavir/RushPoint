// The server judges a mission's time limit from the team's ARRIVAL when the mission is sealed until
// arrival (change: composer-v2-phase0). The rule itself is pure and tested in
// test-task-time-limit.ts; this file pins that every server path that reads the clock goes through
// it, and that every pause moves the arrival stamp along with the start stamp. A source scan,
// because these paths live inside callables the emulator lane exercises end to end.
//   npx tsx scripts/test-time-limit-from-arrival.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function ok(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const runs = read('functions/src/runs/index.ts');
const root = read('functions/src/index.ts');

function body(src: string, signature: string, span = 1800): string {
  const at = src.indexOf(signature);
  return at < 0 ? '' : src.slice(at, at + span);
}

const sweep = body(runs, 'function sweepExpiredInFlight(', 2400);
const left = body(runs, 'function activeTaskTimeLeftMs(', 900);
const guard = body(runs, 'export function assertWithinTimeLimit(', 700);
const holdResume = runs.slice(runs.indexOf('resumedStartedAt(r.startedAt, team.heldAt'), runs.indexOf('resumedStartedAt(r.startedAt, team.heldAt') + 500);
const flashReturn = body(root, 'function resumeFromFlash(', 900);

ok('the sweep judges the clock from timeLimitClockStart', /isTimeLimitUp\([^;]*timeLimitClockStart\(/.test(sweep));
ok('the phone countdown is computed from timeLimitClockStart', /timeLimitRemainingMs\([^;]*timeLimitClockStart\(/.test(left));
ok('the submission guard judges from timeLimitClockStart', /isTimeLimitUp\([^;]*timeLimitClockStart\(/.test(guard));
ok('no server path judges the limit from startedAt directly',
  !/isTimeLimitUp\([^,]+,\s*(assignedRec|rec)\.startedAt/.test(runs) && !/timeLimitRemainingMs\([^,]+,\s*rec\.startedAt/.test(runs));
ok('a hold resume moves arrivedAt too', /arrivedAt/.test(holdResume));
ok('a flash return moves arrivedAt too', /arrivedAt/.test(flashReturn));

console.log(failures === 0 ? '\n✅ time limit from arrival: ALL PASS' : `\n❌ time limit from arrival: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
