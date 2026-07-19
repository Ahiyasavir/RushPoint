// Regression lock for the emulator-build gate (browser-02 P0 #1). A production
// `--mode playtest` build MUST wire the local emulator — keyed on MODE, not just
// DEV — or the always-on tunnel bundle hits real Firebase (anonymous auth
// disabled) and no phone can join. This locks the gate expression so a future
// edit can't quietly drop the playtest branch. No emulator.
//   npx tsx scripts/test-emulator-build-gate.ts
import { isEmulatorBuild } from '../packages/shared/src/env';

let failures = 0;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

// The critical case: a PRODUCTION playtest build (DEV === false, MODE playtest).
check('playtest build wires the emulator (DEV false, MODE playtest)', isEmulatorBuild({ DEV: false, MODE: 'playtest' }) === true);
// vite dev.
check('vite dev wires the emulator', isEmulatorBuild({ DEV: true, MODE: 'development' }) === true);
// A normal production build must NOT wire the emulator.
check('production build does NOT wire the emulator', isEmulatorBuild({ DEV: false, MODE: 'production' }) === false);

console.log(`\n${failures === 0 ? 'ALL EMULATOR-BUILD-GATE TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
