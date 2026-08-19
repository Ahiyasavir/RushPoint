// Pure-logic guard for the shared stale-helper pattern list (change:
// emulator-exec-port-race). STALE_HELPER_PATTERNS used to be a private const
// duplicated inline in free-ports.mjs; it is now the single source of truth
// shared by free-ports.mjs (sweeps the whole dev-port list) and
// emulator-exec.mjs's own pre-boot fallback (sweeps just the current boot's
// ports). This guards the handful of markers both callers actually depend on,
// so the dedup can't silently drop one.
//   npx tsx scripts/test-stale-helper-patterns.ts
import { STALE_HELPER_PATTERNS } from './lib/staleHelperSweep.mjs';

let failures = 0;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

const has = (needle: string) => STALE_HELPER_PATTERNS.includes(needle);

check('list is non-empty', STALE_HELPER_PATTERNS.length > 0);
check('list is frozen (readonly)', Object.isFrozen(STALE_HELPER_PATTERNS));
check('matches the emulator-exec wrapper itself', has('scripts/emulator-exec.mjs') && has('scripts\\emulator-exec.mjs'));
check('matches leaked functions-emulator workers', has('functionsEmulatorRuntime'));
check('matches a stale firebase-tools exec parent', has('emulators:exec'));
check('matches emulator JVMs (both slash styles)', has('.cache/firebase/emulators') && has('.cache\\firebase\\emulators'));
check('matches the emulator backup export loop', has('scripts/emulator-backup.mjs') && has('scripts\\emulator-backup.mjs'));
check('matches the playtest tunnel', has('cloudflared tunnel'));

console.log(`\n${failures === 0 ? 'ALL STALE-HELPER-PATTERN TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
