// A staff code is the run's join code with two characters planted at random places inside it
// (change: staff-code-from-join-code). The staff app then needs only a name and the code: the
// server finds the run by removing two characters and looking the result up as a join code.
//   npx tsx scripts/test-staff-code.ts
import {
  makeStaffCode, normalizeStaffCode, candidateJoinCodes,
  STAFF_CODE_ALPHABET, STAFF_CODE_PLANTED,
} from '../packages/shared/src/staffCode';

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || detail === undefined ? '' : `  → ${JSON.stringify(detail)}`}`);
  if (!cond) failures++;
}

/** A deterministic `pick(n)` → 0..n-1, standing in for crypto.randomInt. */
function seeded(seed: number): (n: number) => number {
  let s = seed >>> 0;
  return (n) => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return s % n; };
}
const isSubsequence = (small: string, big: string): boolean => {
  let i = 0;
  for (const ch of big) if (ch === small[i]) i++;
  return i === small.length;
};

const JOIN = '63MZWC';

// ── shape ────────────────────────────────────────────────────────────────────
check('two characters are planted', STAFF_CODE_PLANTED === 2);
check('the alphabet is the join-code alphabet (no confusable 0/O/1/I)',
  STAFF_CODE_ALPHABET === 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
let shapeOk = true; let subseqOk = true; let alphaOk = true;
for (let seed = 1; seed <= 2000; seed++) {
  const code = makeStaffCode(JOIN, seeded(seed));
  if (code.length !== JOIN.length + 2) shapeOk = false;
  if (!isSubsequence(JOIN, code)) subseqOk = false;
  if (![...code].every((c) => STAFF_CODE_ALPHABET.includes(c))) alphaOk = false;
}
check('a staff code is 8 characters', shapeOk);
check('the join code survives inside it, in order', subseqOk);
check('every character comes from the alphabet', alphaOk);
check('the planted characters are not always at the end',
  new Set(Array.from({ length: 200 }, (_, i) => makeStaffCode(JOIN, seeded(i + 1)).slice(0, 6))).size > 1);

// ── how many codes one join code can produce (Ahiya chose 2 over 1 on this number) ──────
const all = new Set<string>();
for (let p1 = 0; p1 <= 6; p1++) for (const c1 of STAFF_CODE_ALPHABET) {
  const one = JOIN.slice(0, p1) + c1 + JOIN.slice(p1);
  for (let p2 = 0; p2 <= 7; p2++) for (const c2 of STAFF_CODE_ALPHABET) all.add(one.slice(0, p2) + c2 + one.slice(p2));
}
check(`one join code yields more than 20,000 staff codes (measured ${all.size})`, all.size > 20000, all.size);

// ── finding the run back ─────────────────────────────────────────────────────
const code = makeStaffCode(JOIN, seeded(7));
const cands = candidateJoinCodes(code);
check('the join code is among the candidates', cands.includes(JOIN), cands);
check('at most 28 candidates, all distinct', cands.length <= 28 && new Set(cands).size === cands.length, cands.length);
check('every candidate is 6 characters', cands.every((c) => c.length === 6));
check('a code of the wrong length has no candidates',
  candidateJoinCodes('63MZWC').length === 0 && candidateJoinCodes('63MZWC123').length === 0
  && candidateJoinCodes('123456').length === 0);
let roundTrip = true;
for (let seed = 1; seed <= 500; seed++) {
  const join = makeStaffCode('ABCDEF', seeded(seed)).slice(0, 6); // any 6 alphabet chars
  if (!candidateJoinCodes(makeStaffCode(join, seeded(seed * 31))).includes(join)) roundTrip = false;
}
check('for any join code, its staff code always leads back to it', roundTrip);

// ── what people type ─────────────────────────────────────────────────────────
check('lower case, spaces and dashes are folded', normalizeStaffCode(' 6k3m-zw 7c ') === '6K3MZW7C', normalizeStaffCode(' 6k3m-zw 7c '));
check('an old 6-digit code is kept as typed', normalizeStaffCode('482 177') === '482177');
check('anything else is refused', normalizeStaffCode('63MZ/WC7') === null && normalizeStaffCode('') === null
  && normalizeStaffCode(undefined) === null && normalizeStaffCode('קוד') === null);
check('an absurdly long input is refused', normalizeStaffCode('A'.repeat(40)) === null);

console.log(failures === 0 ? '\n✅ staff code: ALL PASS' : `\n❌ staff code: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
