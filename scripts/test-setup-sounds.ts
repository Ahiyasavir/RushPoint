// The setup walk's sounds (change: setup-flow-full-screen): the rules from apps/creator-web/src/lib/setupSounds.ts.
// Frequent sounds are the quietest and shortest, rare ones carry the richness, and "off" plays nothing.
import { SOUND_BANK, playSetupSound, soundEnabled, type SetupSound } from '../apps/creator-web/src/lib/setupSounds';

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); }
};

const kinds: SetupSound[] = ['tap', 'check', 'step', 'stage', 'finish', 'swap'];
check('every sound the walk plays is defined', kinds.every((k) => (SOUND_BANK[k]?.length ?? 0) > 0));

const loudest = (k: SetupSound) => Math.max(...SOUND_BANK[k].map(([, p]) => Number(p[0] ?? 1)));
const span = (k: SetupSound) => Math.max(...SOUND_BANK[k].map(([d, p]) => d + 1000 * (Number(p[3] ?? 0) + Number(p[4] ?? 0) + Number(p[5] ?? 0.1))));
check('the press sound is the quietest', kinds.every((k) => loudest('tap') <= loudest(k)), kinds.map((k) => [k, loudest(k)]));
check('the press sound is under 60 ms', span('tap') < 60, span('tap'));
check('the step sound is under 300 ms', span('step') < 300, span('step'));
check('the finish is the longest moment', kinds.every((k) => span('finish') >= span(k)), kinds.map((k) => [k, span(k)]));
check('no sound is loud (volume at most 0.5)', kinds.every((k) => loudest(k) <= 0.5));

// Node has no localStorage and no window: the toggle defaults to on, and playing never throws.
check('sound defaults to on when storage is unavailable', soundEnabled() === true);
let threw = false;
try { playSetupSound('finish', true); playSetupSound('tap', false); } catch { threw = true; }
check('playing never throws, even with no audio at all', !threw);

console.log(`\n${failures === 0 ? 'ALL SETUP SOUND TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
