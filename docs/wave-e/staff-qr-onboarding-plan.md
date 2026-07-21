# Wave E · Task 12 — Staff & player QR routing + simplified staff onboarding

**Status: PLAN ONLY (phase 1, read-only).** No source file was modified. Files listed as
"locked" below are owned by concurrent agents and must not be touched until unblocked.

---

## 1. SDD — investigation, root cause, proposed URL shapes

### 1.1 Every query param play-web recognises today

`apps/play-web/src/App.tsx` has **no router**; it reads `window.location.search` directly and
returns early from a chain of `if`s. Evidence (`App.tsx`):

| # | Param | Read at | Branch guard | Screen |
|---|---|---|---|---|
| 1 | `?staff` (valueless flag) | L33-35 (`.has('staff') \|\| !!loadStaffSession()`) | L111 `if (staffMode)` | `StaffConsole` (lazy) |
| 2 | `?tv=<accessCode>` | L55 (`TV_ROUTE_PARAM`) | L123 `if (tvCode)` | `TvLeaderboard` |
| 3 | `?recap=<accessCode>` | L57-59 (`RECAP_ROUTE_PARAM`) | L134 `if (recapCode)` | `RunRecap` |
| 4 | `?challenge=<gameId>:<taskId>` | L51-53 (`parseChallengeParam`) | L146 `if (challenge && !session)` | `ChallengeTeaser` |
| 5 | `?board=<accessCode>` | L42-44 | L158 `if (boardCode)` | `PublicLeaderboardScreen` |
| 6 | `?ceremony` (modifier on `board`) | L46-48 | L162 ternary inside the `board` branch | `CeremonyScreen` |
| 7 | `?game=<gameId>` | L38-40 | L180 `if (promoGameId && !session)` | `GamePromoScreen` |
| 8 | `?code=<ACCESSCODE>` | **not in App.tsx** — `screens/JoinScreen.tsx:17` | fallthrough L193-198, only when `!session` | `JoinScreen` prefilled + auto `getJoinInfo` (L43-48) |
| 9 | `?owner=`, `?game=`, `?run=` | `screens/StaffConsole.tsx:70-73` | only read *inside* the staff branch | prefill of the sign-in form |

`?ref=` is **not** a play-web param — it is captured in `apps/creator-web/src/components/AuthGate.tsx`
(creator-side referral) and appears on the play-web finish screen only as an outbound
"Powered by RushPoint" link. It cannot swallow `?code=`.

**Current precedence:** `staff → tv → recap → challenge → board(+ceremony) → game → (code|session)`.

### 1.2 Root cause of the staff misroute

The staff link is built in **`apps/creator-web/src/pages/RunConsolePage.tsx:460`**:

```ts
const link = `${PLAY_URL}/?staff&owner=${ctx.ownerUid}&game=${ctx.gameId}&run=${ctx.runId}`;
```

QR and copy encode the *same* string (`QRCode.toDataURL(link)` L464, `clipboard.writeText(link)` L467) —
so QR/copy parity is **not** a defect.

The defect is **param-namespace collision plus a non-sticky mode flag**. `game` is overloaded:
for the staff route it means "the run's gameId" (`StaffConsole.tsx:72`), for the marketing route it
means "show me the public promo for this game" (`App.tsx:39`). Staff mode wins *only* while
`staffMode === true`, and `staffMode` is plain component state (`App.tsx:33`) with no URL write-back.
The moment it flips false, the very same URL re-resolves as a **player** route:

- `StaffConsole.tsx:126` — "back to join" calls `onExit` → `App.tsx:116` `setStaffMode(false)`.
  The URL still carries `game=<gameId>`, so `App.tsx:180` renders `GamePromoScreen` — the player view.
  `GamePromoScreen` offers **instant play** (`GamePromoScreen.tsx:33` `startInstantPlay`), which
  creates a real *participant* session for a person who scanned a *staff* QR. This is the exact
  reported symptom, and it is reachable by any staffer who taps back, mistypes the PIN and gives up,
  or whose lazy `StaffConsole` chunk fails to resolve.
