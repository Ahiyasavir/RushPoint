// The setup walk's sounds (change: setup-flow-full-screen): the rules from apps/creator-web/src/lib/setupSounds.ts.
// The sounds' own rules are in test-reward-sound.ts; here, that the walk's kinds exist and "off" plays nothing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { playSetupSound, soundEnabled, type SetupSound } from '../apps/creator-web/src/lib/setupSounds';
import { REWARD_SCORES } from '../apps/creator-web/src/lib/rewardSound';

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); }
};

const kinds: SetupSound[] = ['tap', 'check', 'step', 'stage', 'finish', 'swap'];
check('every sound the walk plays is defined', kinds.every((k) => (REWARD_SCORES[k]?.length ?? 0) > 0));

// Node has no localStorage and no window: the toggle defaults to on, and playing never throws.
check('sound defaults to on when storage is unavailable', soundEnabled() === true);
let threw = false;
try { playSetupSound('finish', true); playSetupSound('tap', false); } catch { threw = true; }
check('playing never throws, even with no audio at all', !threw);

// No delay between the press and the sound (Ahiya, 30.10). A test cannot hear it; it can hold what caused it.
const src = (f: string) => readFileSync(join(import.meta.dirname, '../apps/creator-web/src', f), 'utf8').replace(/\r\n/g, '\n');
const walk = src('components/SetupFlow.tsx');
const unlock = src('lib/sound.ts');
check('audio opens on the first press anywhere', src('main.tsx').includes('armAudio()'));
check('a touch unlocks: pointerup and touchend are armed too', ['pointerdown', 'pointerup', 'touchend', 'keydown'].every((e) => unlock.includes(`'${e}'`)));
check('the walk buttons sound on the press', (walk.match(/onPointerDown=/g) ?? []).length >= 2);
check('the dice sounds with its roll, not when it lands', /play\('swap'\);\n\s*const \{ stageId, taskId \} = current\.screen/.test(walk));
check('a stopped clock never stacks sounds', src('lib/setupSounds.ts').includes("ctx.state === 'running'"));

console.log(`\n${failures === 0 ? 'ALL SETUP SOUND TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
