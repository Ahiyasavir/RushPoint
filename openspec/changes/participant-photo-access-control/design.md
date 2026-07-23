# Design — participant photo access control (DECISION DOCUMENT)

> **Status: awaiting a product decision.** Nothing in this document has been implemented. It
> establishes the facts, states the gap against the published privacy copy, and presents four
> options with honest trade-offs and a recommendation. The recommendation is a recommendation — the
> call is the product owner's.

---

## 1. Established facts (verified by reading the code)

Everything in this section was read directly out of the tree at the cited line. Where a claim is an
inference rather than a direct read, it is labelled **INFERRED**.

### 1.1 Where a download URL is created

| # | Site | Evidence |
|---|---|---|
| F1 | play-web mints the tokenized URL after upload | `apps/play-web/src/services/firebase.ts:203` — `getDownloadURL(r)`; wrapped by `uploadResilient` (`:154-215`), called by `uploadTaskPhoto` (`:220-229`) and the audio sibling |
| F2 | creator-web mints one for authored task media | `apps/creator-web/src/services/firebase.ts:148` |
| F3 | The URL is passed to the server by the client | `apps/play-web/src/components/TaskRunner.tsx:491` and `:512` → `submitStationPhoto({ …, photoUrl })` |
| F4 | The server validates only the *path shape*, not the token | `functions/src/index.ts:1015-1017` → `requireStorageUrl(photoUrl, runId, uid, …)`; implementation `packages/shared/src/validation.ts:458-470` |

### 1.2 Where it is PERSISTED (this is the load-bearing fact)

A stored bearer URL is a permanent capability. It survives every later change to rules, sanitizers
and UI.

| # | Document | Evidence |
|---|---|---|
| F5 | **Team doc** — `…/runs/{runId}/teams/{teamId}.taskSubmissions[taskId].photoUrl` | written `functions/src/index.ts:1101-1115` (`photoUrl: photoUrl.trim()`); read back `:1215-1220`; typed `packages/shared/src/photoQueue.ts:29`, `:50` |
| F6 | **Feed doc** — `…/runs/{runId}/feedItems/{id}.photoUrl` | `writeFeedItem` `functions/src/index.ts:670-694` (`photoUrl: entry.photoUrl`, `:684`); emitted from the auto-approve path `:1135-1143` and the staff-review path `:1226-1234` |
| F7 | It is **not** written onto the per-task run record (`stages[].tasks[].photoUrl`) | `RunTaskRecord.photoUrl` exists in the type (`packages/shared/src/types/index.ts:782`) but **no** write of it exists in `functions/src` — a repo-wide grep for `photoUrl` in `functions/src` returns only `obs/log.ts`, `maintenance/index.ts` and the `index.ts` sites above; `verificationOutcome` appears **nowhere** in `functions/src` |

**Consequence of F7:** `buildRunRecap` (`packages/shared/src/runRecap.ts:68-79`) selects photos by
`rec.verificationOutcome === 'approved' \|\| 'correct'` **and** `rec.photoUrl` on those same task
records. Since neither field is ever written, `getRunRecap`
(`functions/src/runs/index.ts:1882-1929`) returns `photos: []` in practice, and the recap collage
(`apps/play-web/src/lib/recapCollage.ts:45`) has nothing to draw. The recap is therefore **not** a
live leak today — but it is a *latent* one: the moment anyone wires `photoUrl` onto the task record,
the recap surface starts emitting URLs to a published-run audience with no further review.
*(This matches the independent note in `docs/wave-g/hint-and-recap-fix.md:48-55`.)*

### 1.3 Who receives a URL today