- Same outcome after `clearStaffSession()` (`StaffConsole.tsx:58`) on sign-out: URL unchanged →
  player promo.
- Secondary trigger: `?staff` is a **valueless** key. Any intermediary that normalises query strings
  (tunnel interstitials, link shorteners, some in-app browsers/link "previews" that rebuild the URL
  from parsed params) can drop a bare flag while keeping `owner/game/run` — which lands *directly*
  on the player promo on first load. Unverified in this environment, but the fix is free.
- Contributing UX cause: the Run Console shows **two** QR codes — the player join QR
  (`RunConsolePage.tsx:409` `?code=`) and the staff QR (L460) — and the staff card only appears after
  the organizer clicks "invite staff" and answers a `dialog.prompt` for the staff member's name
  (L139-144). Organizers plausibly hand staff the *player* QR.

**Tunnel/base-path dimension — currently OK, do not regress.** `PLAY_URL` is
`RunConsolePage.tsx:28-30`: in DEV it is `resolvePlayOrigin(window.location.origin)`
(`packages/shared/src/playtest.ts:82-88`), which correctly returns `:5181` on localhost and the
*same* origin behind a one-port tunnel; in prod it is `VITE_PLAY_URL` / `rushpoint-play.web.app`.
It is **not** hardcoded, and `scripts/proxy.mjs` routes by path only (`/creator*` → 5180, else play),
so a staff URL survives the tunnel. `scripts/test-playtest-links.ts:53-58` already locks this.

### 1.3 Proposed URL shapes

| Route | Current | Proposed |
|---|---|---|
| Staff | `…/?staff&owner=<uid>&game=<gid>&run=<rid>` | `…/?staff=<uid>.<gid>.<rid>` (one param, no collision) |
| Staff (legacy) | — | still parsed, for QRs already printed/shared |
| Player join | `…/?code=<ACCESSCODE>` | unchanged (verified correct) |
| Promo | `…/?game=<gameId>` | unchanged |
| Board / TV / recap | `…/?board=`, `?tv=`, `?recap=` | unchanged |

A dotted triple mirrors the existing `parseChallengeParam` convention (`packages/shared/src/challenge.ts:12`)
— ids are nanoid-style and contain no `.`/`:`. New shared module `packages/shared/src/staffRoute.ts`:
`STAFF_ROUTE_PARAM='staff'`, `buildStaffParam(owner,game,run)`, `parseStaffParam(raw)`.

### 1.4 Proposed precedence table (pure function `parsePlayRoute(search, hasSession, hasStaffSession)`)

| Order | Condition | Result |
|---|---|---|
| 1 | `staff` key present (any form) **or** stored staff session | `{ kind:'staff', ctx? }` |
| 2 | `tv` | `{ kind:'tv' }` |
| 3 | `recap` | `{ kind:'recap' }` |
| 4 | `board` + `ceremony` | `{ kind:'ceremony' }` |
| 5 | `board` | `{ kind:'board' }` |
| 6 | `challenge` parses **and** `!hasSession` | `{ kind:'challenge' }` |
| 7 | `game` **and** `!hasSession` | `{ kind:'promo' }` |
| 8 | `hasSession` | `{ kind:'play' }` |
| 9 | otherwise | `{ kind:'join', code? }` |

Deliberate changes vs today: `board` is lifted above `challenge` (a board link is never a teaser);
and **when a staff route resolves, `game`/`owner`/`run` are consumed as staff context and must not
feed the promo branch** — enforced by returning a single discriminated union instead of seven
independent `useState`s.

**Exit-path rule (the actual fix for the reported bug):** leaving staff mode
(`onExit` / sign-out) must strip the staff params via `history.replaceState` before
`setStaffMode(false)`, so the URL and the rendered route can never disagree. Equivalently:
`kind` is derived from URL + session on every render, never from a free-floating boolean.

**Files + line ranges to change (phase 2):**

