// A flash mission the team is ON is said once (found playing at 375px, 2026-10-04).
//
// While a team was on a flash mission, the screen showed its title and points twice: in the
// live strip at the top ("you are on this mission now") and in the mission card right below.
// The strip's only extra was the countdown. So the card carries the countdown and the strip
// skips the flash the team is already running. Source assertions: no component runner.
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (name: string, ok: boolean) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`); }
};

console.log('\nflash mission said once');
const live = readFileSync('apps/play-web/src/components/LiveOps.tsx', 'utf8');
const runner = readFileSync('apps/play-web/src/components/FlashRunner.tsx', 'utf8');
check('the live strip skips the flash this team is on', /liveFlashes[\s\S]{0,200}\.filter\(\(f\) => f\.id !== teamFlashId\)/.test(live));
check('the flash card shows its own countdown', /data-testid="flash-runner-countdown"/.test(runner) && /expiresAt/.test(runner));

console.log(failures === 0 ? '\n✅ flash said once: ALL PASS' : `\n❌ flash said once: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