| Recipient | Path | Evidence |
|---|---|---|
| The uploading participant | holds it from the upload itself | F1 |
| Their teammates (shared devices) | team-doc read | `firestore.rules:74-79` (`isOwner(teamId)` / `isAttachedDevice()`) |
| Run-scoped staff | team-doc read + review UI | `firestore.rules:77`; rendered `apps/play-web/src/screens/StaffConsole.tsx:394-406` |
| The run owner (creator) | team-doc read + review queue + feed panel | `firestore.rules:75`; rendered `apps/creator-web/src/pages/RunConsolePage.tsx:1290-1298` (an `<a href>` straight to the URL) and `:1420` |
| **Every other team in the run** | live feed docs | `firestore.rules:110-115` (`isRunParticipant`); rendered `apps/play-web/src/components/FeedPanel.tsx:186` |
| **Anyone holding a published `?board=<accessCode>` link** | `getPublicLeaderboard` → `ceremonyFeed[].photoUrl` | `functions/src/runs/index.ts:1839-1854`, `:1856-1876`; shape `packages/shared/src/ceremony.ts:9-40`; rendered `apps/play-web/src/screens/CeremonyScreen.tsx:137`; route `apps/play-web/src/App.tsx:175-180` |
| **Anyone the above forward the URL to** | the URL is a bearer token; rules are not consulted | `storage.rules:8-12` says so in its own comment |

### 1.4 Does a URL reach a world-readable document? — the key question

**No — and yes, depending on what "world-readable" is taken to mean. Both halves matter.**

- **Firestore world-readable documents are CLEAN.** The only `allow read: if true` collections are
  `publicGames` (`firestore.rules:192-195`) and `publicTasks` (`:205-208`). `publishGame`
  (`functions/src/games/index.ts:328`, `:710`) copies `coverImage` and a fixed safe subset; it never
  copies a team document, a feed item, or a `taskSubmissions` map. **Verified: no participant photo
  URL is written into `publicGames` or `publicTasks`.** (The `coverImage` it does copy is
  *creator-authored* media under `gameMedia/…`, deliberately public — `storage.rules:57-59`.)
- **But the published-leaderboard surface is effectively public and it does carry photo URLs.**
  `getPublicLeaderboard` requires only (a) any Firebase auth — play-web signs visitors in
  **anonymously** (`apps/play-web/src/App.tsx:58` → `ensureAuth()`), (b) the run's access code, which
  is the whole content of the shared `?board=<code>` link, and (c)
  `run.leaderboard.published === true`. Under those conditions it returns up to 20 `ceremonyFeed`
  items each carrying a permanent, unauthenticated `photoUrl`
  (`functions/src/runs/index.ts:1844-1854`). Since the board link is a link creators are told to
  share (TV screen, WhatsApp, social), **the practical audience of those photo URLs is "the public",
  even though no world-readable Firestore document is involved.** The Firestore-rules audit passes;
  the outcome is nonetheless public distribution.

  `pickCeremonyFeed` does drop `active:false` items (`packages/shared/src/ceremony.ts:29`), so a
  hidden photo stops appearing in *future* responses — but any URL already served stays valid.

### 1.5 Retention — does the prune actually cover the objects?

**Yes for the objects, with two real caveats.**

- The prune deletes the bytes: `pruneRunPII` calls
  `storage.bucket().deleteFiles({ prefix: runPhotoPrefix(runId) })`
  (`functions/src/maintenance/index.ts:135-144`), with the prefix derived by the hardened, unit-tested
  `runPhotoPrefix` (`functions/src/storagePaths.ts:29-31`). It also nulls the stored
  `taskSubmissions[*].photoUrl` (`:101-129`) and bulk-deletes `feedItems`
  (`PII_BULK_SUBCOLLECTIONS`, `:62-69`, deleted `:88-99`). Deleting the object **is** genuine
  revocation — an already-shared URL 404s from that moment.
- **Caveat 1 — abandoned runs are never pruned.** `sweepExpiredRuns` queries
  `status == 'finished'` AND `finishedAt < cutoff` (`functions/src/maintenance/index.ts:154-162`).
  `status:'finished'` is written only by `finalizeRun` (`functions/src/runs/index.ts:1535-1537`) and
  the all-teams-complete transitions (`:1017`, `:1140`). A creator who simply closes the tab leaves a
  run `live` forever, and its photos are retained forever. *(The scheduled sweep itself was verified
  clean by an earlier audit — `docs/wave-j/privacy-lifecycle.md:51-54`.)*
