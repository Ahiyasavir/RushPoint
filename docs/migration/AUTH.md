# Auth — keep Firebase, or migrate to Supabase Auth?

> **Scope:** the authentication/identity layer only. Datastore migration is governed by
> [MIGRATION_PLAN.md](../../MIGRATION_PLAN.md); the client-listener question is answered in the
> companion `REALTIME_AND_OFFLINE.md`, which this document has a hard dependency on (§5.4).
> **Target deployment assumed throughout:** **self-hosted Supabase on the IONOS box**, with a Node
> backend holding the Postgres **service role**. Supabase Cloud Pro is treated as a fallback only.

---

## 0. Verdict

**KEEP Firebase Auth. Do not migrate any of the three mechanisms. Bridge to Postgres with a
self-hosted token-exchange endpoint, and only if direct client reads survive the realtime
redesign.**

**Confidence: HIGH (~85%).** The 15% is not "Supabase Auth might be better" — it is "the exchange
endpoint may turn out to be unnecessary entirely," which makes the recommendation *more* correct,
not less.

Against the owner's stated bar — *"keep in Firebase whatever is not limiting me from moving to
IONOS"* — all three mechanisms pass trivially: Firebase Auth's only billing dimension is MAU, so it
cannot participate in the uncapped-spend runaway that motivates this migration. Migrating it buys
nothing the migration is for, and costs a week plus the one irreversible risk in the whole project
(see §7).

---

## 1. Inventory — the three mechanisms, as actually built

| # | Mechanism | Where it is established | Where the identity is *consumed* | Durable beyond a session? |
|---|---|---|---|---|
| 1 | **Anonymous participants**, `uid == teamId` | `apps/play-web/src/services/firebase.ts:142-160` (`ensureAuth` → `signInAnonymously`) | Team doc id (`functions/src/runs/index.ts:428, 514-516`), `deviceUids`/`controllerUid`/`devices[]` (`:532-535`), `chat/{teamId}`, `firestore.rules:74-79, 308-312`, `storage.rules:13-17`, every leaderboard row (`runs/index.ts:1568, 1608, 1626`) | **YES — `players/{uid}`** (`runs/index.ts:1159, 2533`; `firestore.rules:245-248`) |
| 2 | **Creator email/password + Google** | `apps/creator-web/src/services/firebase.ts:196-241` (+ account mgmt `:243-380`) | `users/{ownerUid}/**` is the entire multi-tenant root; `firestore.rules:30-32, 281-283`; `storage.rules:60-62` (`gameMedia/{ownerUid}`) | YES — real accounts, real data |
| 3 | **Staff one-time PIN → custom token** | `inviteStaff` `functions/src/index.ts:130-163`; `staffSignIn` `:166-281`, token minted `:260-274` | `firestore.rules:315-321` (`isStaffForRun`), `storage.rules:14-17`, server-side `functions/src/index.ts:457-458` and `functions/src/runs/index.ts:4741-4742`; client `play-web/src/services/firebase.ts:163-165` ← `StaffConsole.tsx:112` | NO — PIN is single-use and consumed transactionally (`index.ts:242-253`) |

### 1.1 Correction to the brief: participant identity *does* outlive the run

The brief assumed participants are "anonymous and ephemeral (per-run), so they likely need
nothing." That is true of the **team** row but **false of the player**.

`recordPlayerResult` (`functions/src/runs/index.ts:1155-1159`) writes `players/{uid}` — cross-run
lifetime stats and earned badges — and `getMyProfile` (`:2530-2536`) reads it back on a later
device/session. `firestore.rules:245-248` scopes it to `isOwner(uid)`.

So a provider change for participants is **silent, unreconcilable data loss**: the new UUID has no
link to the old row, and an anonymous user has no email to reconcile on. Nothing errors; every
returning player's badge shelf is just empty forever. This is the single strongest code-grounded
argument in this document and it was not in the original framing.

### 1.2 The staff-token claim set, verbatim

`functions/src/index.ts:260-274` mints claims `staff: true`, `staffName`, `permissions[]`,
`ownerUid`, `gameId`, `runId` onto the caller's **existing anonymous uid** (`context.auth!.uid`) —
i.e. the staffer first signs in anonymously like a participant, then upgrades in place. Note the
comment at `:264-269`: `staffName` is **attribution, not authorization**. Only
`permissions`/`ownerUid`/`gameId`/`runId` gate anything.

---

## 2. The `unify-email-google-login` fix — what it solved, and why it will bite a naive migration

