// A rejected photo: retake first, ask before sending the same picture, refuse it after a second
// rejection (change: rejected-photo-resend; issues 23 and 24, Ahiya 2026-10-06).
import { readFileSync } from 'node:fs';
import { isMediaHash, resendVerdict } from '../packages/shared/src/mediaResend';

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`, detail ?? '');
}

const H = 'a'.repeat(64);
const H2 = '0123456789abcdef'.repeat(4);

console.log('— the hash —');
check('64 lowercase hex is a hash', isMediaHash(H) && isMediaHash(H2));
check('anything else is not', [undefined, null, '', 'abc', H.toUpperCase(), H + 'a', 'g'.repeat(64), 42, {}].every((v) => !isMediaHash(v)));

console.log('— the verdict —');
check('no hash ⇒ new (an old phone is never blocked)', resendVerdict({ [H]: 5 }, undefined) === 'new');
check('junk hash ⇒ new', resendVerdict({ [H]: 5 }, 'nope') === 'new');
check('no record ⇒ new', resendVerdict(undefined, H) === 'new' && resendVerdict(null, H) === 'new');
check('a different picture ⇒ new', resendVerdict({ [H]: 2 }, H2) === 'new');
check('rejected once ⇒ rejectedOnce', resendVerdict({ [H]: 1 }, H) === 'rejectedOnce');
check('rejected twice ⇒ rejectedTwice', resendVerdict({ [H]: 2 }, H) === 'rejectedTwice' && resendVerdict({ [H]: 7 }, H) === 'rejectedTwice');
check('a junk count ⇒ new', [0, -1, NaN, '2', null].every((c) => resendVerdict({ [H]: c } as never, H) === 'new'));
check('a junk map ⇒ new', resendVerdict('x' as never, H) === 'new' && resendVerdict([H] as never, H) === 'new');

console.log('— the server —');
const fn = readFileSync('functions/src/index.ts', 'utf8');
check('submitStationPhoto reads mediaHash', /mediaHash/.test(fn.slice(fn.indexOf("loggedCallable('submitStationPhoto'"), fn.indexOf("loggedCallable('attachSubmissionMedia'") > 0 ? fn.indexOf("loggedCallable('attachSubmissionMedia'") : undefined)));
check('a twice-rejected picture is refused by name', /same-media-rejected-twice/.test(fn));
check('a rejection counts the hash', /rejectedHashes/.test(fn.slice(fn.indexOf("loggedCallable('reviewStationSubmission'"))));

console.log('— the phone —');
const tr = readFileSync('apps/play-web/src/components/TaskRunner.tsx', 'utf8');
check('the photo is hashed before sending', /mediaHashOf\(/.test(tr));
check('retake is primary on a rejected photo', /retakeFirst/.test(tr));
check('the same picture asks before it is sent again', /resendSamePhotoConfirm/.test(tr));
check('a twice-rejected picture is not sent', /resendSamePhotoRefused/.test(tr));
const calls = readFileSync('apps/play-web/src/services/calls.ts', 'utf8');
check('the call carries mediaHash', /mediaHash/.test(calls));

console.log('');
if (failures > 0) { console.error(`✗ media-resend: ${failures} failed\n`); process.exit(1); }
console.log('✓ media-resend: all passed\n');