- **Caveat 2 — the window is 90 days, and until it elapses there is no revocation at all.**
  `hideFeedItem` (`functions/src/index.ts:826-850`) writes `active:false` and nothing else; the object
  and token survive. So "the organizer can remove your content"
  (Terms §5.5(e), `apps/creator-web/src/pages/LegalPage.tsx:832`) means *removed from the listing*,
  not *unreachable*.

### 1.6 A raw URL can be pasted into a share sheet

`sharePhoto` (`apps/play-web/src/lib/sharePhoto.ts:45-72`) tries to composite the photo onto a
branded canvas; on any load or `toBlob` failure it falls back to `shareUrlFallback` (`:38-43`), which
shares `caption + "\n" + photoUrl` — **the raw tokenized URL as text**. Reached from the finish
screen's "share a photo" button (`apps/play-web/src/screens/FinalScreen.tsx:104-120`, `:197-199`).

**INFERRED (not verified at runtime):** this fallback is likely to be the *common* path, not the rare
one. `loadImage` sets `img.crossOrigin = 'anonymous'`
(`apps/play-web/src/lib/brandWatermark.ts:10-18`), which requires the Storage response to carry CORS
headers; there is **no CORS configuration file in this repo** (a repo-wide glob for `cors*.json`
returns nothing), and a GCS bucket has no permissive CORS by default. If the bucket is unconfigured,
the cross-origin load fails, `loadImage` resolves `null`, and every "share a photo" tap forwards the
raw permanent URL. This should be confirmed against the real bucket before being treated as fact.

### 1.7 Storage rules are not the control here

`storage.rules:13-17` restricts *path* reads on `runs/{runId}/teams/{teamId}/**` to the owning
participant and run-scoped staff. Its own comment states the limitation plainly
(`storage.rules:8-12`): the owner and the recap/share surfaces "display photos via tokenized
getDownloadURL() links (which bypass Storage rules)". The hardening is real and worth keeping — it
stops path enumeration — but it is **not** a control over who can fetch a given photo.

---

## 2. Promises vs. behavior

Quoted from `apps/creator-web/src/pages/LegalPage.tsx`.

| Promise | Behavior | Verdict |
|---|---|---|
| Privacy Policy §3.4, `:309` (EN) / `:74` (HE): photos "are visible to the game's Creator and their designated staff for task review" | With the live feed on (default: on — `functions/src/index.ts:1040`, `game.photoFeedEnabled !== false`), approved photos also go to **every team in the run** (`firestore.rules:110-115`), and via `ceremonyFeed` to **anyone with a published board link** (§1.4) | **Gap.** The §3.4 bullet list enumerates an audience narrower than the system grants. The Terms §5.5(b) (`:826`) *does* disclose run-wide visibility, so the two documents describe different audiences; neither mentions link-holders. |
| Privacy Policy §7, `:385`: "Uploaded photos: auto-deleted 90 days after run completion" | True for finished runs (§1.5). **Not** true for runs never finalized — those never satisfy the sweep query and are retained indefinitely | **Gap**, narrow but factual. |
| Privacy Policy §7 participant-deletion clause, `:394`: a participant may request deletion of "photos they uploaded" | Achievable only by deleting the object (prune / game purge / account delete). No participant-facing mechanism exists, and any URL already forwarded is already out | **Partial.** The promise is a manual-process promise, which the copy is careful about; but the copy does not say that previously shared links cannot be recalled. |
| Terms §5.5(e), `:832`: creator and staff "may hide any photo at any time" | `hideFeedItem` (`functions/src/index.ts:826-850`) hides the *listing*. The object stays fetchable by URL | **Gap.** "Remove" reads stronger than what happens. |
| Privacy Policy §3.4, `:310`: "We do not publish participant photos to third parties" | RushPoint itself does not. But a published board link hands photo URLs to whoever opens it, and the share fallback (§1.6) pastes a permanent URL into WhatsApp | **Judgement call — flagged, not adjudicated.** Whether this counts as "publishing to a third party" is a legal question. |

