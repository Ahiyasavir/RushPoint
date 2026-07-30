## Context

Admin tooling in RushPoint today is script/CLI-only (`backfill-public-tasks.mjs`,
`pruneExpiredRunDataNow`, `listAuditLogs` with no UI consumer). There is no in-app admin surface at
all. This change introduces the first one, so the design has to get two things right that later
admin features will inherit: **who can see it** (the admin claim, and how a real human gets it) and
**what "a user" even means** given RushPoint's two disjoint uid spaces.

## Goals / Non-Goals

- Goal: an honest, bounded, admin-only view of creator activity — games created, runs launched,
  last active — built entirely from data already in Firestore/Auth.
- Goal: reuse the existing admin-gate pattern (`context.auth.token.admin`) rather than inventing a
  second authorization concept.
- Non-goal: any notion of "platform user" that includes anonymous participants. Explicitly out of
  scope (see proposal.md).
- Non-goal: real-time/live updates. This is an on-demand admin report; a manual refresh button is
  enough.

## Decisions

### D1: "Users" = real (non-anonymous) Firebase Auth accounts, i.e. creators

`auth.listUsers()` returns every Auth user, including anonymous ones created for every play-web
session (`uid == teamId`, no email, no provider data). Anonymous accounts are filtered out
(`u.providerData.length > 0 || !!u.email`) before any Firestore lookup — they have no `users/{uid}`
doc, no games, and folding them in would just be a wall of empty rows. This mirrors how
`updateMyProfile`/`exportMyData`/`deleteMyAccount` already treat `users/{uid}` as "the creator's
account doc" — nothing new is invented here, this change just aggregates the existing convention
across all creators instead of one at a time.

### D2: Per-user reads, not one giant collection-group scan

For each (capped) creator, the callable issues two Firestore reads: `users/{uid}/games` (their own
subcollection — cheap, no index needed) and
`collectionGroup('runs').where('ownerUid','==',uid)` (served by the existing
`(ownerUid ASC, status ASC)` collection-group index on `runs` — verified in
`firestore.indexes.json`, no new index required; a leading-field equality filter is a covered
prefix of that composite index). At the `limit` cap of 300 creators that is at most 600 extra
reads for an admin-only, on-demand, non-hot-path callable — the same cost class as
`exportMyData`'s per-user reads, just amortized across many users instead of one. A single
collection-group scan over ALL games/runs and grouping client-side was considered and rejected: it
scales with total platform runs, not with the number of creators being displayed, and would still
need the same per-owner grouping afterward — strictly worse for no benefit at this scale.

### D3: `lastActiveAt` is the max of everything we actually stamp

```
lastActiveAt = max(
  authUser.lastSignInAt,
  ...games.map(g => g.updatedAt ?? g.createdAt),
  ...runs.map(r => r.finishedAt ?? r.createdAt),
)
```
No new field is written anywhere to track this — it is derived, on read, from timestamps the
system already stamps (Auth's own `lastSignInTime`, `Game.createdAt`/`updatedAt`, `Run.createdAt`/
`finishedAt`). A creator who signs in but never touches a game still shows a sane
(sign-in-only) `lastActiveAt`; a creator with no signup record at all (deleted Auth user, orphan
Firestore doc — not supposed to happen, but `deleteMyAccount` already proves it's not enforced by a
DB constraint) is simply not returned, because the callable's source list is `auth.listUsers()`,
not a Firestore scan.

### D4: Bounded, not paginated — same shape as `listAuditLogs`

`listAuditLogs` caps at `Math.min(limit, 500)` and returns whatever fits, no cursor. This change
uses the identical shape (`limit`, default 100, hard cap 300 — lower than audit logs' 500 because
each row costs 2 extra Firestore reads, not a single doc read) and returns `{ users, truncated }`.
A real cursor-based admin table is a reasonable future change once the creator count actually
approaches the cap; building it now against zero evidence of need would be speculative.

### D4b: The Auth scan itself must be bounded, because the participant pool is unbounded

`auth.listUsers()` returns **every** account, and RushPoint mints one anonymous account per
play-web session (`uid == teamId`). So the Auth pool is dominated by participants and grows with
every run ever played, while the creators the report wants stay few. A naive
`do … while (pageToken)` therefore scans a set that grows without limit in order to produce a
handful of rows — harmless at today's scale, a callable timeout later, precisely when the report is
first pointed at real production data.

