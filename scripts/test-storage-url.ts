// Pure-logic test for requireStorageUrl (change: auth-anticheat-hardening, row 41).
// A submitted photo URL must point at the CALLER'S OWN run/team Storage path
// (runs/{runId}/teams/{uid}/…) — not another team, not an arbitrary/foreign URL,
// not a javascript: payload, not an oversized string. No emulator.
//   npx tsx scripts/test-storage-url.ts
import { requireStorageUrl, isFirebaseStorageUrl, ValidationError, FIREBASE_STORAGE_ORIGIN } from '../packages/shared/src/validation';

// The live client bucket is the firebasestorage.app form — the guard must accept it.
const FBAPP_ORIGIN = 'https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.firebasestorage.app/';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
function rejected(fn: () => unknown): boolean {
  try { fn(); return false; } catch (e) { return e instanceof ValidationError; }
}

const RUN = 'run123', UID = 'uidABC';
const ownHttps = `${FIREBASE_STORAGE_ORIGIN}o/runs%2Frun123%2Fteams%2FuidABC%2Fphoto-1.jpg?alt=media`;
const ownGs = 'gs://rushpoint-pwa-7daaa.appspot.com/runs/run123/teams/uidABC/photo-1.jpg';

check('accepts the caller\'s own https download URL', requireStorageUrl(ownHttps, RUN, UID) === ownHttps);
check('accepts the caller\'s own gs:// URL', requireStorageUrl(ownGs, RUN, UID) === ownGs);
const ownFbApp = `${FBAPP_ORIGIN}o/runs%2Frun123%2Fteams%2FuidABC%2Fphoto-1.jpg?alt=media`;
check('accepts the firebasestorage.app bucket download URL (real client bucket)', requireStorageUrl(ownFbApp, RUN, UID) === ownFbApp);
check('still rejects another team on the firebasestorage.app bucket', rejected(() => requireStorageUrl(`${FBAPP_ORIGIN}o/runs%2Frun123%2Fteams%2FOTHER%2Fx.jpg?alt=media`, RUN, UID)));
check('rejects a javascript: payload', rejected(() => requireStorageUrl('javascript:alert(1)', RUN, UID)));
check('rejects another team\'s path', rejected(() => requireStorageUrl(`${FIREBASE_STORAGE_ORIGIN}o/runs%2Frun123%2Fteams%2FOTHER%2Fx.jpg?alt=media`, RUN, UID)));
check('rejects another run\'s path', rejected(() => requireStorageUrl(`${FIREBASE_STORAGE_ORIGIN}o/runs%2FOTHER%2Fteams%2FuidABC%2Fx.jpg?alt=media`, RUN, UID)));
check('rejects a foreign origin', rejected(() => requireStorageUrl('https://evil.com/runs/run123/teams/uidABC/x.jpg', RUN, UID)));
check('rejects an oversized string', rejected(() => requireStorageUrl('https://x/' + 'a'.repeat(5000), RUN, UID)));
check('rejects a non-string', rejected(() => requireStorageUrl(undefined as unknown as string, RUN, UID)));

// ── isFirebaseStorageUrl regression lock (browser-02 P0 #2) ───────────────────
// The bucket-origin gate must accept a client-SDK-shaped download URL on BOTH of
// our project's bucket names and reject any external host. The night-sim report
// flagged that no test used a client-shaped URL, so a bucket rename could silently
// reject every real upload again.
{
  const appShaped = `${FBAPP_ORIGIN}o/runs%2Fr1%2Fteams%2Ft1%2Fp.jpg?alt=media&token=abc-123`;
  const appspotShaped = `${FIREBASE_STORAGE_ORIGIN}o/runs%2Fr1%2Fteams%2Ft1%2Fp.jpg?alt=media&token=def-456`;
  check('isFirebaseStorageUrl accepts a client-shaped firebasestorage.app URL', isFirebaseStorageUrl(appShaped));
  check('isFirebaseStorageUrl accepts a client-shaped appspot.com URL', isFirebaseStorageUrl(appspotShaped));
  check('isFirebaseStorageUrl rejects an external host', !isFirebaseStorageUrl('https://evil.example.com/p.jpg'));
  check('isFirebaseStorageUrl rejects a non-string', !isFirebaseStorageUrl(undefined));
}

console.log(`\n${failures === 0 ? 'ALL STORAGE-URL TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