**I am not a lawyer and this document does not rewrite legal copy.** These are factual
behavior-vs-text comparisons for the owner to take to counsel. Note also `LegalPage.tsx:313`: the
policy already assigns the Creator sole responsibility for photo collection compliance — which is a
contractual allocation, not a technical control, and is unlikely to help where minors are concerned.

---

## 3. The migration problem (applies to every option except A)

Every tokenized URL **already written** into a team document (F5) or a feed document (F6) is a live
capability. Changing how *new* URLs are minted retracts none of them.

Genuine retraction of an existing object requires one of:

1. **Delete the object.** Absolute, irreversible, and destroys the photo for legitimate users too.
2. **Rotate the object's download token** — rewrite the `firebaseStorageDownloadTokens` custom
   metadata. Every previously issued URL for that object dies instantly. Requires an Admin-SDK
   backfill over every object under `runs/**`, plus a matching rewrite of every persisted
   `photoUrl` field, or the product breaks for current users at the same moment.
3. **Delete the token entirely** (upload with no token) — future access must go through a signed
   URL or a proxy. Only viable for *new* uploads unless combined with (2).

Any option that claims revocation must budget for a **one-shot backfill job** over live production
data — and that job is destructive if it gets the prefix wrong, which is exactly the failure class
`functions/src/storagePaths.ts` was written to prevent (its header explains why a blank `runId`
widens `runs/{runId}/` to `runs/` and wipes the bucket). Reuse those helpers; do not hand-build
prefixes.

---

## 4. Options

### Option A — Keep tokenized URLs; shorten the window and close the public surface

Leave the architecture alone. Reduce `RUN_DATA_RETENTION_DAYS`, make the prune reach abandoned runs
(prune on `finishedAt` **or** last-activity age), stop `getPublicLeaderboard` returning
`ceremonyFeed` to non-owners (or gate it on an explicit per-game opt-in), and make `hideFeedItem`
delete the object rather than only flipping `active`.

- **Effort:** small — days. Touches `functions/src/runs/index.ts`, `functions/src/index.ts`,
  `functions/src/maintenance/index.ts`, shared constants. No client migration.
- **Breaks:** the public ceremony slideshow for non-owner viewers (a shipped feature —
  `apps/play-web/src/screens/CeremonyScreen.tsx`); a shorter window means photos vanish from
  organizers' consoles sooner than they expect.
- **Revokes an already-shared link?** **Only by deleting the object** — so: yes for a hidden feed
  item and at prune time, no otherwise. Between upload and prune, a leaked URL is permanent.
- **Migration:** none.
- **Honest read:** this is risk *reduction*, not a fix. It removes the worst distribution channel and
  shortens the exposure window, and it is the only option that ships in days.

### Option B — Never persist a URL; mint short-lived signed URLs on demand

Store the Storage **path** (`runs/{runId}/teams/{teamId}/…`) instead of the URL, upload with the
download token suppressed, and have the server mint a V4 signed URL (minutes-scale TTL) at every read
boundary that legitimately needs one: `getMyTeamState`, the photo-review queue, the feed read, the
ceremony feed, the recap.

- **Effort:** large — weeks. Every persisted-URL producer and consumer changes, plus the backfill of
  §3.