- `packages/shared/src/staffRoute.ts` (new) + export from `packages/shared/src/index.ts`.
- `packages/shared/src/playRoute.ts` (new) — `parsePlayRoute`, pure, no DOM.
- `apps/play-web/src/App.tsx:29-201` — replace the seven `useState(() => new URLSearchParams(...))`
  reads with one `parsePlayRoute` call; add URL cleanup on staff exit.
- `apps/play-web/src/screens/StaffConsole.tsx:62-130` — accept parsed `ctx` as a prop, collapse the form.
- `apps/creator-web/src/pages/RunConsolePage.tsx:453-483` — emit the new link shape; label the two QRs
  unambiguously ("staff only — do not give to players").
- `scripts/test-play-route.ts` (new).

---

## 2. Onboarding reduction

### 2.1 Fields today

Everything the staff member faces is in `StaffConsole.tsx:111-123`, all four required by the submit
guard at L123 (`!ownerUid || !gameId || !runId || !pin`):

| Field | Source today | Verdict |
|---|---|---|
| `ownerUid` | typed / `?owner` prefill (L71) | **(b) derivable from the link** — pure friction when typed; it is a Firebase uid, unmemorable |
| `gameId` | typed / `?game` prefill (L72) | **(b) derivable** |
| `runId` | typed / `?run` prefill (L73) | **(b) derivable** |
| `pin` | typed only (L74) | **(a) required for security** — the sole secret; `staffSignIn` rejects without it (`functions/src/index.ts:198`) and consumes it single-use in a transaction (L261-272) |

Plus, upstream, the **organizer** must answer a `dialog.prompt` for the staff member's name
(`RunConsolePage.tsx:139`) because `inviteStaff` hard-requires it (`functions/src/index.ts:167`).

### 2.2 After

**Staff-facing: 4 fields → 1 (the PIN).** When `parseStaffParam` yields a full context, render a
context header ("Signing in as staff for *<run name>*") plus a single 6-digit PIN input with
`inputMode="numeric"` and autofocus. The three id fields move behind an "enter details manually"
disclosure, used only when someone opens `/?staff` with no context (still supported).

Security justification per removal: `ownerUid`/`gameId`/`runId` are **not secrets** — the owner uid
is already embedded in every player-visible path and the run/game ids are in the join flow. They are
*addressing*, not *authentication*. The authentication is the PIN, and the server-side checks are
unchanged: PIN must exist, be `used == false`, in **that run's** `staffInvites` subcollection
(`functions/src/index.ts:233-238`), and the minted claims are still `{staff, ownerUid, gameId, runId}`
(L279-286). Per-caller and run-wide brute-force lockouts (L200-251) are untouched.

**What an attacker who obtains the staff link can do: nothing they could not already do.** The link
carries only public-ish identifiers and lands them on a PIN prompt guarded by the two lockouts.
**The PIN must stay a separate secret and must NOT be embedded in the shared/printed QR.**

### 2.3 Two options that go further — user decision required

- **Option A (recommended, safe):** ship §2.2. Staff type 6 digits. One tap + one 6-digit code.
- **Option B (opt-in "one-tap QR"):** a *second*, per-invite QR that includes the PIN
  (`?staff=<o>.<g>.<r>&pin=<PIN>`), shown on the organizer's own screen to one staffer at a time and
  never printed or messaged. Defensible because the PIN is **single-use and atomically consumed**
  (`functions/src/index.ts:261-272`) — a leaked link post-scan is worthless. Costs: the secret enters
  browser history, the SW/Referer surface, and any screenshot. **Needs an explicit user decision.**
  If taken, the client must `history.replaceState` the `pin` out of the URL immediately on read.
- **Multi-use invites:** today one `inviteStaff` call = one PIN = one person (`used:true`). A crew of
  six means six prompts. Adding `count`/`maxUses` to `inviteStaff` is a `functions/src/index.ts`
  change (**locked file**) and would need its own e2e coverage for the single-use race test. Flagging,
  not scheduling.
