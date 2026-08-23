// Pure-logic test for the participant join path (change: join-flow-resilience).
//
// Joining is the first thing every participant does, under the worst conditions:
// a whole group at once, outdoors, on cellular, with the host watching. Two pure
// decisions run there and neither was tested:
//
//  1. WHAT WE SEND. The code field used to uppercase the raw value and cap the
//     input element at 8 characters, so a pasted join link
//     (`https://…/?code=ABC123`) was truncated by the BROWSER to `HTTPS://`
//     before onChange ever saw it, and an internal space or a dash reached the
//     server and came back as a flat "invalid code".
//  2. WHAT WE SHOW. `joinError` mapped four codes and let everything else fall
//     through to the raw server message — so a Hebrew-speaking teenager read
//     "This race has already finished." (failed-precondition) or
//     "This code has been revoked" (permission-denied), in English, written for
//     the host, with nothing to do next.
//
// Both are now pure functions in apps/play-web/src/lib/joinCode.ts. No emulator.
//   npx tsx scripts/test-join-code.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeJoinCodeInput,
  joinErrorKey,
  MAX_JOIN_CODE_LEN,
  type JoinErrorKey,
} from '../apps/play-web/src/lib/joinCode';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── normalizeJoinCodeInput ───────────────────────────────────────────────────
console.log('\n── normalizeJoinCodeInput ──');

// Every fixture is also swept for the invariants below, so add inputs here.
const inputs: unknown[] = [];
function norm(label: string, raw: unknown, expected: string): void {
  inputs.push(raw);
  const got = normalizeJoinCodeInput(raw);
  check(label, got === expected, `got ${JSON.stringify(got)}, want ${JSON.stringify(expected)}`);
}

norm('lower-case is upper-cased', 'abc123', 'ABC123');
norm('an already canonical code is unchanged', 'ABC123', 'ABC123');
norm('surrounding whitespace is trimmed', '   ABC123   ', 'ABC123');
norm('a tab + newline paste is cleaned', '\tabc123\n', 'ABC123');
norm('an internal space is removed', 'AB C123', 'ABC123');
norm('several internal spaces are removed', ' a b c 1 2 3 ', 'ABC123');
norm('a dash is removed (no-dashes convention)', 'ABC-123', 'ABC123');
norm('punctuation is removed', 'ABC.123!', 'ABC123');

// A pasted join link: the code is the `code` param, never the URL.
norm('a pasted link yields its code param', 'https://play.example.com/?code=abc123', 'ABC123');
norm('a pasted link with extra params yields only the code',
  'https://play.example.com/?code=abc123&ref=xyz', 'ABC123');
norm('a code param after another param is found',
  'https://play.example.com/?ref=xyz&code=abc123', 'ABC123');
norm('an upper-case CODE= param is found', 'HTTPS://PLAY.EXAMPLE.COM/?CODE=ABC123', 'ABC123');
norm('a link with surrounding chat text yields the code',
  'join here 👉 https://play.example.com/?code=abc123 see you there', 'ABC123');
norm('a link with NO code param contributes no scheme or host letters',
  'https://play.example.com/abc123', 'ABC123');

// RTL: a Hebrew group chat wraps pasted text in bidi marks.
norm('an RTL-marked paste is cleaned', '‏ abc123 ‎', 'ABC123');
norm('a bidi-isolated paste is cleaned', '⁦ABC123⁩', 'ABC123');
norm('a BOM-prefixed paste is cleaned', '﻿ABC123', 'ABC123');

// Absent / unusable input is a string, never a throw.
norm('empty string', '', '');
norm('whitespace only', '     ', '');
norm('null', null, '');
norm('undefined', undefined, '');
norm('a number', 123456, '');
norm('an object', {}, '');
norm('an array', ['ABC123'], '');
norm('punctuation only', '---', '');

// Over-long input is capped HERE, not by the input element's maxLength.
norm('a 200-char string is capped', 'A'.repeat(200), 'A'.repeat(MAX_JOIN_CODE_LEN));
check('MAX_JOIN_CODE_LEN leaves room for a 6-char generated code', MAX_JOIN_CODE_LEN >= 6);

// Look-alikes are NOT substituted (design D2): the access-code alphabet already
// excludes I/O/0/1, so a typed O has no valid target and any substitution would
// send a DIFFERENT code than the participant entered.
norm('look-alikes are passed through, never substituted', 'o0i1l', 'O0I1L');

