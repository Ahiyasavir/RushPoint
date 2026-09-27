## Why

Ahiya asked (2026-09-01, looking at `/admin/templates`) to see the **mission bank** in the admin
templates area and to be able to **edit and delete** missions from there.

Two DIFFERENT systems could have answered that, and the distinction is the whole reason this
proposal exists:

1. **Game templates** (`isTemplate: true` `Game` documents) — ALREADY SHIPPED. `/admin/templates`
   lists them and "Edit" opens the ordinary Builder. This is what the screen he was looking at
   shows, and it is NOT the mission bank.
2. **The smart-build mission bank** (`apps/creator-web/src/taskBank.ts`, `TASK_BANK`, 89 entries) —
   a static in-repo TypeScript array the composer (`composeGame.ts`) draws individual missions from
   when a creator uses "compose one for me". Its own closed tag vocabulary (`BankTagId`,
   `bankTags.ts`) and its own 40-rule authoring doctrine. Changing it today means editing TypeScript
   and shipping a build.

This proposal is for (2). It does not touch (1).

**Decided with Ahiya (2026-09-01):**
- **Storage: an OVERLAY, not a migration.** `taskBank.ts` stays the base content. Admin edits and
  deletions are stored as a small Firestore collection of per-key overrides, merged at read time.
  Chosen over moving all 89 entries into Firestore because it is far smaller, carries no migration
  risk, keeps the authoring doctrine and its three pure test suites intact, and lets any mission be
  reset to its source content with one click. Accepted cost: two sources of truth for the bank's
  content, which the merge module documents and the admin page makes visible ("edited" badges).
- **Scope: edit and delete only.** Creating a brand-new mission from the UI is deliberately out —
  a new entry needs a `build()` factory (task type, verification, capacity, setup steps), which is
  authoring, not editing. New missions keep going through `taskBank.ts` and its 40 rules.

## What Changes

- New Firestore collection `missionBankOverrides/{key}` — one document per bank entry that has been
  edited or deleted. Admin-write via callable only; readable by any authenticated user (the
  composer runs entirely CLIENT-side, so the merge happens in creator-web).
- New pure module `apps/creator-web/src/lib/missionBankOverlay.ts`:
  `applyBankOverrides(TASK_BANK, overrides)` → the effective bank. **Total and never throws**, on
  the same terms as `composeGame.ts` itself: an override naming an unknown key is ignored, an
  invalid field is ignored (not applied as garbage), and a `difficulty` override patches BOTH
  `entry.difficulty` and `build().difficulty` so the invariant `scripts/test-task-bank.ts` enforces
  cannot be broken from the UI.
- **The merge refuses a deletion that would leave the composer unable to build a game.** The bank
  needs at least one `start`-tagged and one `finish`-tagged mission; a stored deletion that would
  empty either pool is reported and NOT applied. A bad row in Firestore must never be able to turn
  "compose one for me" into a permanent dead end.
- New admin-only callables in `functions/src/admin/missionBank.ts`: `listMissionBankOverrides`,
  `setMissionBankOverride` (edit or mark deleted), `clearMissionBankOverride` (reset to source).
  The two mutations are audit-logged — they change what every creator on the platform is offered.
- New admin page `/admin/mission-bank`, gated exactly like `/admin/templates` and `/admin/users`,
  linked from `/admin/templates` so the bank is reachable from where he went looking for it: the
  full list of entries (key, title, tags, difficulty, family, edited/deleted state), a detail editor
  for title, description, tags (a closed `BankTagId` picker — never free text), difficulty, minAge
  and transitMinutes, plus delete and reset-to-source.
- `SmartBuildWizard.tsx` and `DashboardPage.tsx` stop importing `TASK_BANK` directly and read the
  merged bank through a module-cached loader (same three-layer shape as `lib/templateCache.ts`:
  in-flight promise → module memo → refresh), so composing a game costs at most one read of a
  collection that is empty until an admin edits something.

### Non-goals
- No creation of new bank entries from the UI (see the decision above).
- No change to `bankTags.ts`'s vocabulary.
- No change to `/admin/templates` or to how a composed game is edited afterwards.
- No relaxation of the bank's authoring rules — the overlay validator is as strict as
  `scripts/test-task-bank.ts` about every field it can reach.

## Capabilities

### New Capabilities
- `mission-bank-admin`: the `missionBankOverrides` collection, the three admin callables, the pure
  overlay merge, and the `/admin/mission-bank` page.

## Impact

- **creator-web**: `lib/missionBankOverlay.ts` (pure), `lib/missionBankCache.ts` (the read),
  `pages/AdminMissionBankPage.tsx` + route + link, `services/calls.ts` wrappers, i18n strings.
- **Callables**: `functions/src/admin/missionBank.ts`, re-exported from `functions/src/index.ts`;
  declared in `PRIVILEGED_CALLABLES` (`scripts/lib/callableHardening.mjs`) for the two mutations.
- **Firestore**: `missionBankOverrides` rules — `allow read: if request.auth != null`,
  `allow write: if false`.
- **Pure logic**: `scripts/test-mission-bank-overlay.ts`, auto-discovered by `npm test`.
- **e2e**: a scenario in `scripts/e2e-verify.mjs` covering the three callables, required by the
  callable coverage guard.
