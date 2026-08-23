// Pure-logic tests for task-media DURABILITY (change: task-media-durability).
//
// The bug this pins: a creator attached a picture to a mission, and a later autosave
// silently deleted it. `normalizeTaskMedia` was written as a FILTER over arbitrary
// client input — drop what does not pass — but the very same call site also re-validates
// media the server itself accepted and persisted weeks ago. Every Builder autosave sends
// the whole `stages` array, so a stored URL is re-judged against whatever the CURRENT
// process env happens to accept. When the two disagree (env var absent, API re-domained,
// a playtest runtime saving a production game, or the `req.protocol` fallback minting an
// http:// URL), the filter erased real creator content and the callable returned success.
//
// Three properties are pinned here:
//   1. a URL the server already stored SURVIVES a save from a runtime that would refuse it;
//   2. a URL that is NEW in the payload and fails is REPORTED, never silently dropped;
//   3. the accepted-origin set does not hinge on one env var.
// Plus `rewriteStagesMedia`, the pure half of re-hosting media on duplicate/translate.
//
//   npx tsx scripts/test-task-media-durability.ts
import {
  normalizeTaskMedia,
  normalizeTaskMediaDetailed,
  isFirebaseStorageUrl,
  rewriteStagesMedia,
  buildMediaUrlMapping,
  RUSHPOINT_UPLOAD_ORIGINS,
  FIREBASE_STORAGE_ORIGIN,
} from '../packages/shared/src/validation';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const CANON = RUSHPOINT_UPLOAD_ORIGINS[0]; // https://api.rush-point.com
const OBJ = 'gameMedia/owner1/games/g1/task_1-1755300000000.jpg';
const VPS_IMG = `${CANON}/uploads/${OBJ}`;
const VPS_IMG_HTTP = VPS_IMG.replace('https://', 'http://');
const TUNNEL_IMG =
  'https://abc123.ngrok-free.app/v0/b/rushpoint-pwa-7daaa.firebasestorage.app/o/'
  + 'gameMedia%2Fowner1%2Fgames%2Fg1%2Ftask_1-1.jpg?alt=media';
const FOREIGN = 'https://evil.example/uploads/gameMedia/owner1/games/g1/x.jpg';
const YT = 'https://www.youtube.com/embed/dQw4w9WgXcQ';

// ── 1. The accepted-origin set does not hinge on one env var ──────────────────
// Row 1 of the table in the proposal: with VPS_UPLOAD_ORIGIN unset, the URL this very
// platform minted was refused — and therefore deleted — by its own validator.
check('canonical upload origin accepted with NO configured origin',
  isFirebaseStorageUrl(VPS_IMG, {}) === true);
check('canonical upload origin accepted when configured too',
  isFirebaseStorageUrl(VPS_IMG, { vpsOrigins: [CANON] }) === true);
// server.js used to fall back to `${req.protocol}://…`, and express has no trust proxy
// there, so a proxied upload minted an http:// URL that EVERY mode then dropped.
check('http form of a canonical host is understood, not destroyed',
  isFirebaseStorageUrl(VPS_IMG_HTTP, {}) === true);
check('a configured extra origin still works',
  isFirebaseStorageUrl('https://api.staging.example/uploads/' + OBJ,
    { vpsOrigins: ['https://api.staging.example'] }) === true);
check('an arbitrary origin is still refused (no config)',
  isFirebaseStorageUrl(FOREIGN, {}) === false);
check('an arbitrary origin is still refused (with config)',
  isFirebaseStorageUrl(FOREIGN, { vpsOrigins: [CANON] }) === false);
check('http form of a NON-canonical host is still refused',
  isFirebaseStorageUrl('http://evil.example/uploads/' + OBJ, {}) === false);
// The traversal guard must survive the widened origin set.
check('traversal on a canonical origin still refused',
  isFirebaseStorageUrl(`${CANON}/uploads/gameMedia/owner1/../../etc/passwd`, {}) === false);
