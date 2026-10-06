// A HOLD stops every clock a person can SEE (Ahiya, 2026-10-06: "השעון לא עוצר כשאני עוצר קבוצה...
// זה פשוט מוסיף לי זמן כשאני ממשיך את הקבוצה, וזה לא נראה טוב בכלל").
//
// The server already excluded the hold from the STANDINGS (heldMs) and moved a mission's start
// forward on resume, so the totals were fair. But every clock on a screen counted "now − start":
// the mission countdown on the phone kept running down while held and jumped back UP on resume, the
// race clock on a time-only phone never subtracted the hold at all, and the console's "on this
// mission for N minutes" kept climbing and then fell back. One pure rule: while a team is held, its
// clock's NOW is the instant it was held.
//   npx tsx scripts/test-hold-stops-clocks.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { teamClockNowMs, raceElapsedMs } from '../packages/shared/src/pausedClock';

let failures = 0;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };

const T0 = Date.parse('2026-10-06T08:00:00.000Z');
const heldAt = new Date(T0 + 5 * 60_000).toISOString();

ok('a running team: the clock is now', teamClockNowMs({ held: false }, T0 + 1000) === T0 + 1000);
ok('a held team: the clock stands at the hold', teamClockNowMs({ held: true, heldAt }, T0 + 9 * 60_000) === T0 + 5 * 60_000);
ok('a hold stamped in the future never runs the clock forward', teamClockNowMs({ held: true, heldAt }, T0 + 60_000) === T0 + 60_000);
ok('held with an unreadable stamp: fail open to now (never freeze on garbage)', teamClockNowMs({ held: true, heldAt: 'soon' }, T0) === T0);
ok('a stray heldAt on a running team is ignored', teamClockNowMs({ held: false, heldAt }, T0 + 9 * 60_000) === T0 + 9 * 60_000);
ok('total on junk input', teamClockNowMs(undefined as never, T0) === T0 && teamClockNowMs(null as never, T0) === T0);

const startedAt = new Date(T0).toISOString();
ok('race clock: plain elapsed', raceElapsedMs({ startedAt }, T0 + 120_000) === 120_000);
ok('race clock: earlier holds are subtracted', raceElapsedMs({ startedAt, heldMs: 30_000 }, T0 + 120_000) === 90_000);
ok('race clock: frozen while held', raceElapsedMs({ startedAt, held: true, heldAt, heldMs: 0 }, T0 + 20 * 60_000) === 5 * 60_000);
ok('race clock: never negative', raceElapsedMs({ startedAt, heldMs: 999_999_999 }, T0 + 1000) === 0);
ok('race clock: no start ⇒ 0', raceElapsedMs({}, T0) === 0);

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const runs = read('functions/src/runs/index.ts');
const fn = runs.slice(runs.indexOf('function activeTaskTimeLeftMs('), runs.indexOf('function activeTaskTimeLeftMs(') + 600);
ok('server: the countdown is computed at the team clock, not at now', /teamClockNowMs\(team, nowMs\)/.test(fn));
const runner = read('apps/play-web/src/components/TaskRunner.tsx');
ok('phone: the mission countdown is told the team is held', /<TimeLimitCountdown[^>]*paused=\{/.test(runner.replace(/\n\s*/g, ' ')));
ok('phone: a paused countdown does not tick', /function TimeLimitCountdown\([\s\S]{0,1600}paused/.test(runner));
const play = read('apps/play-web/src/screens/PlayScreen.tsx');
ok('phone: the race clock subtracts holds and freezes while held', /function ElapsedClock[\s\S]{0,700}raceElapsedMs\(/.test(play));
const dossier = read('apps/creator-web/src/lib/teamDossier.ts');
ok('console: "on this mission for N minutes" stops while held', /teamClockNowMs\(/.test(dossier));

console.log(failures === 0 ? '\n✅ hold stops clocks: ALL PASS' : `\n❌ hold stops clocks: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
