# Wave-H — Auth / identity / lifecycle hunt: join, staff, shared-device paths

Read-only security sweep of the trust boundaries in the join, staff-onboarding, and
shared-device (multi-phone) paths. Focus per the brief: `staffSignIn`, the authz
matrix (`assertStaffOrOwner`/`assertAdmin`), `joinRun`/`getJoinInfo`/`joinTeamAsDevice`,
the controller/viewer device model, and anonymous-identity IDOR.

Prior-wave items are **not** re-reported: the staff-route misroute + onboarding
reduction (wave-e), the `requestTaskHint` stage-scope leak and feed title/photo leaks
(wave-f/g S1), and the play-web overlay/lazy-chunk robustness items (wave-g) are all
treated as known. Line numbers are against the tree at audit time.

## Headline

**No P0 auth bypass and no P1 DoS/data-integrity bug found on these boundaries.**
The staff sign-in, the staff/owner authz claim-scoping, the join caps, and the
device model are all correctly guarded — several against exactly the attacks the
brief called out (single-use PIN race, run-wide brute-force DoS of legit staff,
cross-run staff, split-brain double-join, payload-`teamId` IDOR). The only findings
are three **P2 defense-in-depth / hardening** items. A clean bill dominates this sweep.

---

## CONFIRMED — findings (all P2)

| # | file:line | Trust boundary | Concrete failure | Sev | One-line fix |
|---|-----------|----------------|------------------|-----|--------------|
| H1 | `functions/src/runs/teamDevices.ts:48` `generateDeviceJoinCode` | Team-attach credential (device → viewer → `claimController` → full team control) | The 6-char team join code is generated with `Math.random()`, not a CSPRNG — inconsistent with the staff PIN, which was **deliberately** moved to `crypto.randomInt` (anti-cheat row 40, `index.ts:15`). A device code is a real credential: whoever has the (widely-shared) run access code **plus** a team's device code can `joinTeamAsDevice` then `claimController` and act AS that team. Predicting `Math.random` output (or its non-uniform low-entropy tail) is far weaker than a CSPRNG. | P2 | Generate the code from `crypto.randomInt(0, ALPHABET.length)` per char, like `generatePin`. |
| H2 | `functions/src/index.ts:180` `inviteStaff` (`permissions`) + `index.ts:77-94` `assertStaffOrOwner` | Owner → staff privilege delegation | The per-invite `permissions: string[]` is stored and minted into the token claim (`index.ts:294`) but **never enforced**: `assertStaffOrOwner` grants any `t.staff` token full run-scoped power over *every* staff callable (review photos, adjust score, announce, hide feed, ack SOS). A staffer invited with `permissions:['announce']` can still `adjustTeamScore`. Contained within the owner's own trust domain (not cross-tenant), but the granularity is illusory — a real concern if the console ever presents "limited" staff roles as a security control. | P2 | Either drop `permissions` from the UI/claim (document staff as all-or-nothing), or have `assertStaffOrOwner` take a required-permission arg and check `t.permissions`. |
| H3 | `packages/shared/src/validation.ts:114` `requireString` (consumed by `joinRun` displayName/memberNames `runs/index.ts:388-392`, `staffSignIn` name `index.ts:293`, `sendTeamChatMessage` senderName `index.ts:467`) | Participant/staff-authored text → staff/creator UI + audit-adjacent surfaces | `requireString` only trims + length-caps; it does **not** strip control / bidirectional-override (U+202E) / zero-width / homoglyph characters. So `displayName`, `memberNames[]`, self-declared staff `name`, and HQ `senderName` can carry those. React auto-escaping means **no DOM XSS** (verified — no player-authored field reaches the CSV export either; `RunConsolePage.tsx:1340` exports analytics only, and it already neutralizes formula injection). Residual risk is **display spoofing / RTL trickery / name impersonation** in the console and team lists. `registrationData` values are only size-bounded (4000 B) + plain-object-checked, never individually validated (a value may be a nested object/number rendered as `[object Object]`). | P2 | Add a `stripControlChars`/bidi-strip step to `requireString` (or a dedicated display-name sanitizer) for the name-class fields; optionally coerce `registrationData` values to strings. |

---

## CLEAN — verified no bug (bill of health)

### staffSignIn (`functions/src/index.ts:190-305`)
- **Single-use consume is race-safe.** The `where('used','==',false)` query is
  non-transactional, but the actual flip re-reads the specific invite ref inside a
  `runTransaction` and rejects if `used===true` (`index.ts:266-277`). N concurrent
  callers with one PIN → exactly one winner, the rest get the same `not-found`.
- **Run-wide DoS of legit staff is prevented (WO-4).** The correct/unused-PIN lookup
  (`:238-243`) runs **before** the run-wide lockout gate (`:248`), so a correct PIN
  wins even while an attacker has driven the `_run` counter to lockout with fresh
  anonymous identities. The per-caller lockout (`:227`) is keyed on the caller's own
  uid, so it can't be used to lock out a *different* legit staffer (uids are
  unguessable Firebase-minted). Both counters are cooldown-windowed and self-heal.
- **No wrong-vs-used PIN oracle.** Both the query miss and the transaction-loser path
  throw the identical `not-found` / "Invalid or already-used PIN". No expiry concept
  to leak. (There is no PIN-expiry TTL — noted, not a defect.)
- **`staffName` is attribution-only.** Type-checked (`typeof name === 'string'`),
  trimmed, 60-char capped; falls back to the invite name. It is minted into the claim
  but **never read server-side into the audit trail** — `adjustTeamScore` /
  `reviewStationSubmission` stamp `operatorId`/`reviewedBy` from `context.auth.uid`
  (`index.ts:1051,1154`), so a crafted name cannot forge audit attribution or escalate.
  (Its only unsanitized surface is H3, display-only.)

