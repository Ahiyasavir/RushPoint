// Every public standings surface names the board's STATE the same way (found 2026-10-06): the
// public board said "final results" for a finished run while the TV view, on the big screen in the
// room at the end of the event, still said "live standings". One pure choice, used by both.
//   npx tsx scripts/test-board-state-title.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardStateKey } from '../apps/play-web/src/lib/boardState';

let failures = 0;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };

ok('a finished run is final', boardStateKey({ runStatus: 'finished', frozen: false }) === 'finalResults');
ok('finished wins over frozen', boardStateKey({ runStatus: 'finished', frozen: true }) === 'finalResults');
ok('a frozen live run is frozen', boardStateKey({ runStatus: 'active', frozen: true }) === 'frozen');
ok('otherwise live', boardStateKey({ runStatus: 'active', frozen: false }) === 'live');
ok('missing data reads as live, never throws', boardStateKey(undefined) === 'live' && boardStateKey({}) === 'live');

const src = (f: string) => readFileSync(join(process.cwd(), 'apps/play-web/src/screens', f), 'utf8');
ok('the public board titles itself through boardStateKey', /boardStateKey\(/.test(src('PublicLeaderboardScreen.tsx')));
ok('the TV titles itself through boardStateKey', /boardStateKey\(/.test(src('TvLeaderboard.tsx')));
ok('the TV no longer hardcodes "live standings" as its title', !/\{t\.tv\.liveStandings\}/.test(src('TvLeaderboard.tsx')));

console.log(failures === 0 ? '\n✅ board state title: ALL PASS' : `\n❌ board state title: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