**The code** (`apps/creator-web/src/services/firebase.ts:196-218`, helper
`src/services/authClaims.ts`):

```ts
const googleCredential = GoogleAuthProvider.credential(claims);
return signInWithCredential(auth, googleCredential);   // firebase.ts:216-217
```

**What it solved.** In an emulator/playtest build `auth` is wired to the Auth Emulator, so
`signInWithPopup` shows the emulator's fake widget instead of the real Google chooser. The app
therefore opens the chooser on a **second, never-emulated** app instance (`:190-193`) and bridges
the resulting identity back in. The *earlier* bridge did this with a deterministic synthetic
email+password — which collided with an account the creator had already registered by
email+password: `auth/email-already-in-use`, or worse, a **second account with a different uid**.
A different uid means a different `users/{ownerUid}` root, so the creator signs in with Google and
finds **an empty console** — every game, run, wallet and gallery row still sitting under the old
uid. The fix bridges a real **Google credential**, which the emulator links onto the existing
account, preserving the uid (`:213-215` comment).

**The invariant, stated plainly:** *one email address == one uid, forever, regardless of which
provider the creator happens to click.* The repo defends it in three more places —
`linkGoogleToAccount` refuses a mismatched Google email and **rolls the link back**
(`:328-380`), `checkGoogleLinkEmail`/`needsRollback` in `lib/signInMethods.ts`, and
`addPasswordToAccount` (`:308-313`) links rather than replaces.