### Authz matrix (`assertStaffOrOwner` `index.ts:77-94`, `assertAdmin` `:62-70`)
- **Cross-run staff denied.** The staff branch requires `t.staff && t.ownerUid ===
  ownerUid && (!runId || t.runId === runId)` — a PIN minted for run A grants nothing on
  run B. Every privileged callable passes the **payload** `ownerUid` + `runId` into the
  guard, which re-verifies them against the **token claim** — payload identifiers are
  never trusted for authz.
- **No emulator bypass** (both guards mint/verify real tokens), so the e2e authz matrix
  exercises the production gate.
- **Guard coverage swept.** All privileged callables in `index.ts` carry a guard:
  `acknowledgeAlert`/`pushAnnouncement`/`deactivateAnnouncement`/`pushFlashMission`/
  `hideFeedItem`/`reviewStationSubmission`/`adjustTeamScore` → `assertStaffOrOwner`;
  `listAuditLogs` → `assertAdmin`; `listRunTeams` (`runs/index.ts:2306`) → owner-only
  (`run.ownerUid !== uid` denial) and it exposes **no** `deviceJoinCode`/PIN/secret;
  `sendTeamChatMessage`/`reactToFeedItem` use a non-throwing member probe then
  `assertStaffOrOwner` for the HQ path. No owner-only callable missing its guard.

### Join paths (`joinRun` `runs/index.ts:370`, `getJoinInfo` `:329`, `joinTeamAsDevice` `:2410`)
- **Caps enforced transactionally.** `joinRun` checks `participantCount` vs cap **and**
  the per-run 16-device ceiling inside a `runTransaction` (`:483-511`) — concurrent
  joins can't overshoot. `joinTeamAsDevice` enforces the per-team cap (`MAX_TEAM_DEVICES
  = 3`) **and** the per-run 16 cap inside its transaction (`:2463-2500`).
- **Finished-run blocked** on both join paths (`:450`, `:2432`). Draft runs are
  unjoinable by construction — an `accessCode` doc is only written at `launchRun` with
  `status:'live'` (`:227-236`), so no code resolves to a `draft`/pre-launch run.
  (`RunStatus` has no `paused` state.)
- **Double-join / split-brain guarded.** `joinRun` rejects a uid that is already a
  standalone team *or* an attached device of another team in the run (`:438-444`,
  `deviceUids array-contains` query), and `joinTeamAsDevice` mirrors it (`:2437-2454`).
  One uid ⇒ at most one team per run.
- **Payload bounded + injection-safe.** `displayName`/`memberNames[i]` length-capped,
  `memberNames` ≤ 30, `registrationData` ≤ 4000 B and must be a plain object; the
  access `code` is regex-validated (`ACCESS_CODE_RE`, `validation.ts:130-149`) before
  any `accessCodes/{CODE}` doc path is built — no path injection via `/`.

### Shared-device model (`teamDevices.ts`, `transferController`/`claimController` `runs/index.ts:2507-2553`)
- **Viewer cannot mutate.** Every mutating participant callable resolves via
  `resolveCallerTeam(..., { requireController: true })` → `assertController`
  (`teamDevices.ts:39`), which throws for a viewer. A viewer *can* `claimController`
  first and then act — but that is **by design** (documented never-stuck fallback;
  the trust boundary is the team's `deviceUids`, not the controller flag). Not an escalation.
- **Control transfer/claim race-safe.** Both re-read the team inside a transaction and
  re-assert (`assertController` for transfer, attached-uid membership for claim), so a
  transfer racing a submit resolves to a single consistent controller.
- **`resolveDeviceRole` rejects non-attached uids** (`teamDevices.ts:33-36`): a device
  not in `deviceUids` gets `null` → denied. `transferController`'s `toUid` is validated
  to be an attached device (`:2522`).

### Anonymous identity / IDOR
- **Payload `teamId` never trusted for team-scoped callables.** `getMyTeamState`,
  `updateLocation`, `triggerSOS`, `sendTeamChatMessage` (participant path),
  `reactToFeedItem`, `transferController`, `claimController`, `checkOutTask`,
  `submitTaskAnswer`, `completeTask` resolve the team from the **uid** via
  `resolveCallerTeam`. Where a `teamId` is accepted it is explicitly rejected on
  mismatch: `verifyStationCode` (`index.ts:798`), `requestGuardianConsent`
  (`runs/index.ts:609`). The sweep's "completeTask ignores payload teamId" invariant
  holds across the team-scoped set.
- **Guardian consent** (`requestGuardianConsent`/`grantGuardianConsent`
  `runs/index.ts:601-644`): token is 128-bit `crypto.randomBytes(16)`, stored with a
  server-pinned `teamId: uid` (payload teamId only used for an IDOR reject), consumed
  single-use in a transaction. Clean.
- **Cross-run isolation:** one uid joining two *different* runs is separate team docs —
  no contamination; within one run the double-join guards make one-team-per-uid an
  invariant.

---

## NEEDS RUNTIME CHECK

- **H1 exploitability** is bounded by the 31^6 (~887M) code space + per-uid rate limit
  on `joinTeamAsDevice`; confirm the rate limit's window/threshold makes online
  brute-force of a live team's device code infeasible before treating H1 as purely
  theoretical. (The fix is free regardless.)
- **H3 render surfaces:** confirm no creator/staff surface renders participant strings
  via `dangerouslySetInnerHTML` or into a non-escaping sink (canvas story cards draw
  text safely; the analytics CSV excludes participant names). If all sinks are
  React-escaped JSX, H3 stays cosmetic (spoofing only), not injection.
