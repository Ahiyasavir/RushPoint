## 1. RED — pure aggregation rule

- [ ] 1.1 Create `packages/shared/src/adminUserActivity.test.ts` (vitest, matches
  `pausedClock.test.ts` style) pinning `buildAdminUserSummary(authUser, games, runs)`: counts and
  lists games/runs correctly; `lastActiveAt` = max of authUser.lastSignInAt + every game
  createdAt/updatedAt + every run createdAt/finishedAt (design §D3); sign-in-only case (no
  games/runs); activity-only case (no `lastSignInAt`); a fully empty user never throws and returns
  `lastActiveAt: null`; a soft-deleted game (`deletedAt` set) is still counted with `deleted: true`.
  Run `npx vitest run adminUserActivity` from `packages/shared` and confirm it fails because the
  module does not exist.

## 2. GREEN — the aggregation module

- [ ] 2.1 Add `packages/shared/src/adminUserActivity.ts` exporting `AdminUserSummary`,
  `AdminUserGameSummary`, `AdminUserRunSummary` types and `buildAdminUserSummary` implementing the
  rule from §1.1. Export from `packages/shared/src/index.ts`.
- [ ] 2.2 Re-run the §1.1 test and confirm every assertion passes.

## 3. RED — auth.ts dedup does not change behavior

- [ ] 3.1 Move `assertAdmin` (currently duplicated verbatim in `functions/src/index.ts` and
  `functions/src/maintenance/index.ts`) into `functions/src/auth.ts` as an exported function,
  identical body. Update both call sites to import it from `auth.ts` and delete the local
  definitions. This is a pure refactor — no test added, behavior covered by the existing e2e
  authz-matrix scenarios that already exercise `listAuditLogs` and the maintenance admin callables;
  run `npm test` + `npm run typecheck` to confirm nothing broke.

## 4. GREEN — `listPlatformUsers` callable

- [ ] 4.1 Create `functions/src/admin/index.ts`. `listPlatformUsers` (via `loggedCallable`):
  `assertAdmin(context)`; parse `{ limit }` from data, clamp to `[1, 300]` default 100; page through
  `auth.listUsers()` (1000/batch) filtering to `u.email || u.providerData.length > 0` (design §D1);
  cap the filtered list at `limit`, set `truncated` if more remained; for each kept user, read
  `users/{uid}/games` and `collectionGroup('runs').where('ownerUid','==',uid)` in parallel across
  users (`Promise.all`); call `buildAdminUserSummary` per user; return `{ users, truncated }`.
- [ ] 4.2 Re-export `listPlatformUsers` from `functions/src/index.ts`.
- [ ] 4.3 Add the `admin/index.ts` module row to the callables table in `CLAUDE.md`.
- [ ] 4.4 Run `npm run typecheck` (functions + shared) and confirm clean.

## 4b. RED → GREEN — the Auth scan is bounded (design §D4b)

- [ ] 4b.1 RED: add `functions/src/admin/authRoster.test.ts` pinning `isCreatorAccount` (email
  and/or provider ⇒ creator; neither ⇒ anonymous; empty-string email is not a smuggled creator) and
  `pageVerdict` (keeps paging under target; stops at `wanted + 1`, NOT at exactly `wanted`; stops
  complete when Auth has no further page; stops INCOMPLETE at the page cap; the cap does not mark it
  incomplete when Auth had nothing left anyway; "found enough" wins over the cap). Confirm it fails
  because the module does not exist.
- [ ] 4b.2 GREEN: add `functions/src/admin/authRoster.ts` with both pure rules, and reduce
  `listRealAuthUsers` to the I/O around them — early-stop, `MAX_AUTH_PAGES = 50`, and a
  `functions.logger.warn` when the cap fires. `truncated` becomes
  `found.length > limit || !complete` so the client hears one honest "this is not everything".
- [ ] 4b.3 Re-run `npx vitest run authRoster` (13 assertions) and the whole functions vitest suite.

## 5. RED → GREEN — e2e authz + coverage