- **Breaks, concretely:**
  - **Realtime feed.** `FeedPanel` reads `feedItems` through a **Firestore listener**
    (`firestore.rules:110-115` exists precisely for that). A document containing a path, not a URL,
    cannot be rendered by `<img src>`; the feed must either move behind a polling callable (losing
    realtime) or mint URLs client-side per item (an extra round trip per photo).
  - **Offline caching.** play-web uses `persistentLocalCache` plus a service worker. A cached
    document then holds an **expired** signed URL, so previously-viewed photos render broken offline —
    a regression against the explicit offline-hardening goal in `CLAUDE.md`.
  - **Forwarded links.** Any URL a participant already shared to WhatsApp dies at TTL. That is the
    *point* of the option, and simultaneously a product regression for the sharing/virality loop
    (`sharePhoto`, the recap collage, the "share a photo" button at
    `apps/play-web/src/screens/FinalScreen.tsx:197`).
  - **Recap/story images rendered later.** `recapCollage.ts:45` and `sharePhoto.ts:48` load the photo
    into a canvas at share time. With a short TTL, a card composed even an hour after a page load
    fails and falls through to the URL fallback — which would now share a **soon-dead** link,
    arguably a worse user experience than today's permanent one.
  - **Every already-persisted URL** (F5, F6) keeps working, forever, unless the §3 backfill runs.
    Without the backfill, option B protects only photos uploaded after the deploy.
  - **CORS.** Signed URLs are still cross-origin; the `crossOrigin='anonymous'` canvas path (§1.6)
    needs a real bucket CORS configuration either way.
- **Revokes an already-shared link?** **Yes**, at TTL expiry — but only for objects whose legacy
  token was rotated or removed by the backfill.

### Option C — An authorizing proxy: every fetch goes through a callable/endpoint

An `onRequest` function (or callable returning bytes) that authenticates the caller, checks run
membership / staff / owner against the same predicates the rules use, and streams the object.

- **Effort:** large — weeks, plus permanent operational cost.
- **Breaks / costs, concretely:**
  - **`<img src>` cannot send an `Authorization` header.** Making images render therefore requires
    either a session cookie on the function's domain, or a short-lived token in the query string —
    at which point the query-string variant *is* Option B with worse egress economics.
  - **Every image byte flows through Cloud Functions egress**, billed and rate-limited, on a project
    whose payments are currently disabled (`free-mode`) — a real cost line for a photo-heavy event.
  - **Latency and cold starts** on a hot participant-facing path.
  - Offline caching, forwarded links and later-rendered recap cards break the same way as in B.
- **Revokes an already-shared link?** **Yes, immediately and completely** — this is the only option
  where "hide this photo" takes effect on the next fetch with no TTL wait. It is the strongest
  control and the most expensive one.

### Option D (recommended) — Staged: contain now, migrate deliberately

**Phase 1 (days, no client migration, no expiring links):**

1. **Stop the public escape.** `getPublicLeaderboard` no longer returns `ceremonyFeed` to non-owners;
   the ceremony slideshow becomes an owner/staff-authenticated surface (the TV screen is operated by
   the organizer, so this is close to the real use case), or requires an explicit per-game
   `ceremonyPhotosPublic` opt-in that is **off** by default and disclosed in the Builder.
2. **Make removal mean removal.** `hideFeedItem` (and the participant-deletion path) deletes the
   Storage object via the hardened `storagePaths` helpers, not just `active:false`.
3. **Make retention reachable.** Extend the sweep so a run that was never finalized is pruned on an
   age-since-last-activity basis; keep the `piiPrunedAt` idempotence guard.
4. **Stop pasting raw URLs into share sheets.** Drop `shareUrlFallback`'s URL text
   (`apps/play-web/src/lib/sharePhoto.ts:38-43`) in favour of a text-only branded caption, or fail the
   share, and configure bucket CORS so the branded-canvas path actually succeeds.
5. **Align the disclosure.** Take the §2 table to counsel and update §3.4 (or the behavior) so the
   two agree.

**Phase 2 (weeks, decided separately once Phase 1 has bought time):** the Option B migration —
paths-not-URLs, token suppression on upload, signed URLs at read boundaries, and the §3 backfill with
token rotation. Phase 1 deliberately leaves this door open by not persisting anything new that Phase 2
would have to undo.

- **Revokes an already-shared link?** Phase 1: **yes, wherever a human or the retention job acts** —
  hide, participant deletion request, run deletion and prune all delete the object, which is real
  revocation. It does **not** give automatic time-boxed revocation. Phase 2 adds that.
