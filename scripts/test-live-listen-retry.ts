// A listener the player depends on must come back after an error (issue 27, 2026-10-06).
//
// "I don't see the flash mission on my phone": LiveOps subscribed to announcements and flash
// missions with `() => undefined` as the error handler. Firestore drops a listener on its first
// error and the effect never re-subscribed mid-run, so one blip silenced both for the rest of the
// race. apps/play-web/src/lib/liveListen.ts is the one retry rule; this pins it and that the
// player's live-ops listeners go through it.
import { readFileSync } from 'node:fs';
import {
  nextListenRetryMs, listenWithRetry, LISTEN_RETRY_FIRST_MS, LISTEN_RETRY_MAX_MS, type ListenHandle,
} from '../apps/play-web/src/lib/liveListen';

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`, detail ?? '');
}

console.log('— the delay —');
check('first retry waits the first step', nextListenRetryMs(null) === LISTEN_RETRY_FIRST_MS);
check('it doubles', nextListenRetryMs(2_000) === 4_000 && nextListenRetryMs(8_000) === 16_000);
check('it is capped', nextListenRetryMs(16_000) === LISTEN_RETRY_MAX_MS && nextListenRetryMs(LISTEN_RETRY_MAX_MS) === LISTEN_RETRY_MAX_MS);
check('junk restarts at the first step', [NaN, -5, Infinity, undefined, 0].every((v) => nextListenRetryMs(v as number) === LISTEN_RETRY_FIRST_MS));

console.log('— the loop —');
const origWarn = console.warn;
console.warn = () => undefined; // the helper SAYS each failure; keep the test output readable
{
  const pending: { fn: () => void; ms: number }[] = [];
  const timers = { set: (fn: () => void, ms: number) => { pending.push({ fn, ms }); return pending.length; }, clear: () => undefined };
  let live = 0, starts = 0, maxLive = 0;
  let handle: ListenHandle | null = null;
  const stop = listenWithRetry('test', (h) => {
    starts++; live++; maxLive = Math.max(maxLive, live); handle = h;
    return () => { live--; };
  }, timers);
  check('subscribes at once', starts === 1 && live === 1);
  handle!.failed({ code: 'unavailable' });
  check('a failure releases the dead listener', live === 0);
  check('and schedules a retry at the first step', pending.length === 1 && pending[0].ms === LISTEN_RETRY_FIRST_MS);
  handle!.failed({ code: 'unavailable' });
  check('a second error from the same dead listener schedules nothing more', pending.length === 1);
  pending.shift()!.fn();
  check('the retry subscribes again', starts === 2 && live === 1);
  handle!.failed(new Error('x'));
  check('the next failure waits longer', pending[0].ms === LISTEN_RETRY_FIRST_MS * 2);
  pending.shift()!.fn();
  handle!.healthy();
  handle!.failed({ code: 'permission-denied' });
  check('a healthy snapshot resets the delay', pending[0].ms === LISTEN_RETRY_FIRST_MS);
  check('never two listeners at once', maxLive === 1);
  stop();
  pending.shift()!.fn();
  check('after cleanup a pending retry does not subscribe', starts === 3 && live === 0);
}
{
  const pending: { fn: () => void; ms: number }[] = [];
  const timers = { set: (fn: () => void, ms: number) => { pending.push({ fn, ms }); return 1; }, clear: () => undefined };
  listenWithRetry('throws', () => { throw new Error('boom'); }, timers);
  check('a subscribe that throws is retried, not lost', pending.length === 1);
}
console.warn = origWarn;

console.log('— the player listeners use it —');
const liveOps = readFileSync('apps/play-web/src/components/LiveOps.tsx', 'utf8');
check('LiveOps listens through listenWithRetry (announcements + flash missions)', (liveOps.match(/listenWithRetry\(/g) ?? []).length >= 2);
check('LiveOps has no silent onSnapshot error handler left', !/onSnapshot\([\s\S]{0,400}?\(\) => undefined\)/.test(liveOps));
const flash = readFileSync('apps/play-web/src/components/FlashRunner.tsx', 'utf8');
check('FlashRunner (the flash a team is on) listens through listenWithRetry', /listenWithRetry\(/.test(flash));
const play = readFileSync('apps/play-web/src/screens/PlayScreen.tsx', 'utf8');
check('the team-document trigger on the play screen has no silent error handler', !/onSnapshot\(ref, \(\) => \{ void refresh\(\); \}, \(\) => undefined\)/.test(play));

console.log('');
if (failures > 0) { console.error(`✗ live-listen-retry: ${failures} failed\n`); process.exit(1); }
console.log('✓ live-listen-retry: all passed\n');
