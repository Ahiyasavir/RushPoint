// The phone must still get in when Firebase stops creating accounts (change: signup-quota-fallback).
//
// Firebase Auth creates at most 100 accounts an hour from one IP address. At an event on the venue WiFi
// every phone leaves from one address, so the 101st phone in the hour is refused anonymous sign-in with
// `auth/too-many-requests` and could not join at all. The phone now falls back to a session the API
// creates (`startPlayerSession`), but ONLY on that refusal and ONLY when it knows which game it is
// joining: anonymous sign-in stays the first path, it is the one proven in the field.
//   npx tsx scripts/test-signup-fallback.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldUseServerSession, joinCodeFromSearch } from '../apps/play-web/src/lib/signUpFallback';

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); }
};
const err = (code: string) => Object.assign(new Error(code), { code });

// 1. When to fall back.
check('the quota refusal with a known code falls back', shouldUseServerSession(err('auth/too-many-requests'), 'EH3L25'));
check('the quota refusal with no code does not (the server needs a game to vouch for)', !shouldUseServerSession(err('auth/too-many-requests'), null));
check('a dropped connection does not fall back (the server call would fail the same way)', !shouldUseServerSession(err('auth/network-request-failed'), 'EH3L25'));
check('any other refusal does not fall back', !shouldUseServerSession(err('auth/internal-error'), 'EH3L25'));
check('a value that is not an error does not throw', !shouldUseServerSession(undefined, 'EH3L25') && !shouldUseServerSession('x', 'EH3L25'));

// 2. Which code: the link's own.
check('the link code is read and normalized', joinCodeFromSearch('?code=eh3l25') === 'EH3L25', joinCodeFromSearch('?code=eh3l25'));
check('a team (phones) link still carries the game code', joinCodeFromSearch('?code=EH3L25&join=K7P2') === 'EH3L25');
check('no code, no hint', joinCodeFromSearch('?board=X') === null && joinCodeFromSearch('') === null);
check('an empty code is no hint', joinCodeFromSearch('?code=') === null);

// 3. Wiring: every fresh sign-in on the phone goes through the fallback, so none of the three paths
// (first open, a lost sign-in before joining, the rejoin) can still dead-end on the quota.
const fb = readFileSync(join(process.cwd(), 'apps/play-web/src/services/firebase.ts'), 'utf8');
const bare = fb.split('\n').filter((l) => /signInAnonymously\(auth\)/.test(l) && !/function signInFreshPlayer|\/\//.test(l));
check('firebase.ts calls signInAnonymously in exactly one place (the wrapper)', bare.length === 1, bare);
check('the wrapper exists and calls the server session', /async function signInFreshPlayer\(/.test(fb) && /startPlayerSession/.test(fb));
check('the join wrappers remember the code being used', /rememberJoinCode\(/.test(fb) || /rememberJoinCode\(/.test(readFileSync(join(process.cwd(), 'apps/play-web/src/services/calls.ts'), 'utf8')));
// The staff console's "a player is here" check must know a fallback player, who is not anonymous.
const staff = readFileSync(join(process.cwd(), 'apps/play-web/src/screens/StaffConsole.tsx'), 'utf8');
check('the staff console does not judge a player by isAnonymous alone', !/isAnonymous === true/.test(staff), staff.match(/.*isAnonymous.*/g));

console.log(`\n${failures === 0 ? 'ALL SIGNUP FALLBACK TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