// Unchanged pre-existing behaviour.
check('firebase download origin still accepted',
  isFirebaseStorageUrl(`${FIREBASE_STORAGE_ORIGIN}o/x.jpg?alt=media`, {}) === true);
check('gs:// still accepted', isFirebaseStorageUrl('gs://bucket/x.jpg', {}) === true);
check('tunnel shape still gated behind allowLocalEmulator',
  isFirebaseStorageUrl(TUNNEL_IMG, {}) === false
  && isFirebaseStorageUrl(TUNNEL_IMG, { allowLocalEmulator: true }) === true);

// ── 2. A stored URL survives a runtime that would refuse it ───────────────────
// This is the data-loss fix. TUNNEL_IMG is refused in production mode; if it is already
// persisted on the task, a production autosave must NOT delete it.
{
  const stored = new Set([TUNNEL_IMG]);
  const r = normalizeTaskMediaDetailed(
    [{ id: 'm1', kind: 'image', url: TUNNEL_IMG }], {}, stored,
  );
  check('stored-but-drifted URL is KEPT', r.media.length === 1 && r.media[0].url === TUNNEL_IMG);
  check('stored-but-drifted URL is reported as retained',
    r.retained.length === 1 && r.retained[0] === TUNNEL_IMG);
  check('stored-but-drifted URL is NOT reported as rejected', r.rejected.length === 0);
}
{
  // The reverse direction of the same disagreement: a production URL saved from a
  // playtest/emulator runtime.
  const r = normalizeTaskMediaDetailed(
    [{ id: 'm1', kind: 'image', url: VPS_IMG }], { allowLocalEmulator: true }, new Set([VPS_IMG]),
  );
  check('production URL survives an emulator-runtime save', r.media.length === 1);
}
{
  // A stored entry is still SHAPE-normalized: caption trimmed, id preserved, youtube
  // canonicalized. Grandfathering the origin must not grandfather a malformed shape.
  const r = normalizeTaskMediaDetailed(
    [{ id: ' m1 ', kind: 'image', url: TUNNEL_IMG, caption: '  hello  ' }], {}, new Set([TUNNEL_IMG]),
  );
  check('stored entry is still shape-normalized',
    r.media[0].id === 'm1' && r.media[0].caption === 'hello');
}
{
  // A stored URL that is not even a URL shape is still refused — keepUrls grandfathers
  // the ORIGIN check, not the type check.
  const r = normalizeTaskMediaDetailed(
    [{ id: 'm1', kind: 'image', url: 42 as unknown as string }], {}, new Set(),
  );
  check('non-string url still dropped', r.media.length === 0);
}

// ── 3. A NEW bad URL is REPORTED, never silently dropped ──────────────────────
{
  const r = normalizeTaskMediaDetailed([{ id: 'm1', kind: 'image', url: FOREIGN }], {}, new Set());
  check('new off-origin URL is rejected, not silently absent',
    r.media.length === 0 && r.rejected.length === 1 && r.rejected[0] === FOREIGN);
}
{
  // Not in keepUrls ⇒ new ⇒ must be reported even though a *different* stored url exists.
  const r = normalizeTaskMediaDetailed(
    [{ id: 'm1', kind: 'image', url: TUNNEL_IMG }, { id: 'm2', kind: 'image', url: FOREIGN }],
    {}, new Set([TUNNEL_IMG]),
  );
  check('mixed payload keeps the stored one and rejects the new one',
    r.media.length === 1 && r.media[0].url === TUNNEL_IMG
    && r.rejected.length === 1 && r.rejected[0] === FOREIGN);
}
{
  const r = normalizeTaskMediaDetailed([{ id: 'm1', kind: 'youtube', url: 'https://vimeo.com/1' }], {}, new Set());
  check('unparseable youtube link is reported too', r.rejected.length === 1);
}
{
  const r = normalizeTaskMediaDetailed([{ kind: 'sticker', url: VPS_IMG }], {}, new Set());
  check('unknown kind is reported', r.rejected.length === 1 && r.media.length === 0);
}

