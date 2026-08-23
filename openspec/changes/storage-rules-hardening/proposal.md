## Why

A sibling audit of `firestore.rules` found a real hole. `storage.rules` has had far less attention
and now holds the most sensitive data this product produces: **photo and audio submissions from
participants — frequently minors at a youth event** — plus creator-authored task media. This audit
read the rules file, both client upload paths, the server validators, and every deletion/retention
path, and tried to refute each candidate before recording it.

Two findings are CONFIRMED in this working tree:

1. **`checkins/{teamId}/**` is an open, unowned, never-cleaned write prefix** (`storage.rules:8-13`).
   The branch survives from v1. **No code in this repo reads or writes it** — grepped repo-wide;
   the archived `apps/mobile` uses `stationPhotos/`, which these rules never matched at all, so even
   that is already denied. What the branch does grant is real: `play-web` signs **every participant
   in anonymously**, and the Firebase web config is public by design, so *anyone* can mint an
   anonymous uid for this project and then upload **unlimited 10 MB images** to
   `checkins/<their-own-uid>/…`. Nothing ever deletes them: `deleteRunPhotos` uses prefix `runs/`,
   `deleteGameMedia` uses `gameMedia/`, the 90-day retention prune (`pruneRunPII`) uses `runs/`, and
   `deleteMyAccount` calls only those two. So the prefix is simultaneously **free unbounded storage
   on the project's bill**, an **arbitrary-content hosting surface** under a `firebasestorage`
   URL, and a set of objects **no erasure path can ever reach**. It is exactly the orphan class this
   repo already fixed once for `gameMedia`.

2. **Creator media is enumerable by strangers** (`storage.rules:40`, `allow read: if true`). In
   Storage rules `read` = `get` **+ `list`**. `publicGames/{gameId}` is world-readable
   (`firestore.rules:192-195`) and every doc carries `ownerUid` (`functions/src/games/index.ts:692`),
   so real creator uids are free to harvest. With those, a signed-out attacker lists
   `gameMedia/{ownerUid}/` and pulls **every** authored object — including media attached to
   **private, unpublished, or trashed-but-not-yet-purged** games. Object names alone are not
   guessable (`{taskId}-{ms}.{ext}`), so listing is precisely what converts "unguessable" into
   "downloadable".

A third, lower-severity item is a deliberate hardening rather than a live exploit: both write rules
accepted `image/svg+xml` (`storage.rules:12,33,43`) — stored **active content** under a
participant- or creator-controlled path, later opened by a reviewing staff member. It is
origin-isolated on `firebasestorage.googleapis.com` rather than an app-origin XSS, which is why it
is recorded as hardening and not as a confirmed exploit.

A latent operational hazard was also found in the cleanup code itself: every Storage deletion is a
**prefix delete**, and a prefix built from an id that turns out to be `''` or `undefined` does not
throw — it *widens*. `runs/${runId}/` with a blank runId is `runs/`, which silently deletes **every
run's participant photos in the bucket** (`functions/src/storageUtil.ts:14`,
`functions/src/maintenance/index.ts:137`).

## What Changes

**Dead rule branches are removed, not left as traps.**
- The v1 `checkins/**` prefix is deleted. Nothing writes it; nothing can clean it; therefore nothing
  may write it.
- The `stream/**` prefix — a "public photo stream" **no Cloud Function has ever written** — is
  deleted too. Its `read: if request.auth != null` was a loaded trap: the day something did write
  participant photos there, every anonymous participant on the platform could list and download
  them.
- An explicit `match /{allPaths=**} { allow read, write: if false; }` documents the default deny.
  It grants nothing (rule results are unioned) and states the intent for the next reader.

**Creator media stops being enumerable, without touching the render path.**
- `read` is split: `get` stays public, `list` becomes owner-only. Rendering is unaffected because
  every render uses the stored **tokenized `getDownloadURL()` link**, which bypasses Storage rules
  entirely — and `get` staying open is belt-and-braces on top of that. No product code calls
  `listAll()` on any Storage prefix (verified repo-wide), so nothing loses a capability it used.

