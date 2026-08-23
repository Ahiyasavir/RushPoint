// Pure-logic test for requireStorageUrl (change: auth-anticheat-hardening, row 41).
// A submitted photo URL must point at the CALLER'S OWN run/team Storage path
// (runs/{runId}/teams/{uid}/…) — not another team, not an arbitrary/foreign URL,
// not a javascript: payload, not an oversized string. No emulator.
//   npx tsx scripts/test-storage-url.ts
import { requireStorageUrl, isFirebaseStorageUrl, normalizeTaskMedia, ValidationError, FIREBASE_STORAGE_ORIGIN } from '../packages/shared/src/validation';

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

// ── Emulator / proxied-tunnel origins (wave-c: photo upload has never worked) ─
// Against the Storage EMULATOR getDownloadURL() returns an emulator-hosted URL
// (http://127.0.0.1:9199/v0/b/<bucket>/o/<encoded>?alt=media&token=…); behind the
// playtest tunnel the same path arrives on the single https tunnel origin. Neither
// starts with a production origin, so requireStorageUrl rejected EVERY real upload.
// The relaxation is an explicit caller-supplied opt-in (validation.ts stays pure);
// production keeps the exact old accept-set, and the runs/{runId}/teams/{uid}/
// prefix — the real IDOR guard — is enforced in BOTH modes.
{
  const EMU = 'http://127.0.0.1:9199/v0/b/rushpoint-pwa-7daaa.appspot.com/';
  const TUN = 'https://rushpoint.ngrok.app/v0/b/rushpoint-pwa-7daaa.firebasestorage.app/';
  const emuOwn = `${EMU}o/runs%2Frun123%2Fteams%2FuidABC%2Fphoto-1.jpg?alt=media&token=abc`;
  const tunOwn = `${TUN}o/runs%2Frun123%2Fteams%2FuidABC%2Fphoto-1.jpg?alt=media&token=abc`;
  const on = { allowLocalEmulator: true };

  // production behaviour must be byte-identical with the flag in EITHER position
  check('prod origin still accepted with the flag off', requireStorageUrl(ownHttps, RUN, UID, {}) === ownHttps);
  check('prod origin still accepted with the flag on', requireStorageUrl(ownHttps, RUN, UID, on) === ownHttps);
  check('gs:// still accepted with the flag on', requireStorageUrl(ownGs, RUN, UID, on) === ownGs);

  // the emulator/tunnel shapes: rejected when off, accepted when on
  check('emulator URL REJECTED when the flag is off', rejected(() => requireStorageUrl(emuOwn, RUN, UID)));
  check('emulator URL accepted when the flag is on', requireStorageUrl(emuOwn, RUN, UID, on) === emuOwn);
  check('proxied tunnel URL REJECTED when the flag is off', rejected(() => requireStorageUrl(tunOwn, RUN, UID)));
  check('proxied tunnel URL accepted when the flag is on', requireStorageUrl(tunOwn, RUN, UID, on) === tunOwn);

  // an arbitrary external URL is rejected in BOTH modes (the injection guard)
  check('external URL rejected with the flag off', rejected(() => requireStorageUrl('https://evil.com/photo.jpg', RUN, UID)));
  check('external URL rejected with the flag on', rejected(() => requireStorageUrl('https://evil.com/photo.jpg', RUN, UID, on)));
  check('external URL wearing our path rejected with the flag on',
    rejected(() => requireStorageUrl('https://evil.com/runs/run123/teams/uidABC/x.jpg', RUN, UID, on)));
  check('javascript: payload rejected with the flag on', rejected(() => requireStorageUrl('javascript:alert(1)', RUN, UID, on)));

  // the IDOR guard survives the relaxation
  check('emulator mode still rejects ANOTHER team\'s folder',
    rejected(() => requireStorageUrl(`${EMU}o/runs%2Frun123%2Fteams%2FOTHER%2Fx.jpg?alt=media`, RUN, UID, on)));
  check('emulator mode still rejects ANOTHER run\'s folder',
    rejected(() => requireStorageUrl(`${EMU}o/runs%2FOTHER%2Fteams%2FuidABC%2Fx.jpg?alt=media`, RUN, UID, on)));
  check('emulator mode still rejects a run-root path',
    rejected(() => requireStorageUrl(`${EMU}o/runs%2Frun123%2Fx.jpg?alt=media`, RUN, UID, on)));

  // creator task media had the SAME defect (normalizeTaskMedia drops the entry)
  const emuMedia = [{ id: 'm1', kind: 'image' as const, url: `${EMU}o/gameMedia%2Fg1%2Fpic.jpg?alt=media` }];
  check('isFirebaseStorageUrl rejects an emulator URL with the flag off', !isFirebaseStorageUrl(emuMedia[0].url));
  check('isFirebaseStorageUrl accepts an emulator URL with the flag on', isFirebaseStorageUrl(emuMedia[0].url, on));
  check('isFirebaseStorageUrl still rejects an external host with the flag on', !isFirebaseStorageUrl('https://evil.example.com/p.jpg', on));
  check('normalizeTaskMedia drops emulator media with the flag off', normalizeTaskMedia(emuMedia).length === 0);
  check('normalizeTaskMedia keeps emulator media with the flag on', normalizeTaskMedia(emuMedia, on).length === 1);
  check('normalizeTaskMedia still drops an external image with the flag on',
    normalizeTaskMedia([{ id: 'm1', kind: 'image' as const, url: 'https://evil.example.com/p.jpg' }], on).length === 0);
}

