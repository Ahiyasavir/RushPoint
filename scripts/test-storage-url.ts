// Pure-logic test for requireStorageUrl (change: auth-anticheat-hardening, row 41).
// A submitted photo URL must point at the CALLER'S OWN run/team Storage path
// (runs/{runId}/teams/{uid}/…) — not another team, not an arbitrary/foreign URL,
// not a javascript: payload, not an oversized string. No emulator.
//   npx tsx scripts/test-storage-url.ts
import { requireStorageUrl, ValidationError, FIREBASE_STORAGE_ORIGIN } from '../packages/shared/src/validation';

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
check('rejects a javascript: payload', rejected(() => requireStorageUrl('javascript:alert(1)', RUN, UID)));
check('rejects another team\'s path', rejected(() => requireStorageUrl(`${FIREBASE_STORAGE_ORIGIN}o/runs%2Frun123%2Fteams%2FOTHER%2Fx.jpg?alt=media`, RUN, UID)));
check('rejects another run\'s path', rejected(() => requireStorageUrl(`${FIREBASE_STORAGE_ORIGIN}o/runs%2FOTHER%2Fteams%2FuidABC%2Fx.jpg?alt=media`, RUN, UID)));
check('rejects a foreign origin', rejected(() => requireStorageUrl('https://evil.com/runs/run123/teams/uidABC/x.jpg', RUN, UID)));
check('rejects an oversized string', rejected(() => requireStorageUrl('https://x/' + 'a'.repeat(5000), RUN, UID)));
check('rejects a non-string', rejected(() => requireStorageUrl(undefined as unknown as string, RUN, UID)));

console.log(`\n${failures === 0 ? 'ALL STORAGE-URL TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
