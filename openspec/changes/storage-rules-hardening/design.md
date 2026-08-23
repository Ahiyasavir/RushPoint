## Context

`storage.rules` (51 lines before this change) governs four prefixes. Everything below was verified
by reading the file, both client upload paths, the server validators, and every deletion path.

**What was already correct** — recorded so it is not re-litigated:

- **Write scoping on the participant prefix is sound.** `runs/{runId}/teams/{teamId}/**` requires
  `request.auth.uid == teamId`, and `teamId == uid` platform-wide (`play-web` is anonymous auth,
  uid == teamId). A participant cannot write into another team's folder. Covered by an existing
  assertion in `scripts/test-rules.mjs:298`.
- **Read scoping on the participant prefix is sound and deliberate.** Only the owning participant
  and staff whose token carries `runId == {runId}` may read. Staff of run A cannot read run B
  (`scripts/test-rules.mjs:310`). Anonymous read is denied (`:311`).
- **The server binds the uploaded object to the uploader.** `submitStationPhoto`
  (`functions/src/index.ts:1015`) runs `requireStorageUrl(photoUrl, runId, uid, …)`, which extracts
  the object path from the URL and demands the prefix `runs/{runId}/teams/{uid}/`
  (`packages/shared/src/validation.ts:465-471`). Even if a client uploaded somewhere unexpected, it
  cannot attribute the object to another team's submission.
- **Purge covers Storage.** `purgeGameTree` (`functions/src/games/index.ts:379-408`) deletes every
  run's uploads *before* the Firestore tree holding the runIds disappears (`:389-390`) **and** the
  game's authored media (`:393`) — the historical `gameMedia` leak is genuinely fixed, not just
  documented. `deleteMyAccount` (`functions/src/users/index.ts:140-149`) does the same for the whole
  account.
- **Retention covers Storage, not only Firestore.** `pruneRunPII` deletes the run's Storage prefix
  (`functions/src/maintenance/index.ts:134-141`) alongside the PII subcollections, and stamps
  `piiPrunedAt` so the sweep is idempotent. Audio clips live under the same prefix, so they are
  covered by the same delete.
- **Cross-creator isolation on media writes is sound.** `gameMedia/{ownerUid}/**` requires
  `uid == ownerUid`; a participant's anonymous uid can never equal a creator's uid.
- **Size caps exist in the rules**, not only the client: 10 MB participant, 50 MB creator.

**Accepted, documented property (not a defect to fix here):** legitimate display of a participant
photo — creator run console, recap, share cards — uses the **tokenized `getDownloadURL()` link**
stored in Firestore. That token bypasses Storage rules entirely: **anyone who obtains the URL can
fetch the object, forever, unauthenticated.** Stated plainly because photos of minors are involved:
the rules restrict *path-based* access, not *link-based* access. The mitigations that do exist are
(a) the link is only ever exposed to the run's own staff/creator surfaces and the live photo feed,
(b) `pruneRunPII` deletes the object itself after the retention window, which invalidates the link.
Replacing tokens with short-lived signed URLs minted by a callable is the real fix and is
deliberately out of scope.

**The two confirmed holes** and the latent prefix-widening hazard are described in `proposal.md`.

## Goals / Non-Goals

**Goals**
- Remove every prefix the rules grant that no code uses.
- Make a tenant's object tree non-enumerable by anyone else.
- Keep size + content-type enforcement in the rules and drop stored active content.
- Make the delete-prefix derivation incapable of widening.
- Give Storage its own rules test file.

**Non-Goals**
- Signed/expiring URLs replacing download tokens.
- Per-uid upload quotas (not expressible in Storage rules).
- Sweeping objects already orphaned under `checkins/`.
- Any change to `scripts/test-rules.mjs`, `firestore.rules`, or product code.

## Decisions

**D1 — Delete `checkins/**` rather than tighten it.** A prefix with no reader, no writer, and no
cleanup path has no correct rule other than deny. Tightening it (e.g. adding a size cap) would keep
an unowned, uncleanable write surface alive. Removal is also the strictest option, which matters
because the rules cannot be executed here.

**D2 — Delete `stream/**` for the same reason.** It grants read to every authenticated user on a
prefix nothing writes. Keeping it means the *next* feature that writes there inherits
"world-readable to any anonymous participant" silently. `scripts/test-rules.mjs:301` asserts a
client cannot *write* `stream/` — that assertion still passes after removal, because the default is
deny. This was checked specifically so the other agent's suite is not broken.

**D3 — Split `read` into `get` + `list` on `gameMedia`, rather than requiring auth for `get`.**
The enumeration is the hole; the per-object `get` is not (names carry a millisecond timestamp, and
the real render path uses a token URL that bypasses rules regardless). Keeping `get: if true`
guarantees zero render regression even in code paths not yet written, while `list` — owner-only —
closes the harvest-uids-then-enumerate attack. Verified there is **no** `listAll` / storage `list`
call anywhere in `apps/creator-web` or `apps/play-web`, so owner-only list removes nothing in use.