// ── VPS-hosted upload URLs (vps-upload-route) ───────────────────────────────
{
  const VPS = 'https://api.rush-point.com';
  const vpsOpts = { vpsOrigin: VPS };
  const ownVps = `${VPS}/uploads/runs/run123/teams/uidABC/photo-1.jpg`;
  check('requireStorageUrl accepts VPS URL with vpsOrigin', requireStorageUrl(ownVps, RUN, UID, vpsOpts) === ownVps);
  // FLIPPED by change: task-media-durability. This used to assert that our OWN upload
  // origin is refused when the env var happens to be unset — encoding as a requirement
  // the exact behaviour that deleted a creator's mission photo: `normalizeTaskMedia` is
  // a filter, so "unrecognised" meant "silently dropped from Firestore on the next
  // autosave". `api.rush-point.com` is now a compiled-in canonical origin
  // (RUSHPOINT_UPLOAD_ORIGINS), so a missing env var can no longer make this platform's
  // own URLs foreign. The real IDOR guard is unchanged and still does the work — see the
  // "another team" and traversal assertions below, which run in exactly this mode.
  check('requireStorageUrl accepts the canonical VPS origin with NO configured origin',
    requireStorageUrl(ownVps, RUN, UID) === ownVps);
  check('requireStorageUrl still rejects another team on the canonical origin, unconfigured',
    rejected(() => requireStorageUrl(`${VPS}/uploads/runs/run123/teams/OTHER/x.jpg`, RUN, UID)));
  check('requireStorageUrl still rejects an UNKNOWN upload origin',
    rejected(() => requireStorageUrl('https://evil.example/uploads/runs/run123/teams/uidABC/p.jpg', RUN, UID)));
  check('requireStorageUrl rejects another team on VPS', rejected(() => requireStorageUrl(`${VPS}/uploads/runs/run123/teams/OTHER/x.jpg`, RUN, UID, vpsOpts)));
  check('isFirebaseStorageUrl accepts VPS URL with vpsOrigin', isFirebaseStorageUrl(ownVps, vpsOpts));
  check('normalizeTaskMedia keeps VPS task media with vpsOrigin',
    normalizeTaskMedia([{ id: 'm1', kind: 'image' as const, url: `${VPS}/uploads/gameMedia/u1/games/g1/p.jpg` }], vpsOpts).length === 1);

  // Traversal: the run/team check is a startsWith, so without an explicit `..`
  // rejection `runs/<run>/teams/<uid>/../../<other>` satisfies the prefix while
  // naming another team's object. Both the raw and percent-encoded forms must go.
  check('requireStorageUrl rejects `..` traversal on VPS',
    rejected(() => requireStorageUrl(`${VPS}/uploads/runs/${RUN}/teams/${UID}/../../otherteam/x.jpg`, RUN, UID, vpsOpts)));
  check('requireStorageUrl rejects percent-encoded `..` traversal on VPS',
    rejected(() => requireStorageUrl(`${VPS}/uploads/runs/${RUN}/teams/${UID}/%2e%2e/%2e%2e/other/x.jpg`, RUN, UID, vpsOpts)));
  check('requireStorageUrl rejects `..` traversal on a Firebase URL too',
    rejected(() => requireStorageUrl(`${FIREBASE_STORAGE_ORIGIN}o/runs%2F${RUN}%2Fteams%2F${UID}%2F..%2F..%2Fother%2Fx.jpg?alt=media`, RUN, UID)));
  check('normalizeTaskMedia drops VPS media containing traversal',
    normalizeTaskMedia([{ id: 'm1', kind: 'image' as const, url: `${VPS}/uploads/gameMedia/../../etc/passwd` }], vpsOpts).length === 0);
  // Backslash separator: `path.join` treats it as one on Windows, so the payload
  // must not survive just because the host OS differs from the container's.
  check('requireStorageUrl rejects backslash traversal on VPS',
    rejected(() => requireStorageUrl(String.raw`${VPS}/uploads/runs/${RUN}/teams/${UID}/..\..\other/x.jpg`, RUN, UID, vpsOpts)));
  // …and a segment that merely CONTAINS dots is a legal object name, not traversal.
  const dotty = `${VPS}/uploads/runs/${RUN}/teams/${UID}/photo..1.jpg`;
  check('requireStorageUrl accepts a filename containing dots', requireStorageUrl(dotty, RUN, UID, vpsOpts) === dotty);
}

console.log(`\n${failures === 0 ? 'ALL STORAGE-URL TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