**Why a naive Supabase migration reintroduces exactly this bug.** Supabase *does* auto-link an
OAuth identity to an existing account with the same email — **but only if that existing account's
email is confirmed**; linking to an unconfirmed email is explicitly refused as a pre-account-takeover
risk ([identity linking docs](https://supabase.com/docs/guides/auth/auth-identity-linking)). Users
imported from Firebase land in `auth.users` with whatever `email_confirmed_at` the import script
sets — and Firebase's `emailVerified` is `false` for most password creators who never clicked a
verification mail. **Those creators get a second Supabase user on their first Google sign-in, with a
new UUID, and an empty console** — the identical failure, with a worse blast radius (Postgres FKs on
`owner_uid`, not just a document path). Any migration must therefore force
`email_confirmed_at` on import, which is itself a security decision someone has to sign off on.

---

## 3. What Supabase Auth actually offers, per mechanism

| Mechanism | Supabase equivalent | Assessment |
|---|---|---|
| Anonymous participants | `signInAnonymously()` — creates a **real, permanent row in `auth.users`** with a durable UUID and an `is_anonymous` JWT claim usable in RLS ([docs](https://supabase.com/docs/guides/auth/auth-anonymous)) | **Durable: yes.** Same practical caveat as Firebase — the user cannot sign back in after sign-out / cleared storage / another device. Two operational deltas: **no automatic cleanup** of anonymous users (manual SQL, docs suggest a 30-day sweep) and **captcha/Turnstile strongly recommended**, because the endpoint writes a row per call and inflates your own database. On a fixed-size $8 box, "attacker inflates your DB" is a *capacity* problem where Firebase's was a *billing* problem — different failure, not obviously better. |
| Creator email/password + Google | `signInWithPassword` + `signInWithOAuth` + `linkIdentity()` | Feature-complete. The cost is not features, it is **password hashes** (§6.2) and the linking trap (§2). |
| Staff PIN → custom token | **No `createCustomToken` equivalent.** You mint the JWT yourself against `JWT_SECRET` | See §4 — this is the *easiest* of the three, not the hardest. Alternatively a [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook) (a Postgres function that injects claims at issue time), but that reads run scope from the DB rather than from an invite consumption — a worse fit. |

---

## 4. Assessing "staff custom tokens are the most Firebase-specific piece"

**Verdict: FALSE.** It is the piece with the cleanest one-line replacement.

A custom token is nothing but *"the server asserts an identity plus claims."* On self-hosted
Supabase we own `JWT_SECRET`, and HS256 remains a supported signing algorithm
([JWT docs](https://supabase.com/docs/guides/auth/jwts)), so `staffSignIn`'s
`admin.auth().createCustomToken(uid, {...})` (`functions/src/index.ts:260-274`) becomes:

```ts
jwt.sign({ sub: uid, role: 'authenticated', aud: 'authenticated',
           staff: true, ownerUid, gameId, runId, permissions, exp }, JWT_SECRET);
```

Every claim survives verbatim. `isStaffForRun` (`firestore.rules:315-321`) translates directly to
`auth.jwt()->>'ownerUid'` etc. All the genuinely hard parts of `staffSignIn` — the two-tier
brute-force throttle (`:183-232`), the transactional single-use PIN consume (`:242-253`) — are
**our own Firestore logic and are provider-agnostic**; they move with the datastore migration
whatever we decide here.

The actually Firebase-specific pieces, ranked:

1. **The creator Google/account-unification semantics** (§2) — behaviour we depend on, only partly
   reproducible, and the one with real user-visible data attached.
2. **The client SDK session lifecycle** — `onAuthStateChanged`, silent refresh, the
   restored-session-vs-new-anonymous-user discipline in `ensureAuth` (`play-web/src/services/firebase.ts:141-160`,
   note the comment: a reload must not clobber a restored staff session), and the emulator/tunnel
   popup bridge.
3. Staff custom tokens — a distant third.

---

## 5. The hybrid: Firebase Auth + self-hosted Supabase data

### 5.1 Two ways to make Postgres trust a Firebase identity

**H-A — Supabase Third-Party Auth.** Register the Firebase project; the client passes
`getIdToken()` to `supabase-js` via `accessToken`; Supabase verifies via the issuer's JWKS
([overview](https://supabase.com/docs/guides/auth/third-party/overview),
[Firebase guide](https://supabase.com/docs/guides/auth/third-party/firebase-auth)). Real, supported,
GA. Four concrete frictions:

- **Every user must carry a `role: 'authenticated'` custom claim.** Firebase JWTs do not have one,
  and without it Supabase applies the `anon` role. The docs' easiest route is a **blocking
  function (`beforeUserSignedIn`), which requires Firebase Authentication *with Identity
  Platform***; otherwise it is `onCreate` + `setCustomUserClaims` + a forced token refresh — the
  docs warn this is not synchronous. For **anonymous participants that is a race on the very first
  join**, on a phone, in a field, at the start of a timed event. That is precisely the moment the
  product cannot afford a retry loop.
- **Third-Party MAU is a billed line item** on Cloud ($0.00325/MAU past quota). Irrelevant at our
  volume, but it re-introduces a per-user meter into a migration whose entire purpose is removing
  meters.
- **Cross-project trust.** Firebase uses shared signing keys across projects, so the docs require
  **restrictive RLS on every public table, Storage bucket and Realtime channel** pinning
  `iss`/`aud` to our project. That is an easy thing to forget on table #40 — a real footgun on
  self-hosted specifically.
- **`auth.uid()` breaks.** It casts `sub` to `uuid`; Firebase uids are 28-char strings. See §5.3.

**H-B — token exchange at our own backend. ← RECOMMENDED.**

```
play-web / creator-web
   │  Firebase ID token (already held; already refreshed by the SDK)
   ▼
Node backend on IONOS  ──  admin.auth().verifyIdToken(idToken)      [already a dependency]
   │                       jwt.sign({ sub, role, aud, exp, ...staffClaims }, JWT_SECRET)
   ▼
short-lived Supabase JWT ──► supabase-js `accessToken` ──► PostgREST / Realtime / Storage
```

Because we self-host, `JWT_SECRET` is **ours** — the thing that makes this awkward on a managed
platform is simply absent. H-B dissolves every one of H-A's four frictions: we set `role`
ourselves (no Identity Platform, no claim race), there is no MAU meter, the issuer is us so there
is no cross-project trust surface, and we control the id helper.

### 5.2 Cost of H-B, in engineering days

| Work | Days |
|---|---|
| `POST /auth/supabase-token`: verify Firebase ID token, mint HS256 JWT, copy staff claims through | 0.5 |
| Client wiring: one `accessToken` callback per app **with an expiry-aware cache** (see risk (a)) | 0.5 |
| `rp_uid()` SQL helper + RLS policies written against it instead of `auth.uid()` | 0.25 |
| Tests: a `scripts/test-*.ts` pure lane for claim mapping + an e2e scenario asserting a staff token reaches exactly one run's rows | 0.5 |
| **Total** | **~1.75 days** |

Versus **~5 days** for a full Supabase Auth migration (import tooling, password strategy, Google
re-linking, staff token re-implementation, `uid` format change across the schema, participant
`players` reconciliation, plus the cutover risk in §7 which is not billable in days at all).

### 5.3 Risks of H-B — stated honestly

| Risk | Severity | Mitigation |
|---|---|---|
| **(a) Refresh/caching.** `supabase-js` calls the `accessToken` callback on **every request**. A naive implementation calls our exchange endpoint per query — a self-inflicted DoS during a live run. | Medium | Cache the minted token in memory keyed by Firebase uid; re-mint at `exp − 60s`. ~20 lines. Mirrors the existing `authReady` memoization pattern (`play-web/src/services/firebase.ts:141-160`), including its poisoned-promise lesson at `:150-157`. |
| **(b) HS256 shared secret** — anyone holding `JWT_SECRET` can mint any identity, including a creator's. | Medium | Blast radius is **identical to the Postgres service-role key already on that box**. If the box is compromised, auth is the second-worst thing that happened. Keep it in the same secret store, rotate together. |
| **(c) Cloud fallback.** If we ever retreat to Supabase Cloud, the shared secret still works but is explicitly discouraged there (SOC2/PCI alignment). | Low | Escape hatches exist and are documented: import a JWT signing key, or switch to H-A. This is a *migration*, not a redesign — the client `accessToken` seam is the same either way. |
| **(d) `auth.uid()` is unusable.** It casts `sub::uuid`; a Firebase uid is not a UUID. There is a known Supabase **Storage `.list()` failure with non-UUID `sub`** ([storage#758](https://github.com/supabase/storage/issues/758)). | **High if unnoticed, trivial if planned** | Ban `auth.uid()` repo-wide. Define `rp_uid() returns text := auth.jwt()->>'sub'`, keep every id column `text` (which MIGRATION_PLAN §8.1 already commits to), and add a lint/grep gate. **Treat Storage `.list()` as unavailable** and enumerate objects from our own tables — we already do, via the `RunTaskRecord` photo URLs. |

### 5.4 **Fatal flaw check: none found.** But there is a hard dependency

The exchange endpoint is only needed for **direct client → Supabase** traffic. Today that is
**14 `onSnapshot` call-sites** — 9 in play-web (`PlayScreen` ×2, `LiveOps` ×2, `StaffConsole` ×3,
`ChatPanel`, `FeedPanel`) and 5 in creator-web (`RunConsolePage` ×3, `LiveTeamMap`, `WalletPage`) —
plus Storage uploads (`uploadTaskPhoto`/`uploadTaskAudio`/`uploadTaskMedia`). Everything else
already goes through callables, which will hold the service role and bypass RLS entirely.

**If the realtime companion analysis converts those listeners to backend-proxied SSE/polling, and
uploads go through the backend, the exchange endpoint is needed for nothing and should not be
built.** Do not start §5.2's work until `REALTIME_AND_OFFLINE.md` lands. This does not change the
recommendation — it only shrinks its cost, possibly to zero.

---

## 6. Migrating existing identities (if we moved anyway)

### 6.1 Participants — *not* free, contrary to the brief

Team rows are per-run and disposable, but `players/{uid}` is not (§1.1). A provider change orphans
every player profile silently. There is no reconciliation key: an anonymous user has no email, no
phone, nothing. Options are (i) accept the loss and tell nobody, (ii) accept it and reset all
profiles to zero honestly, (iii) build a device-local migration token that re-keys the row on next
open — real work, and it only reaches players who come back.

### 6.2 Creators — passwords are the blocker

Firebase stores a **modified scrypt**; Supabase's GoTrue stores **bcrypt/argon2**
([supabase/auth#1750](https://github.com/supabase/auth/issues/1750)). The official
[migration guide](https://supabase.com/docs/guides/platform/migrating-to-supabase/firebase-auth)
ships `firestoreusers2json` + `import_users` and asks for the Firebase hash parameters
(`base64_signer_key`, `base64_salt_separator`, `rounds`, `mem_cost`), so the intended path is
carrying those parameters across rather than rehashing. **I could not verify from primary docs
whether current GoTrue verifies Firebase-scrypt in production** — treat "passwords survive" as
unproven. The safe assumptions are a forced reset for every creator, or a lazy-rehash shim that
verifies against Firebase once and writes a bcrypt hash on first successful login.

Plus the confirmed-email trap in §2, which must be handled in the same import.

### 6.3 Staff — genuinely free

PINs are per-run and single-use; a consumed invite is `used: true` (`functions/src/index.ts:248-253`).
Nothing to migrate; the next run mints new PINs.

---

## 7. The `uid == teamId` coupling — what breaks if the provider changes

Every one of these is keyed on the participant's auth uid:

- team document id and `RunTeam.id` (`runs/index.ts:428, 514-516`)
- `deviceUids[]`, `controllerUid`, `devices[].uid` (`:532-535`) and the split-brain
  `array-contains` guard (`:488`)
- `transferController` / `claimController` handshake records (`:673-712`)
- `chat/{teamId}` document id (`firestore.rules:125-130`)
- Storage prefix `runs/{runId}/teams/{teamId}/**` (`storage.rules:13-17`)
- rules predicates `isOwner(teamId)` and `isAttachedDevice()` (`firestore.rules:74-79, 308-312`)
- leaderboard rankings and their tie-break (`runs/index.ts:1568, 1608, 1626`)
- `players/{uid}` (§1.1) and audit rows

**Nothing in the codebase parses the uid's format** — it is an opaque string everywhere — so the
*schema* survives a provider swap (Firebase's 28-char id → a UUID). The migration plan's decision to
keep `uid` as `text` (MIGRATION_PLAN §8.1) is what makes that true, and it should be preserved
regardless of this document's outcome.

What does **not** survive is a **cutover with a live run in flight**. A participant's phone
re-authenticates against the new provider, gets a new id, and no longer matches its team row: it
cannot read its own team doc, cannot submit, cannot see its position. This is the only part of
RushPoint whose failure mode is *a group of people standing in a street with a broken phone during a
timed, in-person, paid event*. A dual-read window could mitigate it and is not worth building.

**Keeping Firebase Auth makes participant cutover a literal no-op.** That is the largest single risk
this recommendation eliminates.

---

## 8. What stays on Firebase

Verdict per mechanism against the owner's bar — *does keeping this block the move off uncapped
Firebase billing?*

| Component | Blocks the IONOS move? | Billing meter | Verdict |
|---|---|---|---|
| Anonymous participant auth | **No** | MAU only (50k free) | **KEEP** |
| Creator email/password + Google | **No** | MAU only | **KEEP** |
| Staff PIN → custom token | **No** | MAU only | **KEEP** — and note the hard parts (throttle, single-use consume) migrate with the *datastore* anyway |
| — *adjacent, for contrast* — | | | |
| Firestore | **Yes** — the whole reason for the project | per-op reads/writes, uncappable | migrate (MIGRATION_PLAN) |
| Cloud Functions | **Yes** | per-invocation + egress | migrate to the Node backend |
| Firebase Storage | **Yes** (metered egress) | storage + egress | migrate; this is the case that *forces* the §5 bridge decision, since a Firebase-authed client must be able to write to a Supabase bucket |
| Firebase Hosting | No | flat-ish, and the TWA origin is pinned by `twa-manifest.json` | KEEP |

The load-bearing premise — **Firebase Auth has no per-operation billing dimension, only MAU, and
therefore cannot participate in a runaway** — is taken from the brief and MIGRATION_PLAN §8.1. I did
not independently re-verify Firebase's current pricing page (§10).

---

## 9. If we ever do move creators — the path, in order

1. **Freeze creator sign-ups** for the window; participants are unaffected (they are anonymous).
2. Export via `firestoreusers2json`; import with `import_users`, **forcing `email_confirmed_at`**
   so §2's auto-linking works. Get sign-off on that as a security decision.
3. **Preserve the uid** — import each Firebase uid as the Supabase user id if the column allows
   text, or maintain a `firebase_uid → supabase_uid` mapping table and rewrite `owner_uid`
   everywhere in one transaction. Do **not** let both exist.
4. Decide the password strategy explicitly: forced reset (honest, high friction) or lazy-rehash shim
   (invisible, needs Firebase Auth kept alive as an oracle during the window — which by itself
   argues for doing this *last*, if ever).
5. Re-establish the one-email-one-account invariant with an integration test that reproduces §2's
   scenario: register by password, sign in with Google, assert the same user id and a non-empty
   game list.
6. Keep Firebase Auth running read-only for one full billing cycle as a rollback path.

---

## 10. What I could not verify

- Whether current GoTrue verifies **Firebase-scrypt** hashes in production (§6.2). The migration
  guide implies carrying the parameters across; the open issue implies it does not work. Unresolved.
- Whether Supabase **anonymous** users count toward billed MAU — the anonymous-sign-in docs do not
  say. Moot under this recommendation.
- Whether the `role: 'authenticated'` claim requirement in H-A can be satisfied for **anonymous**
  Firebase users **without** Identity Platform blocking functions. The `onCreate` route exists but
  the docs call it non-synchronous; I did not find a definitive statement about the first-join race.
  Moot under H-B.
- Firebase Auth's current pricing/metering (§8) — taken as premise, not verified.
- Nothing here was executed. No gate was run; this document changes no code.