// ── 4. normalizeTaskMedia keeps its exact prior contract ──────────────────────
// Every existing call site must be byte-identical: no argument, no grandfathering.
check('normalizeTaskMedia unchanged: drops a foreign url',
  normalizeTaskMedia([{ kind: 'image', url: FOREIGN }], {}).length === 0);
check('normalizeTaskMedia unchanged: keeps a good url',
  normalizeTaskMedia([{ kind: 'image', url: VPS_IMG }], {}).length === 1);
check('normalizeTaskMedia unchanged: non-array → []',
  normalizeTaskMedia('nope' as unknown, {}).length === 0);
check('normalizeTaskMedia unchanged: canonicalizes youtube',
  normalizeTaskMedia([{ kind: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ' }], {})[0].url === YT);

// ── 5. rewriteStagesMedia — the pure half of re-hosting on duplicate ──────────
const stagesOf = (media: unknown) => [{
  id: 's1', title: 'S', tasks: [{ id: 't1', title: 'T', ...(media ? { media } : {}) }],
}] as never;
{
  const mapping = new Map([[VPS_IMG, `${CANON}/uploads/gameMedia/owner1/games/g2/task_1-1.jpg`]]);
  const out = rewriteStagesMedia(stagesOf([{ id: 'm1', kind: 'image', url: VPS_IMG }]), mapping);
  check('image url rewritten onto the new prefix',
    out[0].tasks[0].media?.[0].url === mapping.get(VPS_IMG));
}
{
  const out = rewriteStagesMedia(stagesOf([{ id: 'm1', kind: 'youtube', url: YT }]), new Map());
  check('youtube entry carried over byte-identical', out[0].tasks[0].media?.[0].url === YT);
}
{
  const out = rewriteStagesMedia(stagesOf([{ id: 'm1', kind: 'image', url: VPS_IMG }]), new Map());
  check('unmapped url left alone', out[0].tasks[0].media?.[0].url === VPS_IMG);
}
{
  const out = rewriteStagesMedia(stagesOf(null), new Map());
  check('task with no media untouched', out[0].tasks[0].media === undefined);
}
{
  // Must return a NEW array — this repo never dotted-updates a stored array element.
  const input = stagesOf([{ id: 'm1', kind: 'image', url: VPS_IMG }]);
  const out = rewriteStagesMedia(input, new Map([[VPS_IMG, 'x']]));
  check('returns a new stages array', out !== input && out[0] !== input[0]);
}
check('rewriteStagesMedia tolerates undefined stages',
  rewriteStagesMedia(undefined, new Map()) === undefined);

// ── 6. buildMediaUrlMapping — object paths → urls, in every encoding we've minted ──
const OLD_PATH = 'gameMedia/owner1/games/g1/task_1-1755300000000.jpg';
const NEW_PATH = 'gameMedia/owner1/games/g2/task_1-1755300000000.jpg';
const paths = new Map([[OLD_PATH, NEW_PATH]]);
{
  const m = buildMediaUrlMapping([VPS_IMG], paths);
  check('raw (VPS) url path remapped', m.get(VPS_IMG) === `${CANON}/uploads/${NEW_PATH}`);
}
{
  // Firebase download urls carry the path percent-ENCODED.
  const fbOld = `${FIREBASE_STORAGE_ORIGIN}o/${encodeURIComponent(OLD_PATH)}?alt=media&token=t`;
  const fbNew = `${FIREBASE_STORAGE_ORIGIN}o/${encodeURIComponent(NEW_PATH)}?alt=media&token=t`;
  check('percent-encoded (Firebase) url path remapped',
    buildMediaUrlMapping([fbOld], paths).get(fbOld) === fbNew);
}
check('a url whose path is not in the mapping is absent',
  buildMediaUrlMapping([`${CANON}/uploads/gameMedia/owner1/games/g9/x.jpg`], paths).size === 0);
check('a youtube url is never mapped', buildMediaUrlMapping([YT], paths).size === 0);
check('empty mapping yields empty result', buildMediaUrlMapping([VPS_IMG], new Map()).size === 0);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