- **"Name only":** genuinely name-only staff join is *not* possible without removing the PIN, i.e.
  removing the security boundary. Closest safe version is Option A (+ optionally let the staffer type
  their own display name at sign-in instead of the organizer pre-typing it, which would let
  `inviteStaff` accept a blank name — again a locked-file change).

---

## 3. TDD plan — failing tests first

### 3.1 Pure lane (RED first) — `scripts/test-play-route.ts`

Auto-discovered by `scripts/run-unit-tests.mjs:22-24` (`/^test-.*\.ts$/`). Style: copy
`scripts/test-location-leak.ts` / `scripts/test-playtest-links.ts` (`ok()` counter, exit non-zero).
Written **before** `parsePlayRoute` exists, so `npm test` is red.

Cases:
1. `?staff=o.g.r` → `kind:'staff'` with `{ownerUid:'o',gameId:'g',runId:'r'}`.
2. Legacy `?staff&owner=o&game=g&run=r` → identical result (back-compat for printed QRs).
3. **Regression guard:** `?staff&game=g` never yields `kind:'promo'`, with `hasSession` both true and false.
4. `?staff=o.g.r` + `hasSession:true` (a leftover player session on the phone) → still `'staff'`.
5. `hasStaffSession:true` with an empty query → `'staff'`.
6. Malformed staff values (`''`, `'o.g'`, `'o.g.r.x'`, `'o..r'`) → `kind:'staff'` with `ctx:null`
   (manual-entry form), **never** a player route.
7. `?code=ABC123` → `kind:'join', code:'ABC123'`; lowercase/whitespace normalised.
8. `?code=ABC123` + `hasSession:true` → `'play'` (existing behaviour, locked in).
9. `?board=X` → `'board'`; `?board=X&ceremony` → `'ceremony'`; `?tv=X` → `'tv'`; `?recap=X` → `'recap'`.
10. Precedence sweep: `?staff=o.g.r&board=X&tv=Y&game=Z&code=C` → `'staff'`; then remove `staff` →
    `'tv'`; then `'recap'`; then `'board'`; then `'promo'`; then `'join'`.
11. `?challenge=g:t` + `hasSession:false` → `'challenge'`; with `hasSession:true` → `'play'`.
12. `?game=Z` alone → `'promo'` (marketing route unbroken).
13. **Round-trip:** `parseStaffParam(buildStaffParam(o,g,r))` deep-equals the input; ids containing
    `-`/`_` survive; values are URL-encoded/decoded correctly.
14. Link builder: the Run Console staff URL built from `resolvePlayOrigin('https://x.ngrok-free.app')`
    contains exactly one `?`, has a non-empty `staff` value, and contains **no** bare `game=` key.

### 3.2 Emulator lane — `scripts/e2e-verify.mjs` (**LOCKED — phase 2**)

Only touch after unblock. `staffSignIn`/`inviteStaff` are already covered
(`e2e-verify.mjs:859-882`, `1768-1776`, `4566-4601`, `4979-4984`), so the **callable coverage guard
stays green as long as no new callable is added**. §2.2 adds no callable → no new coverage
obligation. Scenarios to add/extend *only if* the sign-in contract changes:

- `staff sign-in: context from the link is not trusted for authz` — call `staffSignIn` with a valid
  PIN but a *different* `runId` and assert `not-found` (the invite lives in the run's subcollection).
- `staff sign-in: minted claims still pin ownerUid/gameId/runId` — assert the existing other-run-staff
  denial in the authz matrix (`e2e-verify.mjs:4979-4984`) is unchanged.
- If **Option B** is chosen: a scenario asserting the PIN is still single-use when delivered via link
  (second call with the same PIN → `not-found`) and that lockouts still fire.

### 3.3 Playwright lane — `npm run test:ui` (`e2e-ui/play.spec.ts`)

- Navigate `/?staff=o.g.r` → assert the staff sign-in heading renders, exactly **one** input is
  visible, and no promo/join CTA is present.
- Navigate legacy `/?staff&owner=o&game=g&run=r` → same assertions.
- **Bug reproduction:** from the staff screen click "back to join" → assert the URL no longer contains
  `staff`/`owner`/`run`, and that the promo screen for `game` is **not** rendered.
- Navigate `/?code=DEMO01` → assert the code input is prefilled and uppercase.
- Navigate `/?game=<id>` → promo still renders (marketing regression).
- SW case: load once (SW installs), reload `/?staff=o.g.r` and assert the staff screen still renders
  from the cached shell.

---

## 4. Regression risk list

1. **Authz matrix** (`e2e-verify.mjs` participant/stranger/other-run-staff/owner) — the plan makes no
   server-side authz change; other-run-staff must still be denied. Re-run `verify:emulator` in phase 2.
2. **Marketing routes** — `?game=` and `?board=` are shared publicly and indexed in OG cards
   (`apps/*/public/og.jpg`); reordering the `if` chain must not change their behaviour. Covered by
   pure cases 9/12 and the Playwright promo case.
3. **Already-distributed staff QRs** — legacy shape must keep working; do not remove the old parser.
4. **Service worker.** `apps/play-web/public/sw.js` is navigation-**network-first** (L34-44) with an
   `/index.html` fallback, and routing is computed from `window.location.search` at runtime, so a
   cached shell still routes a fresh deep link correctly. Two real risks: (a) the fixed bundle must
   actually reach devices — bump `CACHE` from `rushpoint-play-v2` (L8) in the same change so the
   activate handler purges the old cache; (b) `StaffConsole` is `React.lazy` (`App.tsx:14`) — if the
   cached shell references a hashed chunk that no longer exists, Suspense hangs forever and staff see
   an infinite spinner. Add a retry/error boundary around the lazy staff route (a reload-once-on-
   chunk-error handler), and cover it in the Playwright SW case.
5. **`?ceremony`** is a modifier, not a route — it must stay nested under `board`, or the TV/ceremony
   link breaks.
6. **Stored staff session on a shared phone** — a phone used by staff then handed to a player keeps
   `rushpoint.staff` in localStorage (`store.ts:90-106`) and will *always* boot into staff mode.
   Sign-out must clear it (it does, `StaffConsole.tsx:58`) *and* strip URL params.
7. **i18n** — new/changed strings live in `apps/play-web/src/i18n.ts` and
   `apps/creator-web/src/i18n.ts`, both **LOCKED**. `npm run i18n:check` is mandatory afterwards, and
   the new UI must add zero PART B warnings (`i18n:check:strict`).

## 5. Things I think are bad ideas / need a user decision

- **Bad idea:** dropping the PIN, or auto-signing-in from the link alone. That converts a shareable
  QR into a bearer credential for the run's staff surface (photo review, score adjustment,
  announcements, live team locations). Do not.
- **Bad idea:** keeping `game` as the staff param name and "fixing" it purely by reordering the
  branches. Ordering is already staff-first; the collision resurfaces on every state transition.
  The param must be disambiguated.
- **Decision needed:** Option B (one-tap QR with the single-use PIN embedded) — genuinely gets to
  "one click", genuinely widens the leak surface. My recommendation is to ship Option A first and
  treat B as a separate, opt-in, explicitly-labelled button.
- **Decision needed:** multi-use / bulk staff invites (`count` on `inviteStaff`). Big real-world
  friction win for a 6-person crew; touches locked backend files and the single-use race test.
