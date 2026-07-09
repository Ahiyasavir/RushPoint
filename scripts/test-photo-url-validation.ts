// Pure-logic test for server-side photo-URL validation (change: prelaunch-critical-fixes, M3).
// submitStationPhoto must only accept Firebase Storage URLs from our bucket; any other
// origin (or a non-https / non-string value) is rejected. The guard is a pure helper so it
// is shared by the server and unit-tested with no emulator.
//   npx tsx scripts/test-photo-url-validation.ts
import assert from 'node:assert/strict';
import { isFirebaseStorageUrl } from '../packages/shared/src/validation';

assert(isFirebaseStorageUrl('https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/runs%2F...'), 'valid URL accepted');
assert(!isFirebaseStorageUrl('https://example.com/photo.jpg'), 'external URL rejected');
assert(!isFirebaseStorageUrl('http://firebasestorage.googleapis.com/...'), 'HTTP rejected');
assert(!isFirebaseStorageUrl(''), 'empty string rejected');
assert(!isFirebaseStorageUrl('javascript:alert(1)'), 'JS URL rejected');
assert(!isFirebaseStorageUrl(undefined as unknown as string), 'non-string rejected');
console.log('PASS photo-url-validation');
