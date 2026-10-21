// Run history must not say "playing now" about a run from last month (found 2026-10-04).
//
// Every run that was never ended read "משחקים עכשיו", including runs launched in August: the
// status is still `live` because nobody pressed "end the run", not because anyone is playing.
// Within a day of launch it is still "playing now"; after that it is "still open".
import { isPlayingNow, runHistoryBadge } from '../apps/creator-web/src/lib/runHistoryBadge';

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} :: ${JSON.stringify(detail)}`); }
};
const NOW = Date.parse('2026-10-04T02:00:00Z');
const h = 3600_000;
console.log('\nrun history badge');
check('a live run launched 2 hours ago is playing now', runHistoryBadge({ status: 'live', launchedAt: new Date(NOW - 2 * h).toISOString() }, NOW) === 'live');
check('a live run launched 23 hours ago is still playing now', runHistoryBadge({ status: 'live', launchedAt: new Date(NOW - 23 * h).toISOString() }, NOW) === 'live');
check('a live run from August is still open, not playing', runHistoryBadge({ status: 'live', launchedAt: '2026-08-18T10:00:00Z' }, NOW) === 'open');
check('a live run with no launch time falls back to createdAt', runHistoryBadge({ status: 'live', createdAt: '2026-08-18T10:00:00Z' }, NOW) === 'open');
check('a live run with no date at all says playing (fails toward the old label)', runHistoryBadge({ status: 'live' }, NOW) === 'live');
check('finished', runHistoryBadge({ status: 'finished', launchedAt: '2026-08-18T10:00:00Z' }, NOW) === 'finished');
check('draft', runHistoryBadge({ status: 'draft' }, NOW) === 'draft');
check('junk is nothing', runHistoryBadge(null as never, NOW) === null);
// change: active-run-bar-recent. The floating bar reads the same predicate.
check('isPlayingNow: launched 2 hours ago', isPlayingNow({ status: 'live', launchedAt: new Date(NOW - 2 * h).toISOString() }, NOW) === true);
check('isPlayingNow: launched in August is not', isPlayingNow({ status: 'live', launchedAt: '2026-08-18T10:00:00Z' }, NOW) === false);
check('isPlayingNow: no date counts as playing', isPlayingNow({ status: 'live' }, NOW) === true);
check('isPlayingNow: a finished run is not playing', isPlayingNow({ status: 'finished', launchedAt: new Date(NOW).toISOString() }, NOW) === false);
check('isPlayingNow: the bar summaries carry no status, and are live by definition',
  isPlayingNow({ launchedAt: new Date(NOW - h).toISOString() }, NOW) === true);

// Race to Zion 14.10 (D07): the real run was launched on 12.10 and PLAYED on 14.10. The 24 hour
// window counted from launch hid it while 31 teams were on it. Activity counts, not only launch:
// the server refreshes `updatedAt` on the run during play (every leaderboard refresh writes it).
check('D07: a run launched two days ago and played an hour ago is playing now',
  isPlayingNow({ status: 'live', launchedAt: new Date(NOW - 48 * h).toISOString(), updatedAt: new Date(NOW - h).toISOString() }, NOW) === true);
check('D07: the history badge says the same', runHistoryBadge({ status: 'live', launchedAt: new Date(NOW - 48 * h).toISOString(), updatedAt: new Date(NOW - h).toISOString() }, NOW) === 'live');
check('D07: launched two days ago and untouched since is still only open',
  isPlayingNow({ status: 'live', launchedAt: new Date(NOW - 48 * h).toISOString(), updatedAt: new Date(NOW - 47 * h).toISOString() }, NOW) === false);
check('D07: a junk updatedAt never hides a run that the launch time still calls playing',
  isPlayingNow({ status: 'live', launchedAt: new Date(NOW - h).toISOString(), updatedAt: 'garbage' }, NOW) === true);

console.log(failures === 0 ? '\n✅ run history badge: ALL PASS' : `\n❌ run history badge: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