// ── Invariants over every fixture ────────────────────────────────────────────
console.log('\n── invariants ──');
let shapeBad = 0; let longBad = 0; let idemBad = 0;
for (const raw of inputs) {
  const once = normalizeJoinCodeInput(raw);
  if (!/^[A-Z0-9]*$/.test(once)) { shapeBad++; console.log(`  shape: ${JSON.stringify(raw)} -> ${JSON.stringify(once)}`); }
  if (once.length > MAX_JOIN_CODE_LEN) { longBad++; }
  if (normalizeJoinCodeInput(once) !== once) { idemBad++; console.log(`  idempotence: ${JSON.stringify(once)}`); }
}
check('output is always upper alphanumeric', shapeBad === 0, `${shapeBad} bad`);
check('output never exceeds MAX_JOIN_CODE_LEN', longBad === 0, `${longBad} bad`);
check('normalization is idempotent', idemBad === 0, `${idemBad} bad`);

// ── joinErrorKey ─────────────────────────────────────────────────────────────
console.log('\n── joinErrorKey ──');

function err(code: string, message = 'server prose'): unknown {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}
function key(label: string, e: unknown, expected: JoinErrorKey): void {
  const got = joinErrorKey(e);
  check(label, got === expected, `got ${got}, want ${expected}`);
}

// Bad / unknown code.
key('not-found → invalidCode', err('not-found'), 'invalidCode');
key('invalid-argument → invalidCode', err('invalid-argument'), 'invalidCode');
key('functions/not-found → invalidCode', err('functions/not-found'), 'invalidCode');
// Valid code, run not joinable.
key('permission-denied → revoked', err('permission-denied', 'This code has been revoked'), 'revoked');
key('functions/permission-denied → revoked', err('functions/permission-denied'), 'revoked');
key('failed-precondition → finished', err('failed-precondition', 'This race has already finished.'), 'finished');
key('functions/failed-precondition → finished', err('functions/failed-precondition'), 'finished');
key('resource-exhausted → full', err('resource-exhausted'), 'full');
key('functions/resource-exhausted → full', err('functions/resource-exhausted'), 'full');
// Transport / sign-in.
for (const c of ['unavailable', 'internal', 'deadline-exceeded', 'unauthenticated', 'aborted', 'cancelled']) {
  key(`${c} → connection`, err(c), 'connection');
  key(`functions/${c} → connection`, err(`functions/${c}`), 'connection');
}
// Total function: anything else is a key, never a throw.
key('an unrecognized code → unknown', err('something-else'), 'unknown');
key('an Error with no code → unknown', new Error('boom'), 'unknown');
key('a bare string → unknown', 'boom', 'unknown');
key('null → unknown', null, 'unknown');
key('undefined → unknown', undefined, 'unknown');
key('a plain object → unknown', {}, 'unknown');
key('a non-string code → unknown', { code: 42 }, 'unknown');

// ── Wiring guards over JoinScreen.tsx ────────────────────────────────────────
// The pure functions must not be able to pass while the screen still carries the
// inline logic they replaced.
console.log('\n── JoinScreen wiring ──');
const screen = readFileSync(join(process.cwd(), 'apps/play-web/src/screens/JoinScreen.tsx'), 'utf8');

check('JoinScreen imports the pure join-code module', /from '\.\.\/lib\/joinCode'/.test(screen));
check('the code input normalizes on change',
  /onChange=\{\(e\) => setCode\(normalizeJoinCodeInput\(e\.target\.value\)\)\}/.test(screen));
check('the deep-link code is normalized too', /normalizeJoinCodeInput\(initialCode/.test(screen));
check('the code input no longer caps at 8 (that ate pasted links)', !/maxLength=\{8\}/.test(screen));
check('errors are mapped through joinErrorKey', /joinErrorKey\(/.test(screen));
check('no raw server message is shown to the participant',
  !/e\.message\.replace\('Firebase: '/.test(screen));
check('no code.trim().toUpperCase() left on the join path',
  !/code\.trim\(\)\.toUpperCase\(\)/.test(screen));
check('the revoked-code copy is used', /t\.join\.codeRevoked/.test(screen));

// ── Copy guards over i18n.ts ─────────────────────────────────────────────────
console.log('\n── copy ──');
const i18n = readFileSync(join(process.cwd(), 'apps/play-web/src/i18n.ts'), 'utf8');
const revoked = i18n.match(/codeRevoked: '([^']*)'/g) ?? [];
check('codeRevoked exists in BOTH dictionaries', revoked.length === 2, `${revoked.length} found`);
check('the Hebrew codeRevoked copy is Hebrew', /[֐-׿]/.test(revoked[0] ?? ''));
check('no em-dash in the new copy', !revoked.some((r) => r.includes('—')));

console.log(`\n${failures === 0 ? 'ALL JOIN-CODE TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