- **Breaks:** the public (non-organizer) ceremony slideshow, and the "share a photo" flow's URL
  fallback. Nothing else. No offline regression, no expiring links, no backfill in Phase 1.

---

## 5. Recommendation

**Take Option D.**

Reasoning:

1. **The severity is concentrated in one place, and it is cheap to close.** Of everything in §1.3,
   exactly one path turns "photos of minors visible to the event" into "photos of minors visible to
   the internet": `ceremonyFeed` on a publicly shared board link (§1.4). That is a handful of lines
   in `getPublicLeaderboard`. Spending weeks on a signed-URL migration while that path stays open
   would be optimising the wrong thing first.
2. **"Remove" currently does not remove, and that is both the most defensible fix and the most
   legally exposed gap.** A parent asking for a photo to be taken down should get deletion, not
   de-listing. Option D item 2 makes the Terms' own promise true, and object deletion is *stronger*
   revocation than any TTL.
3. **Option B's costs land on exactly the properties this product has invested in** — offline
   resilience, share-driven growth, later-rendered recap cards — and it protects *nothing* without
   the §3 backfill over live data. It is the right destination, and the wrong thing to start with.
4. **Option C is the strongest control and I do not recommend paying for it yet.** Proxying every
   image byte through Cloud Functions on a project running in free mode is a standing cost and a
   standing latency risk, to buy immediate revocation that Phase 1's delete-on-hide already
   approximates for the cases that actually arise.
5. **Phase 1 is reversible and buys the decision time Phase 2 needs.** Nothing in it forecloses B
   or C.

**Explicitly the owner's call, not mine.** Three judgements in here are product/legal, not
engineering: whether the public ceremony slideshow is worth keeping at all; whether 90 days is the
right window for images of minors (30 would be defensible and is one constant); and whether §3.4 of
the Privacy Policy should be corrected to match the system or the system constrained to match §3.4.
I have deliberately not decided any of them.

---

## 6. Test strategy (for whichever option is approved)

Named up front per repo rules, so the approved option starts RED.

- **Pure logic → `scripts/test-*.ts` or co-located vitest, no emulator.** Whatever selects the
  ceremony/recap payload gets a pure predicate (mirroring `shouldFeedTask`) asserting that a
  non-owner audience receives **zero** media references. Retention eligibility (`finished` vs
  abandoned-and-stale) becomes a pure `isRunPrunable(run, now)` with a table of cases. If Phase 2 is
  approved, path↔URL derivation and TTL computation are pure and unit-tested, alongside the existing
  `functions/src/storagePaths.test.ts`.
- **Callables → failing assertions in `scripts/e2e-verify.mjs` first.** A non-owner calling
  `getPublicLeaderboard` on a published run with feed items receives no `photoUrl` anywhere in the
  payload; `hideFeedItem` leaves the object unreadable through the Admin SDK; the prune reaches an
  abandoned run. Any **new** callable must appear in a scenario or the callable coverage guard fails
  the suite.
- **Rules → `npm run test:rules`.** Assert no widening of `feedItems` / team-doc read scope.
- **UI → preview verification + `npm run i18n:check`** (hard gate) and
  `npm run i18n:check:strict` for any new Builder disclosure copy — HE and EN both via `t.*`.
- **Sanitizer allowlist.** If any task/feed payload field is added or removed, update
  `ALLOWED_TASK_KEYS` / `ALLOWED_SMART_KEYS` in `scripts/e2e-verify.mjs` so the allowlist fails loud.

## 7. Open questions for the owner

1. Is the **public** ceremony slideshow a feature worth keeping, or is organizer-operated enough?
2. Is 90 days the right retention for images of minors, or should it be 30 — and should a creator be
   able to shorten it per game?
3. Should participants get a **self-service** "delete my photos" action, or does the documented
   email/organizer route stay?
4. Does §3.4 of the Privacy Policy get corrected, or does the behavior get constrained to match it?
   (Legal input required — do not let an engineer decide this.)
5. Is expiring-link behavior (Phase 2) acceptable to the sharing/virality strategy, or is that a
   product no?