**Content-type limits become an allowlist instead of a wildcard.**
- The participant prefix accepts an explicit set of raster image types plus the existing four audio
  types. This is non-breaking **by construction**: `uploadTaskPhoto()` always sends a hardcoded
  `'image/jpeg'` (camera captures are re-encoded to JPEG before upload) and `uploadTaskAudio()`
  sends the normalized type from that same four-item list — they are the only writers of the prefix.
- Creator media keeps `(image|video)/.*` — a creator picks arbitrary files, so an allowlist there
  *would* risk a real regression — but excludes `image/svg.*`. The cost is stated plainly: **SVG
  task media becomes unsupported.**

**Storage delete prefixes become pure, total, and unit-tested.**
- Prefix derivation moves behind pure functions that refuse a blank/absent id and refuse an id
  containing `/`, so a widening or escaping prefix fails loud instead of deleting the bucket. The
  whole-creator-tree form stays reachable only via an *explicit* omitted `gameId`; an empty-string
  `gameId` is refused rather than silently becoming an account-wide purge.

**Storage gets its own rules test harness.**
- A dedicated `scripts/test-storage-rules.mjs` covering write scoping, read privacy, staff run
  scoping, size/type limits, the enumeration hole, and the removed legacy prefixes.

### Non-goals

- **No product behavior change.** No callables, no Firestore rules, no `packages/shared` types, no
  creator-web, no play-web, no UI, no i18n.
- **Does not change who may see a photo through a download URL.** A tokenized `getDownloadURL()`
  link bypasses Storage rules by design; anyone holding one can fetch the object. That is
  documented as an accepted property below, not fixed here — fixing it means serving media through
  a signed, expiring, function-mediated URL, which is a far larger change.
- **Does not add per-user upload quotas.** Storage rules cannot express "N objects per uid"; the
  only lever they offer is per-object size, which is already applied.
- **Does not touch `scripts/test-rules.mjs`** (owned elsewhere) — the Storage coverage there stays
  valid and unmodified, and every one of its existing assertions still holds under the new rules.
- **Does not delete the objects already orphaned under `checkins/`.** Closing the write path stops
  the bleeding; sweeping the existing prefix is a separate operational task requiring bucket access.

## Capabilities

### New Capabilities
- `storage-object-security`: uploaded participant media and creator-authored media are confined by
  the Storage rules themselves — writes bound to the authenticated uid's own prefix, reads scoped to
  the owning participant and to staff of that same run, size and content-type enforced server-side,
  no enumeration of another tenant's tree, no unowned prefixes, and a delete-prefix derivation that
  cannot widen past its intended scope.

## Impact

- **Surfaces touched:** `storage.rules`, `functions/src/storagePaths.ts` (new, pure),
  `functions/src/storageUtil.ts`, `functions/src/maintenance/index.ts` (one line: prefix
  derivation), plus new tests. **No** shared types, **no** callables, **no** Firestore rules, **no**
  creator-web/play-web, **no** i18n.
- **Risk — rules tightening can break a working upload.** Every tightening was traced back to the
  real client call site before it was made: `uploadTaskPhoto` (`apps/play-web/src/services/firebase.ts:227`)
  hardcodes `image/jpeg`, `uploadTaskAudio` (`:246`) sends a normalized allowlisted audio type, and
  `uploadTaskMedia` (`apps/creator-web/src/services/firebase.ts:139`) writes only under its own uid
  and reads back with `getDownloadURL` (a `get`, still public). The one accepted regression is SVG
  task media.
- **Testing:** the pure prefix logic is covered by `functions/src/storagePaths.test.ts` (vitest, no
  emulator, RED→GREEN executed). The rules assertions are in `scripts/test-storage-rules.mjs`, which
  is **WRITTEN BUT NEVER EXECUTED**: a live playtest stack owns this machine's emulator and must not
  be restarted. Every rule change above was therefore made in the *stricter* direction so that an
  unverified assertion cannot be "made to pass" by loosening a rule. **A human or a later agent must
  run `npm run test:rules:storage` (and `npm run test:rules`) against a free emulator before this
  ships.**
