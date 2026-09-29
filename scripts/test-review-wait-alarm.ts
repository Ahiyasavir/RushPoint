// Pure-logic tests for the review-wait alarm (change: review-wait-alarm).
//
// Field report 2026-09-27: "I really want it to alert strongly if I don't approve a photo for
// more than 20 seconds." A team whose mission waits for a human stands still until someone
// approves. Kitchen displays solve this queue with ageing tickets that change colour at fixed
// thresholds; this is that verdict, clock injected, total.
import { reviewWaitAlarm, reviewRowTone, REVIEW_ALARM_MS } from '../packages/shared/src/reviewQueueCue';

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}\n      got  ${a}\n      want ${e}`);
}

const NOW = Date.parse('2026-09-28T10:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const row = (key: string, waitedMs: number) => ({ teamId: key, taskId: 't', submittedAt: ago(waitedMs) });

console.log('\n— the threshold is 20 seconds —');
eq('the constant', REVIEW_ALARM_MS, 20_000);
eq('19.9 s: no alarm', reviewWaitAlarm([row('a', 19_900)], NOW).level, 'none');
eq('20 s: alarm', reviewWaitAlarm([row('a', 20_000)], NOW).level, 'alarm');
eq('empty queue: none', reviewWaitAlarm([], NOW), { level: 'none', oldest: null, overCount: 0, playSound: false });

console.log('\n— the oldest is named, and every one over the line is counted —');
{
  const v = reviewWaitAlarm([row('a', 25_000), row('b', 70_000), row('c', 5_000)], NOW);
  eq('oldest is b', v.oldest, { key: 'b:t', waitedMs: 70_000 });
  eq('two are over 20 s', v.overCount, 2);
  eq('the alarm sounds', v.playSound, true);
}

console.log('\n— mute silences the SOUND, never the alarm —');
{
  const v = reviewWaitAlarm([row('a', 30_000)], NOW, { mutedUntilMs: NOW + 60_000 });
  eq('still an alarm', v.level, 'alarm');
  eq('no sound while muted', v.playSound, false);
  eq('mute expired ⇒ sound again', reviewWaitAlarm([row('a', 30_000)], NOW, { mutedUntilMs: NOW - 1 }).playSound, true);
}

console.log('\n— bad data never raises an alarm (fail quiet, like the wait label) —');
eq('unparseable time', reviewWaitAlarm([{ teamId: 'a', taskId: 't', submittedAt: 'soon' }], NOW).level, 'none');
eq('missing time', reviewWaitAlarm([{ teamId: 'a', taskId: 't', submittedAt: '' }], NOW).level, 'none');
eq('a time in the future', reviewWaitAlarm([row('a', -60_000)], NOW).level, 'none');
eq('junk list', reviewWaitAlarm(null as never, NOW).level, 'none');

console.log('\n— row tone: fresh / amber from 20 s / red from 60 s —');
eq('0 s fresh', reviewRowTone(0), 'fresh');
eq('19.9 s fresh', reviewRowTone(19_900), 'fresh');
eq('20 s amber', reviewRowTone(20_000), 'amber');
eq('59.9 s amber', reviewRowTone(59_900), 'amber');
eq('60 s red', reviewRowTone(60_000), 'red');
eq('unknown ⇒ fresh', reviewRowTone(Number.NaN), 'fresh');

console.log('');
if (failures > 0) {
  console.error(`✗ review-wait-alarm: ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('✓ review-wait-alarm: all assertions passed\n');
