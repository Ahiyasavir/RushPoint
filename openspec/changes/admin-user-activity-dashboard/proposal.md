## Why

There is currently no way to see, across the whole platform, who RushPoint's users are and what
they have done: which creators exist, how many games each has built, how many runs they have
launched and when, or when anyone was last active. `listAuditLogs` exists but is an append-only
action trail, not a per-user rollup, and nothing in `apps/creator-web` renders it. Answering "who
are our users and how active are they" today means hand-querying Firestore.

**Scope decision, stated up front because it is easy to conflate the two populations:** RushPoint
has two disjoint uid spaces — creators (real Firebase Auth, own `users/{uid}` + their games/runs)
and participants (anonymous auth, `players/{uid}` cross-run stat profile, no email, no persistent
identity, unrelated to any creator uid). "List of all users" can only honestly mean **creators**:
they are the only population with an email, a signup, and a `users/{uid}` doc to roll up. This
change ships a creator activity dashboard. It does **not** attempt to join anonymous player
activity onto a creator row — there is no data-model link between the two, and inventing one (e.g.
matching by email a participant never gave) would be a fabrication, not a feature.

## What Changes

- **New admin-only callable `listPlatformUsers`.** Same admin gate as `listAuditLogs`
  (`context.auth.token.admin`, no emulator bypass). For each real (non-anonymous) Firebase Auth
  account, returns: uid, email, displayName, Auth `createdAt`/`lastSignInAt`, the games they
  created (id, title, createdAt, whether soft-deleted), the runs they launched across those games
  (id, gameId, gameTitle, status, createdAt, finishedAt, participantCount), and a derived
  `lastActiveAt` = the latest of {lastSignInAt, any game createdAt/updatedAt, any run
  createdAt/finishedAt}. Bounded by a `limit` param (default 100, max 300, `truncated` flag on the
  response) — the same shape `listAuditLogs` already uses, so a platform with more creators than
  the cap degrades honestly instead of timing out.
- **Pure aggregation logic in `packages/shared/src/adminUserActivity.ts`.** `buildAdminUserSummary`
  folds one Auth user record + their games + their runs into the row above; totally pure, no
  Firestore, so the "how do we define last-active / games-created-count" rule is unit-tested
  independent of the callable's I/O.
- **New admin page `apps/creator-web/src/pages/AdminUsersPage.tsx`** at route `/admin/users`. Not
  in the primary nav (same treatment as `/live`) — reachable only by URL, and gates its own
  content on the signed-in user's `admin` custom claim (checked client-side for UX; the callable is
  the real gate). Renders a sortable table: creator, signup date, last active, games created
  (count + expandable list), runs launched (count + expandable list). Full Hebrew/English i18n.
- **Operator script `scripts/grant-admin-claim.mjs`.** The `admin` custom claim has never had a
  first-party way to grant it (the e2e suite mints it directly against the Auth emulator; nothing
  sets it on a real account). DRY-RUN by default, `--execute --confirm-project=<id>` to actually
  call `admin.auth().setCustomUserClaims`, same safety shape as `backfill-public-tasks.mjs`. This
  is how a real person becomes able to open `/admin/users` — they sign in with their own
  email/password exactly as any creator does; nobody's credentials are entered by anything other
  than the account holder.
- **`assertAdmin` deduplicated into `functions/src/auth.ts`.** It is currently defined twice
  (`index.ts`, `maintenance/index.ts`) with identical bodies. The new `admin/index.ts` module needs
  it too and cannot import from `index.ts` (cycle), so this is the same move `assertStaffOrOwner`
  already went through — behavior unchanged, one definition instead of three.

### Non-goals

- No participant/player rollup, no email capture for anonymous players, no cross-uid identity
  linking.
- No write path — this is a read-only reporting surface. Nothing about account state, billing, or
  game data changes as a result of viewing the dashboard.
- No CSV export (the existing `analytics-csv-export` change covers run-level export separately; a
  future change can extend it to this table if wanted).
- No Google Analytics involvement. This is first-party Firestore/Auth data, unrelated to the GA4
  tag (`google-analytics-tag` change) — GA counts page views, not "which creator made which game."

## Impact

- Affected specs: `admin-user-activity` (new capability)
- Affected code: `functions/src/admin/index.ts` (new), `functions/src/auth.ts`,
  `functions/src/index.ts`, `functions/src/maintenance/index.ts`,
  `packages/shared/src/adminUserActivity.ts` (new), `packages/shared/src/index.ts`,
  `apps/creator-web/src/pages/AdminUsersPage.tsx` (new), `apps/creator-web/src/App.tsx`,
  `apps/creator-web/src/services/calls.ts`, `apps/creator-web/src/lib/adminGate.ts` (new),
  `apps/creator-web/src/i18n.ts`, `scripts/grant-admin-claim.mjs` (new),
  `scripts/e2e-verify.mjs` (authz + coverage), `CLAUDE.md` (callables table)
