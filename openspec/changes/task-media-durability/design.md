## Context

`normalizeTaskMedia` is a *pure* trust boundary shared by the Builder (instant feedback)
and the server (`createGame`/`updateGame` enforcement). It was written as a filter: take
arbitrary client input, return only the entries that pass. That is the right shape for
input the client just invented, and the wrong shape for input the server itself accepted
and persisted last week — because the same call site sees both, and cannot tell them apart.

Every Builder autosave sends the WHOLE `stages` array, so every stored media entry is
re-validated against the CURRENT process env on every keystroke-triggered save. The accept
predicate is therefore not a property of the data; it is a property of whichever runtime
happens to be saving. When the two disagree, the filter deletes real content and reports
success.

## Goals / Non-Goals

**Goals**
- A picture a creator successfully attached can never be removed by a later save.
- A save that would have dropped a NEW bad URL fails loudly instead of succeeding quietly.
- The accept-set survives a missing/renamed env var and a domain change.
- A duplicated or translated game owns its own media bytes.
- Media is authored where the description is authored.

**Non-Goals**
- Widening the accept-set to arbitrary origins. The stored-XSS / hotlink guard stays.
- Retro-validating existing data on read. Reads stay untouched.

## Decisions

### D1 — Validate the DELTA, not the document

`normalizeStagesMedia(stages, storedStages)` compares each task's incoming media against
what is already persisted for that task id.

- URL present in the stored task's `media` ⇒ **kept unconditionally** (still normalized
  for shape: id, caption trim, YouTube canonicalization).
- URL absent from stored ⇒ must pass the accept-set, else the whole save is refused with
  `invalid-argument` naming the offending URL.

*Alternative rejected — reject any unrecognised URL, stored or not.* Every game already
holding a drifted URL would have every autosave refused, with no way for the creator to
comply. That is precisely the failure mode `builder-clear-optional-field` was written to
fix; repeating it would be worse than the bug.

*Alternative rejected — keep dropping silently but log.* The creator still loses the
picture; a log nobody reads is not a fix.

The comparison key is the raw `url` string. Not the object path: the whole problem is that
path extraction fails for a drifted URL, so a key that depends on extraction succeeding
cannot recognise the entries that need protecting.

### D2 — `normalizeTaskMediaDetailed` beside `normalizeTaskMedia`

The existing `normalizeTaskMedia(input, opts)` keeps its exact signature and behaviour and
delegates to the new `normalizeTaskMediaDetailed(input, opts, keepUrls?) → { media, rejected }`.
No existing call site changes behaviour by omission — the callable-hardening doctrine in
this repo is that a guard must never weaken because a caller forgot an argument.

`keepUrls` is a `ReadonlySet<string>` rather than a boolean flag, so the "which URLs are
grandfathered" decision lives with the caller that actually knows the stored document, and
the pure module stays free of Firestore concepts.

### D3 — Canonical origins in shared, unioned with env

`RUSHPOINT_UPLOAD_ORIGINS = ['https://api.rush-point.com']` lives next to
`FIREBASE_STORAGE_ORIGINS` in `validation.ts`. `storageOriginOpts()` unions it with
`VPS_UPLOAD_ORIGIN`, so `vpsOrigin` becomes `vpsOrigins: string[]`.

The `http://` form of a **known** host is accepted for path extraction only. This is not a
widening of trust: the host set is a compiled-in constant, and an attacker who can serve
`http://api.rush-point.com` already owns the origin. It exists so a URL minted by the
`req.protocol` fallback is understood rather than destroyed.

`functions/server.js` prefers `VPS_UPLOAD_ORIGIN`, then the canonical origin, and only then
the request-derived fallback — and that fallback now reads `x-forwarded-proto` so a
proxied request cannot mint mixed content.

### D4 — Copy bytes, then rewrite URLs, then write the doc

`copyGameMedia(srcOwnerUid, srcGameId, destOwnerUid, destGameId)` mirrors `deleteGameMedia`:
Storage bucket via `getFiles({prefix})` + `file.copy()`, and the VPS disk via `fs.cp`, both
best-effort and logged rather than thrown, with prefixes built through `gameMediaPrefix`
so a blank id still throws instead of widening.

`rewriteStagesMedia(stages, mapping)` is pure and lives in shared beside the other media
helpers, so `duplicateGame`, `translateGame` and `createGame`'s draft migration all use one
implementation and a unit test can drive it without an emulator.

Order matters: copy first, rewrite second, write the document last. A failed copy therefore
leaves the duplicate pointing at the original — degraded but working — rather than at a
path with nothing behind it.

### D5 — Media leaves the opt-in group set entirely

`'media'` is removed from `OPT_IN_GROUP_KEYS` rather than merely being rendered elsewhere.
Leaving it in the registry would keep `clearGroupPatch('media')` reachable from a chip that
no longer exists and keep `groupHasContent('media')` in a completeness contract that no
longer describes the UI. One place, one truth.

### D6 — The upload commit must not close over a stale task

`onPickFile` awaits a multi-second upload and then writes `{...task, media:[...media, new]}`
using the `task` from the render that started the upload. `MediaSection` gets a ref holding
the latest task and computes its commit from that, so a slow upload can neither revert
concurrent edits nor lose a parallel upload.

## Risks / Trade-offs

- **A genuinely malicious URL that is already stored stays stored.** Accepted: it could only
  have been stored by passing the accept-set at write time, and reads are unchanged. The
  alternative destroys real creator content on every accept-set change.
- **`copyGameMedia` doubles storage for a duplicate.** Accepted and intended — independence
  is the point. Purging either game now only removes its own bytes.
- **A large game duplicates many objects.** Copies are sequential and logged, matching
  `deleteRunsPhotos`' existing shape; a failure degrades rather than aborts.

## Test Strategy

Pure lane (`npm test`, auto-discovered):
- `scripts/test-task-media-durability.ts` — the D1 delta rule (stored URL survives a
  runtime whose accept-set rejects it; a NEW bad URL is rejected, not dropped; a stored
  YouTube entry is still canonicalized), the D3 origin union (canonical origin accepted
  with the env var unset; `http://` known host accepted; arbitrary origin still refused in
  every mode), and `rewriteStagesMedia`'s mapping (image/video rewritten, YouTube untouched,
  unknown URL left alone).
- `scripts/test-task-opt-in-groups.ts` — updated for D5.
- `scripts/test-task-media.ts` — existing assertions must stay green.

E2E lane (`npm run e2e`): upload-shaped media → two autosaves → media still present;
duplicate → URLs under the NEW gameId; purge the original → the duplicate still resolves.

UI: verified through the preview tools; `npm run i18n:check:strict` must stay clean.
