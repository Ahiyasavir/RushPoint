// The rules of the reward sounds (apps/*/src/lib/rewardSound.ts). A test cannot say a sound is nice; it can
// hold the decisions that make it so: one key, no success falls, the frequent sound stays small, and the
// two apps cannot drift.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REWARD_SCORES, STREAK_WINDOW_MS, nextStreak, streakRatio, type RewardSound,
} from '../apps/creator-web/src/lib/rewardSound';

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); }
};

const ROOT = join(import.meta.dirname, '..');
const read = (app: string) => readFileSync(join(ROOT, 'apps', app, 'src/lib/rewardSound.ts'), 'utf8').replace(/\r\n/g, '\n');
check('both apps carry the identical engine', read('creator-web') === read('play-web'));

const kinds = Object.keys(REWARD_SCORES) as RewardSound[];
const pitched = (k: RewardSound) => REWARD_SCORES[k].filter((x) => x.voice !== 'tick' && x.voice !== 'thump');
const span = (k: RewardSound) => Math.max(...REWARD_SCORES[k].map((x) => x.at + x.len));
const peak = (k: RewardSound) => Math.max(...REWARD_SCORES[k].map((x) => x.gain));

// C major pentatonic in any octave: C D E G A. The swap is left out: its dice knocks are too short to
// read as pitches.
const PENT = new Set([0, 2, 4, 7, 9]);
const pc = (hz: number) => ((Math.round(12 * Math.log2(hz / 261.63)) % 12) + 12) % 12;
const offKey = kinds.flatMap((k) => (k === 'swap' ? [] : pitched(k)).filter((x) => !PENT.has(pc(x.hz))).map((x) => [k, x.hz]));
check('every pitched note is on the pentatonic, so any overlap agrees', offKey.length === 0, offKey);

const last = (k: RewardSound) => { const p = pitched(k); const t = Math.max(...p.map((x) => x.at)); return Math.max(...p.filter((x) => x.at === t).map((x) => x.hz)); };
check('no sound ends below where it started', kinds.every((k) => last(k) >= pitched(k)[0].hz), kinds.map((k) => [k, pitched(k)[0].hz, last(k)]));
check('the press is the shortest and the quietest', kinds.every((k) => span('tap') <= span(k) && peak('tap') <= peak(k)));
check('the press is under 70 ms', span('tap') < 70, span('tap'));
check('the step is under 300 ms', span('step') < 300, span('step'));
check('finish is the longest moment', kinds.every((k) => span('finish') >= span(k)));
check('no single note is loud', kinds.every((k) => peak(k) <= 0.3));
check('every success has a body, not only a click', kinds.every((k) => pitched(k).length > 0));

check('the first success starts at the root', nextStreak(0, null, 1000, 20_000) === 0);
check('a success inside the window climbs', nextStreak(1, 1000, 2000, 20_000) === 2);
check('a success after the window starts over', nextStreak(4, 1000, 30_000, 20_000) === 0);
check('the climb stops at the octave', nextStreak(99, 1000, 2000, 20_000) === 5 && streakRatio(5) === 2);
check('a clock that went backwards starts over', nextStreak(3, 5000, 1000, 20_000) === 0);
check('junk never throws and never climbs', nextStreak(NaN, NaN, NaN, 1) === 0 && streakRatio(NaN) === 1);
check('only the repeated successes climb', Object.keys(STREAK_WINDOW_MS).sort().join() === 'check,task');

console.log(`\n${failures === 0 ? 'ALL REWARD SOUND TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