**D4 — Positive content-type allowlist on the participant prefix; negative SVG exclusion on the
creator prefix.** RE2 in Storage rules has no negative lookahead, so "anything but SVG" must be
either a positive list or a second negated `matches()`. The participant prefix has exactly two
writers with hardcoded/normalized types, so a positive list is provably safe there. The creator
prefix passes `file.type` straight through from a file picker with `accept="image/*,video/*"`, so a
positive list there *would* break real uploads (`image/avif`, `video/quicktime`, …) — hence the
narrow negated clause. The exclusion is written `image/svg.*`, not an exact `image/svg+xml`, so a
parameterized `image/svg+xml; charset=utf-8` cannot slip past.

**D5 — Prefix derivation becomes a pure module in `functions/src`, not in `packages/shared`.**
It is server-only, and keeping it out of `shared` avoids a `shared:build` dependency (which is
serialized elsewhere and cannot be run here). The functions vitest lane runs it with no emulator.

**D6 — A blank id throws; the whole-creator-tree purge stays reachable only via an omitted
`gameId`.** `deleteGameMedia(uid)` (account deletion) must still purge everything, so `undefined`
means "whole tree" — but `''` throws, because a bug that turns a one-game purge into an
account-wide purge is silent and irreversible. The throw happens **inside** the existing
`try/catch`, so the best-effort contract ("a failure is logged, never aborts the surrounding
delete") is preserved exactly: a refused id logs and skips instead of issuing a widened delete.

**D7 — New test file rather than extending `scripts/test-rules.mjs`.** That file is owned by
another lane in this session and must not be edited. A separate `scripts/test-storage-rules.mjs`
with its own npm script also gives Storage a home that can grow without colliding with the
Firestore suite. Wiring it into `verify:emulator` is intentionally left to the parent, because it
cannot be executed here to prove it is green.

**D8 — Every unverifiable choice resolves strict.** The rules cannot be executed in this session
(a live playtest stack owns the emulator). So no rule was loosened to make an unrun assertion pass,
and each tightening was justified against the actual client call site instead.

## Risks / Trade-offs

- **SVG task media stops working.** Accepted: no evidence any creator uses it, and it is the one
  image type that carries executable content. Reverting is one clause.
- **`allow list` semantics on a `{allPaths=**}` match could not be executed.** Firebase's own
  documented pattern (`match /images/{userId}/{allImages=**} { allow list: … }`) implies list at the
  prefix is governed by this rule; if it is *not*, list was already denied and the change is inert.
  Either way the change is ≤ the current permission set and cannot break `get`.
- **The explicit catch-all `match /{allPaths=**}`** grants nothing — Storage unions allow results,
  and `if false` contributes none. It exists to document intent.
- **The orphaned objects already sitting under `checkins/`** remain in the bucket. Called out in the
  proposal as follow-up operational work rather than silently ignored.

## Test Strategy

**Pure lane (executed here, no emulator) — `functions/src/storagePaths.test.ts` via vitest:**
- `runPhotoPrefix` returns `runs/{runId}/` with a mandatory trailing slash (without it, prefix
  `runs/run-1` also matches `runs/run-10`).
- Blank / whitespace / `undefined` / `null` ids **throw** rather than widening.
- Ids containing `/` throw (prefix escape).
- `gameMediaPrefix(owner, game)` is game-scoped; `gameMediaPrefix(owner)` is the whole tree;
  `gameMediaPrefix(owner, '')` **throws** and is not silently the whole tree.
- `gamePurgePrefixes` covers every run's uploads *and* the authored media, de-duplicates runIds,
  still returns the media prefix for a game with zero runs (the known leak class), and never returns
  a root-ish prefix (every result has ≥ 2 non-empty segments).

**Rules lane (WRITTEN, NOT RUN) — `scripts/test-storage-rules.mjs`:**
- Write scoping: own team folder succeeds (jpeg + audio); another team's folder fails; anonymous
  (signed-out) fails.
- Content limits: `text/plain` fails, `image/svg+xml` fails on both prefixes, `audio/wav` (outside
  the allowlist) fails, > 10 MB fails.
- Read privacy: own photo reads; another team's photo does not; another team cannot *list* the
  folder; run-scoped staff read their run; staff of a different run do not; anonymous does not.
- Creator media: owner writes; another creator cannot; a participant cannot overwrite; SVG fails;
  anyone may `get` an exact path (render path preserved); a stranger and an anonymous client cannot
  `listAll` the tree; the owner can.
- Removed prefixes: `checkins/**` and `stream/**` deny read and write; an unmatched top-level path
  denies.

**Not run here, and why:** a live playtest/dev stack owns this machine's emulator (Firestore 8080,
Storage 9199, Vite 5180/5181). Starting or restarting an emulator, or running `test:rules`, `e2e`,
`verify:emulator`, `simulate` or `playtest`, was forbidden for this work. `npm run typecheck`
(functions) and the functions vitest suite were run and are green.
