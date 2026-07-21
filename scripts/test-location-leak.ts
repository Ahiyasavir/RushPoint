// Pure-logic test for locationLeakWarnings (change: hidden-location-leak-guard).
// When a task hides its location, its title/description still ship to players, so
// naming the place there defeats the clue mechanic. The helper flags which fields
// likely leak — advisory only. No emulator.
//   npx tsx scripts/test-location-leak.ts
import { locationLeakWarnings } from '../packages/shared/src/locationLeak';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const eq = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const w = (task: any) => locationLeakWarnings(task);

check('not hidden ⇒ []', eq(w({ title: 'Meet at Jaffa Gate' }), []));
check('hideLocation false ⇒ []', eq(w({ hideLocation: false, title: 'the fountain' }), []));
check('EN token in title', eq(w({ hideLocation: true, title: 'Meet at the Old City fountain' }), ['title']), JSON.stringify(w({ hideLocation: true, title: 'Meet at the Old City fountain' })));
check('HE token in description', eq(w({ hideLocation: true, title: 'משימה', description: 'ברחוב יפו' }), ['description']));
check('both fields', eq(w({ hideLocation: true, title: 'the market', description: 'near the gate' }), ['title', 'description']));
check('neutral ⇒ []', eq(w({ hideLocation: true, title: 'Find the secret spot', description: 'מצאו את המקום הסודי' }), []));
check('clue exempt', eq(w({ hideLocation: true, title: 'Find it', locationClue: 'at the fountain' }), []));
check('word-boundary: apartment ≠ art', eq(w({ hideLocation: true, title: 'Enter the apartment' }), []));

// --- language symmetry: each language must be detected in EITHER field ---
check('HE token in title', eq(w({ hideLocation: true, title: 'המשימה בכיכר ציון' }), ['title']));
check('EN token in description only', eq(w({ hideLocation: true, title: 'משימה', description: 'Wait by the fountain' }), ['description']));
check('HE token in both fields', eq(w({ hideLocation: true, title: 'רחוב יפו', description: 'ליד המזרקה' }), ['title', 'description']));
check('mixed languages, one field each', eq(w({ hideLocation: true, title: 'The old market', description: 'מול השער' }), ['title', 'description']));

// --- falsy short-circuit is total: no language, no field, ever warns when visible ---
check('not hidden + HE place ⇒ []', eq(w({ title: 'כיכר ציון', description: 'ליד המזרקה' }), []));
check('hideLocation undefined explicitly ⇒ []', eq(w({ hideLocation: undefined, title: 'at the gate', description: 'ברחוב' }), []));

// --- shape / low-false-positive guards ---
check('missing fields ⇒ []', eq(w({ hideLocation: true }), []));
check('blank + whitespace fields ⇒ []', eq(w({ hideLocation: true, title: '   ', description: '' }), []));
check('EN match is case insensitive', eq(w({ hideLocation: true, title: 'MEET AT THE FOUNTAIN' }), ['title']));
check('multi-word EN token (in front of)', eq(w({ hideLocation: true, title: 'Stand in front of it' }), ['title']));
check('HE clue fields exempt too', eq(w({ hideLocation: true, title: 'מצאו את המקום', locationClue: 'ליד המזרקה', locationClueHe: 'בכיכר' }), []));
check('order is always title then description', eq(w({ hideLocation: true, description: 'near the gate', title: 'the tower' }), ['title', 'description']));
check('neutral HE instruction ⇒ []', eq(w({ hideLocation: true, title: 'פענחו את החידה', description: 'צלמו את מה שמצאתם' }), []));

console.log(`\n${failures === 0 ? 'ALL LOCATION-LEAK TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
