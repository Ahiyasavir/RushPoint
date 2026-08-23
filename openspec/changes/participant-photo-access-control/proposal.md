## Why

Participant photo and audio submissions are served to every surface in the product as
**tokenized Firebase `getDownloadURL()` links**. Such a link is a bearer capability: it is fetchable
by anyone who holds it, **unauthenticated, from anywhere, forever**, until the underlying Storage
object is deleted. Storage security rules are never consulted for a tokenized download URL — the
hardened `read` clauses in `storage.rules:13-17` constrain *path-based* access only.

This matters more here than in a generic photo app: RushPoint is marketed for bar/bat mitzvah events
and youth groups, so a large share of these images are **photographs of minors**, and the URLs are
designed to travel — through the live photo feed, the ceremony slideshow, the native share sheet,
and WhatsApp.

The audit that motivates this change established the following (file:line evidence in `design.md`):

- The tokenized URL is **persisted into Firestore**, in two places: the team document
  (`taskSubmissions[taskId].photoUrl`, written at `functions/src/index.ts:1101-1115`) and the
  run's live-feed documents (`feedItems/{id}.photoUrl`, written at `functions/src/index.ts:670-694`).
  A persisted bearer URL outlives any later rules change.
- **A public, shareable surface hands the URLs out.** `getPublicLeaderboard`
  (`functions/src/runs/index.ts:1814-1876`) returns `ceremonyFeed`, whose items carry `photoUrl`
  (`packages/shared/src/ceremony.ts:9-40`). That callable is reachable by **any** signed-in user —
  including play-web's anonymous users — who holds the run's access code, once the organizer
  publishes the board. The `?board=<accessCode>` link is a link creators are *encouraged* to share
  publicly (TV screen, social, WhatsApp). So a public link yields a JSON payload of permanent,
  unauthenticated photo URLs.
- **Moderation and deletion do not revoke anything.** `hideFeedItem`
  (`functions/src/index.ts:826-850`) only flips `active:false` in Firestore. The object and its token
  stay live. The only true revocation in the system is object deletion — the 90-day retention prune
  (`functions/src/maintenance/index.ts:135-144`), a game purge, or account deletion.
- **The 90-day prune only reaches finished runs.** `sweepExpiredRuns`
  (`functions/src/maintenance/index.ts:154-175`) queries `status == 'finished'` AND
  `finishedAt < cutoff`. `status:'finished'` is written only by `finalizeRun`
  (`functions/src/runs/index.ts:1535-1537`) and the all-teams-done paths (`:1017`, `:1140`). A run an
  organizer simply abandons is **never pruned**, so its photos — and their live URLs — are retained
  indefinitely.
- **The share path can leak the raw URL as text.** `sharePhoto`
  (`apps/play-web/src/lib/sharePhoto.ts:45-72`) composites the photo on a canvas; if the image cannot
  be loaded cross-origin (`crossOrigin='anonymous'`, `apps/play-web/src/lib/brandWatermark.ts:10-18`)
  or the canvas is tainted, it falls back to `shareUrlFallback`, which pastes the **raw tokenized
  URL** into the native share sheet / clipboard (`:38-43`).

The privacy policy tells participants something narrower than this. `LegalPage.tsx:309` (EN) /
`:74` (HE) states photos "are visible to the game's Creator and their designated staff for task
review". The system's actual audience is larger — every team in the run (which the *Terms*, §5.5(b)
at `LegalPage.tsx:826`, does disclose) and, via the mechanism above, anyone holding a link.

**This proposal does not pick a fix.** It is a decision document: `design.md` lays out the options
with their real costs and what each one breaks, and makes a recommendation. **No option is approved
and no production code, rule, or UI is changed by this change until the product owner chooses.**

## What Changes

Once an option is chosen, the observable capability is:

**A participant's uploaded photo or audio is reachable only by an audience the product intends, and
that reach can be withdrawn.** Concretely, the capability has four parts:

1. **Bounded audience.** A submission is reachable by the uploading team, run-scoped staff, the run
   owner, and — only where the game has opted into it — other teams in the same run. It is not
   reachable by an arbitrary holder of a shared public link.
2. **Withdrawable.** Hiding a feed item, honouring a participant deletion request, or a creator
   removing a run withdraws access to the media, not merely its listing.
3. **Bounded lifetime.** Media has a retention deadline that is actually reached, including for runs
   that were never finalized.
4. **Truthful disclosure.** The privacy copy describes the audience the system actually grants.

## Non-goals

- **No** decision is made here. This change is assessment + design; implementation is gated on the
  product owner's choice among the options in `design.md`.
- **No** rewriting of legal copy. The gap between §3.4 of the Privacy Policy and the system's real
  behavior is *reported* here; whether the copy or the behavior moves is a decision for the owner
  with legal advice, not for an engineer.
- **No** change to `storage.rules` (a separate hardening change owns that file), to
  `firestore.rules`, or to the participant sanitizer.
- **No** content moderation, image classification, or face detection. Out of scope.
- **No** change to who may *upload*, to the upload resiliency pipeline, or to the photo review /
  approval flow's scoring semantics.
- **No** removal of the live photo feed or the ceremony slideshow as features.

## Capabilities

### New Capabilities

- `participant-photo-access-control`: participant-uploaded media is served through an access path
  whose audience is bounded and revocable, its lifetime is enforced for every run (not only
  finalized ones), and the published privacy disclosure matches the audience actually granted.

### Modified Capabilities

<!-- None yet. The affected behavior lives in `live-photo-feed`, `ceremony-mode` and `run-recap`,
     none of which have living requirement contracts in `openspec/specs/` that this change amends
     today. Whichever option is approved may add MODIFIED sections at that point. -->

## Impact

- **Surfaces implicated** (none touched by this change itself):
  - `functions/` — `submitStationPhoto`, `reviewStationSubmission`, `writeFeedItem`, `hideFeedItem`
    (`functions/src/index.ts`); `getPublicLeaderboard`, `getRunRecap` (`functions/src/runs/index.ts`);
    `pruneRunPII` / `sweepExpiredRuns` (`functions/src/maintenance/index.ts`).
  - `packages/shared` — `ceremony.ts`, `runRecap.ts`, `photoQueue.ts`, `types/index.ts`.
  - `apps/play-web` — `FeedPanel`, `CeremonyScreen`, `FinalScreen`, `RunRecap`, `StaffConsole`,
    `lib/sharePhoto.ts`, `lib/recapCollage.ts`, `services/firebase.ts`.
  - `apps/creator-web` — `RunConsolePage` (photo review queue + feed panel), `LegalPage`.
- **New/changed callable:** option-dependent. Options B and C both introduce at least one new
  callable, which under the repo's rules drives a typed wrapper in `services/calls.ts` **and**
  mandatory `scripts/e2e-verify.mjs` coverage (the callable coverage guard fails the suite for any
  callable never invoked).
- **Migration:** every option except (A) must contend with tokenized URLs **already persisted** in
  existing team and feed documents. Changing how new URLs are minted does not retract old ones — see
  `design.md` § "The migration problem".
- **Risk:** the risk of *acting* is broken sharing, broken offline rendering and a backfill over live
  data. The risk of *not acting* is an unbounded, unrevocable distribution channel for images of
  minors. Both are real; that is why this is a decision document.
