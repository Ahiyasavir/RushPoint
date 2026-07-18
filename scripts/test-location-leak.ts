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

console.log(`\n${failures === 0 ? 'ALL LOCATION-LEAK TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