- **Decision needed:** should the staffer type their own display name at sign-in (removing the
  organizer's name prompt at `RunConsolePage.tsx:139`)? That is the only reading of "name only" that
  is compatible with keeping the PIN.
- **Worth confirming with the user:** was the reported misroute observed on *first scan*, or after
  interacting with the staff screen? If first scan, the valueless-`?staff` normalisation theory
  (§1.2, third bullet) is the primary cause; if after interacting, it is the exit-path bug. The
  proposed fix covers both, but the answer tells us which Playwright case is the real regression test.

---

---

# PHASE 2 — IMPLEMENTED (handoff notes)

Resolver lives in **`apps/play-web/src/lib/playRoute.ts`** (not packages/shared, per coordinator).
Tests: `scripts/test-play-route.ts` — **59 assertions, green**. Typecheck, play:build, browser-verified.

## A. Precedence as implemented (`resolvePlayRoute`)

| # | Match | Route |
|---|---|---|
| 1 | `?staff[=o.g.r]`, legacy `?staff&owner&game&run`, or a stored staff session | `staff` (**consumes** owner/game/run so `game` can never be re-read as a promo id) |
| 2 | `?tv=<code>` | `tv` |
| 3 | `?recap=<code>` | `recap` |
| 4 | `?board=<code>&ceremony` | `ceremony` |
| 5 | `?board=<code>` | `board` |
| 6 | `?challenge=<g>:<t>` and no session | `challenge` |
| 7 | `?code=<CODE>` present | `join` or `play` — see §B |
| 8 | a stored session, no `code` in the URL | `play` |
| 9 | `?game=<id>` and no session | `promo` |
| 10 | otherwise | `join` |

Empty values (`?board=`, `?code=`) count as absent. A staff route **never** clears the player session
(a marshal borrowing a phone must not wipe it). `stripStaffParams()` runs on staff exit/sign-out via
`history.replaceState`, deleting `staff` + `owner` + `game` + `run` and keeping everything else.

## B. Stale-session rules (issue 3)

| URL | Stored session | Result |
|---|---|---|
| `?code=NEW` | run with code `OLD` | **clear** the session → `join` prefilled with `NEW` |
| `?code=SAME` | run with code `SAME` | **no-op resume** → `play`, nothing cleared *(load-bearing: never drop an in-progress run)* |
| `?code=SAME` (any case/whitespace) | `SAME` | same — comparison is trim + uppercase both sides |
| `?code=NEW` | none | `join` prefilled |
| no code | any session | `play` (resume) |
| `?code=` empty | any session | `play` — an empty param is not a join intent |
| `?game=G&code=NEW` | — | `join` wins; an explicit code beats the promo |

**Finished runs:** finished-ness never *protects* a session and never *forces* a wipe. A **different**
code clears it like any other stale session; the **same** code still resumes so the player keeps their
results/final screen. `SessionRef.runFinished` exists and is covered by tests for when a future change
wants to persist it. Known residual: if an organizer relaunches a run **reusing the same access code**,
the client treats it as the same run; the server is authoritative and `getMyTeamState` will reject.

Cleared via `clearSession()` at boot, before the first render, so no screen ever sees the stale session.

## C. Files changed

- **NEW** `apps/play-web/src/lib/playRoute.ts` — `resolvePlayRoute`, `parseStaffParam`,
  `buildStaffParam`, `stripStaffParams`, `STAFF_ROUTE_PARAM`.
- **NEW** `scripts/test-play-route.ts` — 59 assertions (auto-discovered by `run-unit-tests.mjs`).
- `apps/play-web/src/App.tsx` — one resolver call replaces seven `useState(() => new URLSearchParams…)`
  reads; boot-time stale-session clear; `exitStaff()` replaceState cleanup; `lazyWithRetry('staff', …)`
  reloads once on a chunk-load failure so a stale shell cannot hang Suspense forever.
- `apps/play-web/src/screens/StaffConsole.tsx` — takes `ctx: StaffCtx | null`; with a link ctx the form
  is **name + PIN only** (autofocused name, `inputMode="numeric"` PIN); the three id fields render only
  as the no-context fallback. No longer reads `window.location`.
- `apps/play-web/src/screens/JoinScreen.tsx` — takes `initialCode` instead of reading the URL itself.
- `apps/play-web/public/sw.js` — `CACHE` `rushpoint-play-v2` → `rushpoint-play-v3`.

## D. RunConsolePage generator patch — for the coordinator to apply

File `apps/creator-web/src/pages/RunConsolePage.tsx` (photo-queue agent owns it). Line ~460, inside
`StaffInviteCard`. **Anchor (exact current text):**

```ts
  const link = `${PLAY_URL}/?staff&owner=${ctx.ownerUid}&game=${ctx.gameId}&run=${ctx.runId}`;
```

**Replacement:**

```ts
  // ONE param, no `game=` key: the promo route reads `game` too, so the old shape
  // re-resolved as the player teaser (with instant play) whenever the bare `staff`
  // flag was dropped in transit. Shape must stay in sync with parseStaffParam()
  // in apps/play-web/src/lib/playRoute.ts.
  const link = `${PLAY_URL}/?staff=${encodeURIComponent(`${ctx.ownerUid}.${ctx.gameId}.${ctx.runId}`)}`;
```

No import needed; no other line in that file changes. The play-web parser accepts **both** shapes, so
QRs already printed keep working — apply this whenever convenient, it is not blocking.

Optional follow-up for the same agent: the player join QR (L409) and the staff QR (L460) sit on the
same page with similar styling; a "staff only, do not give to players" label on the staff card would
remove the remaining human failure mode.

## E. i18n keys — none required

The short staff form reuses existing keys: `t.join.yourName` (HE `השם שלכם` / EN `Your name`) for the
name field and `t.staff.pin` for the PIN. `t.staff.ownerUid/gameId/runId` still back the fallback form.
No dictionary edit is needed, so `apps/play-web/src/i18n.ts` stayed untouched. Optional polish, if you
want to unlock it later: a `t.staff.signInLinkSub` ("You are signing in as staff for this run" /
`אתם מתחברים כצוות לריצה הזו`) to replace the generic subtitle when the link carries context.

## F. Still owed (backend, locked — needs your call)

Requirement (b) said the staff-typed name must reach the **audit trail**. The console now stores the
typed name in `StaffSession` and shows it, but attribution on `adjustTeamScore` /
`reviewStationSubmission` comes from the `staffName` **token claim**, minted at
`functions/src/index.ts:279-286` from `invite.name`. Making the typed name authoritative needs two
one-line changes in locked files:

1. `apps/play-web/src/services/calls.ts:262-265` — add `name?: string` to the `staffSignIn` payload type.
2. `functions/src/index.ts:189-293` — read `data.name`, `validate(() => requireString(name,'name',MAX_MESSAGE_LEN))`
   when present, and use it for the `staffName` claim (and the returned `name`) instead of `invite.name`.

This is **not** an auth weakening — the PIN check, single-use consume and both lockouts are unchanged,
and the claim's `ownerUid/gameId/runId` scope is unchanged, so the e2e authz matrix (incl. other-run-staff
denial) is unaffected. But it *is* a backend-auth-file edit, which you told me to stay away from.
Say the word and I will do it, or hand it to the backend agent with this spec.

