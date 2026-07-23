## 1. RED — failing tests first

- [x] 1.1 Create `functions/src/storagePaths.test.ts` (vitest, no emulator) importing
      `runPhotoPrefix`, `gameMediaPrefix` and `gamePurgePrefixes` from a `./storagePaths` module
      that does not exist yet.
- [x] 1.2 Encode the widening cases from the design's Test Strategy: blank / whitespace /
      `undefined` / `null` ids throw; ids containing `/` throw; `gameMediaPrefix(owner, '')` throws
      rather than silently meaning "whole tree"; the trailing slash is mandatory.
- [x] 1.3 Encode the coverage cases: `gamePurgePrefixes` returns every run prefix plus the authored
      media prefix, de-duplicates runIds, still returns the media prefix when a game has no runs,
      and never returns a prefix with fewer than two non-empty segments.
- [x] 1.4 Run `npx vitest run src/storagePaths.test.ts` in `functions/` and confirm it FAILS for the
      right reason (`Cannot find module './storagePaths'`). Recorded.

## 2. GREEN — pure prefix derivation

- [x] 2.1 Add `functions/src/storagePaths.ts` with a private `requireId()` that rejects
      absent/blank ids and ids containing `/`, plus `runPhotoPrefix`, `gameMediaPrefix` (explicit
      `undefined` = whole tree) and `gamePurgePrefixes`.
- [x] 2.2 Re-run the vitest file and confirm GREEN (18 assertions).

## 3. GREEN — wire the derivation into the delete paths

- [x] 3.1 `functions/src/storageUtil.ts`: build both prefixes via the pure functions, **inside** the
      existing `try` so a refused id logs and skips instead of issuing a widened `deleteFiles`.
      Preserve the best-effort contract and both call signatures exactly
      (`deleteGameMedia(uid)` must still purge the whole creator tree for account deletion).
- [x] 3.2 `functions/src/maintenance/index.ts`: replace the inline `runs/${runId}/` literal in
      `pruneRunPII` with `runPhotoPrefix(runId)`.
- [x] 3.3 `npx tsc --noEmit` in `functions/` — clean; full functions vitest suite — 285 passed,
      no regressions.

## 4. GREEN — storage.rules

- [x] 4.1 Delete the `checkins/{teamId}/{allPaths=**}` branch. Confirm repo-wide that nothing reads
      or writes that prefix (the archived `apps/mobile` uses `stationPhotos/`, unmatched by these
      rules) and that no existing assertion in `scripts/test-rules.mjs` depends on it.
- [x] 4.2 Delete the `stream/{allPaths=**}` branch. Confirm `scripts/test-rules.mjs:301`
      ("client CANNOT write the CF-only public stream") still passes under default-deny.
- [x] 4.3 Split `gameMedia` `read` into `allow get: if true` and
      `allow list: if request.auth != null && request.auth.uid == ownerUid`. Confirm no client code
      calls `listAll`/`list` on Storage, and that the render path uses tokenized download URLs.
- [x] 4.4 Replace the participant-prefix `image/.*` with the positive allowlist
      `image/(jpeg|jpg|png|webp|heic|heif|gif)|audio/(webm|mp4|mpeg|ogg)`, after confirming
      `uploadTaskPhoto` hardcodes `image/jpeg` and `uploadTaskAudio` sends a normalized allowlisted
      type — the only two writers of that prefix.
- [x] 4.5 Add `&& !request.resource.contentType.matches('image/svg.*')` to the `gameMedia` write
      rule (keeping `(image|video)/.*`, because a creator picks arbitrary files).
- [x] 4.6 Add the documenting `match /{allPaths=**} { allow read, write: if false; }` catch-all and
      a comment block recording *why* the two legacy branches were removed.

## 5. GREEN — Storage rules test harness (written, not run)

- [x] 5.1 Create `scripts/test-storage-rules.mjs` in the house style of `scripts/test-rules.mjs`
      (`check(label, promise)` with `assertFails`/`assertSucceeds`, failure counter, non-zero exit),
      Storage-only test environment on `127.0.0.1:9199`.
- [x] 5.2 Cover write scoping, content limits (including SVG and an off-allowlist audio type), read
      privacy incl. cross-team `listAll`, staff run scoping, creator-media write isolation, the
      enumeration cases (`get` public / `list` owner-only), and the removed legacy prefixes.
- [x] 5.3 Add the `test:rules:storage` npm script.
- [ ] 5.4 **BLOCKED — run it.** `npm run test:rules:storage` against a free emulator. A live
      playtest stack owns this machine's emulator and must not be restarted, so this file is
      **WRITTEN BUT NEVER EXECUTED**. Nothing here may be reported as passing until this box is
      ticked.

## 6. REFACTOR / verification

- [ ] 6.1 **BLOCKED (emulator)** — `npm run test:rules` to confirm the pre-existing Storage
      assertions in the Firestore suite still pass under the tightened rules.
- [ ] 6.2 **BLOCKED (emulator)** — `npm run e2e`: exercises the real photo *and* audio upload
      (`scripts/e2e-verify.mjs:963` uploads `audio/webm`), which is the direct regression test for
      the content-type allowlist.
- [ ] 6.3 **PARENT DECISION** — wire `test:rules:storage` into `verify:emulator` once 5.4 and 6.1
      are green.
- [ ] 6.4 **FOLLOW-UP (ops)** — sweep objects already orphaned under `checkins/` in the real bucket.
      Closing the write path stops new ones; the existing ones need bucket access.
- [x] 6.5 Gates runnable without an emulator: `npx tsc --noEmit` (functions) and the functions
      vitest suite — both green. `npm run i18n:check` not applicable: no UI file is touched.