- [ ] 5.1 RED: add a `listPlatformUsers` scenario to `scripts/e2e-verify.mjs`: as the minted
  `admin` token, call it and assert the seeded demo creator's row has the expected game/run counts;
  as a plain creator token, a participant token, and a staff token, assert each gets
  `permission-denied` (feeds the existing authz denial matrix). Run `npm run e2e` and confirm this
  scenario fails (callable not yet exported, or coverage guard flags it unexercised) before task 4
  lands — if tasks are done in strict order this RED step is really "confirm the coverage guard
  would have failed without it," which is still worth running once for the record.
- [ ] 5.2 GREEN: with `listPlatformUsers` implemented, re-run `npm run e2e` and confirm the new
  scenario passes and the callable-coverage guard is satisfied (no `EXEMPT` entry needed — this
  callable IS invoked).

## 6. RED — admin claim gate (pure)

- [ ] 6.1 Create `apps/creator-web/src/lib/adminGate.test.ts` (vitest, matches
  `deleteConfirm.test.ts`) pinning `isAdminClaim(claims)`: `true` only when `claims.admin === true`;
  `false` for `undefined`, `{}`, `{ admin: false }`, `{ admin: 'true' }` (string, not boolean),
  `null`. Confirm it fails (module doesn't exist).

## 7. GREEN — the gate + admin page + route

- [ ] 7.1 Add `apps/creator-web/src/lib/adminGate.ts` exporting `isAdminClaim`. Re-run §6.1 and
  confirm green.
- [ ] 7.2 Add `listPlatformUsers` to `apps/creator-web/src/services/calls.ts` following the
  existing `callable<Req, Res>('name')` pattern, typed against the shared `AdminUserSummary`.
- [ ] 7.3 Add `apps/creator-web/src/pages/AdminUsersPage.tsx`: on mount, read
  `auth.currentUser?.getIdTokenResult()`; if `!isAdminClaim(claims)`, render an access-denied empty
  state and return WITHOUT calling `listPlatformUsers` (spec: "never calls listPlatformUsers"); else
  call it and render a sortable table (creator, signup, last active, games count/expand, runs
  count/expand) using the existing `components/ui.tsx` kit. All copy through `t.*` — no hardcoded
  strings.
- [ ] 7.4 Register the route in `App.tsx`: `<Route path="/admin/users" element={<AdminUsersPage />} />`
  via `lazyWithRetry`, outside `buildNavDestinations` (not a primary nav entry, same treatment as
  `/live`).
- [ ] 7.5 Add the Hebrew + English dictionary entries this page needs to `i18n.ts`.

## 8. Operator grant script

- [ ] 8.1 Add `scripts/grant-admin-claim.mjs`: resolve target by `--email=<addr>` or `--uid=<id>`
  via Admin SDK; DRY-RUN by default (print target + intended claim change, no mutation); with
  `--execute --confirm-project=<id>` (must match the connected project, else refuse), call
  `admin.auth().setCustomUserClaims(uid, { ...existingClaims, admin: true })` — merge, never
  clobber other claims. Document usage in `DEPLOY.md`.

## 9. Gates

- [ ] 9.1 Run `npm run verify` (typecheck · lint · test · creator:build · play:build ·
  bundle:budget · base:check · i18n:check:strict) and confirm all eight green — this UI change must
  add zero new i18n PART B findings.
- [ ] 9.2 Run `npm run verify:emulator > /tmp/vem-admin.log 2>&1; echo $?` (never piped through
  `tail`) and confirm exit 0, including the new §5 e2e scenario and the untouched rules/simulate
  stages.
- [ ] 9.3 Verify the UI live: start the playtest/emulator stack, run
  `node scripts/grant-admin-claim.mjs --email=<seeded demo creator> --execute --confirm-project=<emulator project>`,
  sign in as that creator in the browser preview, open `/admin/users`, screenshot the rendered
  table; then sign in as a non-admin creator and confirm the access-denied state renders.