## G. Verification run

- `npx tsx scripts/test-play-route.ts` → 59/59 green.
- `npx tsc --noEmit -p apps/play-web/tsconfig.json` → clean.
- `npm run play:build` → built in 12.5s.
- eslint on the four touched files → no new findings (play-web is outside the creator-web lint config;
  the two reported items are pre-existing).
- Browser (dev:all, :5181): legacy `?staff&owner&game&run` → staff console, **2 inputs**; new
  `?staff=o.g.r` → identical, and the player session on the device was left intact; "back to players"
  → URL rewritten to `/` and the **join** screen rendered (previously the promo/instant-play screen);
  stale session + `?code=PLAY01` → session removed from localStorage and the code prefilled;
  same-code (`?code=play01` vs stored `PLAY01`) → session preserved and routed into play.

---

**Locked files this plan will need in phase 2:** `functions/src/index.ts` (only if Option B /
multi-use invites are approved), `scripts/e2e-verify.mjs`, `apps/play-web/src/i18n.ts`,
`apps/creator-web/src/i18n.ts`. Everything else (`App.tsx`, `StaffConsole.tsx`, `RunConsolePage.tsx`,
`packages/shared/src/*`, `scripts/test-play-route.ts`, `e2e-ui/play.spec.ts`, `public/sw.js`) is free.