Two bounds fix it, and both are pure decisions in `functions/src/admin/authRoster.ts`
(`isCreatorAccount`, `pageVerdict`), unit-tested in `authRoster.test.ts`, with the callable reduced
to the I/O around them — the same pure-rule/thin-I/O split as `maintenance/runRetention.ts`:

1. **Stop at `wanted + 1`.** Not a behaviour change: the callable already returned only the first
   `limit` in Auth's own page order, so later pages could never alter *which* rows come back. One
   extra row is exactly the evidence needed to set `truncated`.
2. **Never read past `MAX_AUTH_PAGES` (50 ⇒ 50k accounts).** If the cap cuts the scan short the
   result is flagged incomplete.

`truncated` deliberately means one thing to the client — "this list is not everything" — and is set
by *either* cause. The UI notice reads identically either way, so splitting it into two states would
add a subtler distinction for an operator to misread with no action attached to it; the server log
records which bound fired for whoever is debugging. `pageVerdict` checks "found enough" **before**
the cap so a scan that already has its whole answer is never mislabelled as cap-truncated.

### D4c: Anonymous accounts are filtered, and `users/{uid}` is NOT a usable roster

Worth recording because it is counter-intuitive: `users/{uid}` is written **only** by
`updateMyProfile` (a rename) — nothing creates it at signup. So a creator who never renamed
themselves has no profile document at all, and `db.collection('users')` is therefore **not** a
complete roster of creators. That is why `auth.listUsers()` is the source of truth here despite
needing the filter and the bounds above, and why the row's `email` comes from the Auth record
rather than the profile doc.

### D5: The admin claim needs a real first-party grant path

Every existing "admin" custom claim usage assumes it already exists (`assertAdmin` just reads
`context.auth.token.admin`) — the e2e suite mints it directly against the Auth emulator, and
nothing in the repo sets it on a **real** account. Without a grant script, this feature would ship
with no way to actually use it outside a test. `scripts/grant-admin-claim.mjs` fixes that: DRY-RUN
by default (prints the target uid/email and what would change), `--execute
--confirm-project=<id>` to actually call `setCustomUserClaims`. It looks up the target by `--email`
or `--uid`, preserves any other existing custom claims (merges, does not clobber `staff` claims a
user might already carry — though in practice no account should carry both), and refuses to run
against a project id that does not match `--confirm-project` (same footgun guard as
`backfill-public-tasks.mjs`).

**How a person actually gets in:** they create a normal RushPoint creator account (email/password
or Google, same `AuthGate` every creator uses) and separately, out-of-band, an operator runs the
grant script against their uid/email. Nobody's password is ever seen, entered, or handled by this
change — the claim is a server-side flag on an account the person already controls.

### D6: Client-side admin gate is UX only; the server is authoritative

`AdminUsersPage` calls `auth.currentUser.getIdTokenResult()` and shows an access-denied state if
`admin` is not `true` in the claims — this avoids flashing a loading table to a non-admin who
navigates to `/admin/users` directly. It is **not** the security boundary: `listPlatformUsers`
re-checks `context.auth.token.admin` server-side exactly like every other admin callable, and a
stale/forged client claim can never produce real data because Firestore/Functions verify the ID
token themselves. This is the same pattern the codebase already uses for staff/owner gates (client
hides UI it can't use; server is the only thing that can't be bypassed).

## Test Strategy

- **Pure logic (RED→GREEN, no emulator):** `packages/shared/src/adminUserActivity.test.ts`
  (vitest, co-located — matches `pausedClock.test.ts`) pins `buildAdminUserSummary`: counts, the
  `lastActiveAt` max-of rule from D3 (including the "no game/run activity, sign-in only" case and
  the "no sign-in timestamp, only activity" case), soft-deleted games still counted but flagged,
  and a totally empty user (no games, no runs) never throws. Also
  `apps/creator-web/src/lib/adminGate.test.ts` pins `isAdminClaim` (vitest, matches
  `deleteConfirm.test.ts`).
- **Callable behavior:** `scripts/e2e-verify.mjs` gains a scenario: as the minted `admin` token,
  call `listPlatformUsers` and assert the seeded demo creator appears with the right games/runs
  counts; as a non-admin (participant/creator/staff token), assert `permission-denied` — this feeds
  the existing authz denial matrix + the callable-coverage guard (a new callable is RED until
  invoked).
- **UI:** verified via the preview tools against the emulator-backed playtest stack — sign in as
  the seeded demo creator granted `admin` via the grant script run against the emulator, load
  `/admin/users`, confirm the table renders and a non-admin sees the access-denied state.
