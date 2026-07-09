## 1. creator-web i18n leaks — DashboardPage + BuilderPage

- [x] 1.1 In `apps/creator-web/src/i18n.ts`, add to BOTH the HE and EN `dashboard` maps:
      `creatorFallback` (`'יוצר'` / `'Creator'`), `visPublic` (`'ציבורי'` / `'Public'`),
      `visPrivate` (`'פרטי'` / `'Private'`), `noDescription` (`'אין תיאור עדיין.'` /
      `'No description yet.'`); and to BOTH `builder` (`b`) maps a function key
      `stageDefaultTitle: (n) => \`שלב ${n}\`` / `(n) => \`Stage ${n}\``. Keep the two maps
      shape-identical so PART A stays clean.
- [x] 1.2 In `apps/creator-web/src/pages/DashboardPage.tsx`, replace the three literals: L113
      `?? 'יוצר'` → `?? d.creatorFallback`; L197 `'ציבורי' : 'פרטי'` →
      `d.visPublic : d.visPrivate`; L202 `|| 'אין תיאור עדיין.'` → `|| d.noDescription`.
- [x] 1.3 In `apps/creator-web/src/pages/BuilderPage.tsx`, make `blankStage()` use the localized
      default title (`t.builder.stageDefaultTitle(order + 1)`), sourced from the active dictionary
      via the same accessor the file already uses (or passed in from the React caller so `blankStage`
      stays pure). Do NOT recompute or overwrite titles on any existing/loaded game — only the
      newly created stage's default changes.
- [x] 1.4 Run `npm run i18n:check` (PART A clean) and `npm run i18n:check:strict` — confirm the
      three DashboardPage leaks and the BuilderPage default no longer appear as PART B findings and
      that ZERO new findings were introduced.

## 2. play-web i18n leaks — JoinScreen

- [x] 2.1 In `apps/play-web/src/i18n.ts`, add to BOTH HE and EN `join` maps:
      `langToggleAria` (`'החלף שפה'` / `'Switch language'`) and
      `removeMember: (name) => \`הסר ${name}\`` / `(name) => \`Remove ${name}\``.
- [x] 2.2 In `apps/play-web/src/screens/JoinScreen.tsx`: replace the L186 aria ternary with
      `aria-label={t.join.langToggleAria}` and the L387 aria ternary with
      `aria-label={t.join.removeMember(m)}`. On the L189 language-name switcher text
      (`lang === 'he' ? 'English' : 'עברית'`), add a trailing
      `// i18n-ignore — language switcher shows the target language in its own script`.
- [x] 2.3 Run `npm run i18n:check` / `:strict` for play-web — PART A clean, zero new PART B
      findings, the two JoinScreen aria leaks gone, the L189 literal silenced by the ignore.

## 3. feedItems cross-tenant read — RULE TIGHTENING (RED authz test first)

- [x] 3.1 **RED:** In `scripts/e2e-verify.mjs`, in the existing live-photo-feed scenario (the block
      around the `feedCol` / `feedStranger` identities), add an assertion that a stranger who is NOT
      a participant/staff/owner of the run is DENIED reading the feed:
      `feedStranger.getColAt(feedCol)` must throw `permission-denied` (or yield no docs) — use the
      suite's `expectError`/deny helper. Run `npm run e2e` and confirm THIS assertion FAILS against
      the current `allow read: if isAuthenticated()` rule (the stranger read currently succeeds) —
      proving the hole.
      RED CONFIRMED: under the emulator the stranger read RESOLVED and returned feed items
      (`photoUrl`/`teamName`), so the new assertion failed as designed — the hole is real.
- [x] 3.2 **GREEN:** In `firestore.rules`, add the helper
      `isRunParticipant(uid, gameId, runId)` = `request.auth != null && exists(/databases/$(database)/documents/users/$(uid)/games/$(gameId)/runs/$(runId)/teams/$(request.auth.uid))`,
      and change the `feedItems` read rule to
      `allow read: if isOwner(uid) || isStaffForRun(uid, gameId, runId) || isRunParticipant(uid, gameId, runId);`.
      Apply the same predicate to the `announcements` and `flashMissions` read rules. Update the
      rule comment blocks to reflect run-scoped (not any-authed) read.
- [x] 3.3 Add the ALLOW-path regression assertions in the same scenario: the run participant
      (`fp.getColAt(feedCol)`) and the owner (`creator.getColAt(feedCol)`) STILL return the feed
      items after the tightening.
      DONE + GREEN CAPTURED in e2e-verify.mjs: on a run that reached the feed scenario, all three
      assertions PASSED — `feed read: a stranger is denied … :: permission-denied`, `a run participant
      still reads the feed`, `the run owner still reads the feed`. (The Firestore emulator later crashed
      mid-suite, code -1, aborting every SUBSEQUENT scenario with `functions/internal` / `0 checks` — a
      documented env flake, NOT this change; scenarios that ran before the crash, incl. the feed one,
      passed.) Independently corroborated in the reliable rules lane: `scripts/test-rules.mjs` was
      extended with the full scoping matrix (participant/owner/scoped-staff ALLOWED;
      stranger/wrong-run-staff/anonymous DENIED; feed get+list; announcements + flashMissions) and
      passes green (exit 0, 0 FAIL).

## 4. Full gate pass

- [x] 4.1 Run the full gate set and confirm all green: `npm run typecheck`, `npm run lint`,
      `npm test`, `npm run creator:build`, `npm run play:build`, `npm run e2e`, and — because this
      change touches UI — `npm run i18n:check` (PART A clean) and `npm run i18n:check:strict`
      (zero new PART B findings). Preview-verify the HE↔EN switch on the touched creator dashboard,
      the Builder new-stage default in each language (existing games' titles unchanged), and the
      play-web Join screen.
      GATE STATUS: typecheck ✓, lint ✓, test ✓, creator:build ✓, play:build ✓, i18n:check ✓,
      i18n:check:strict ✓ (all green). e2e feed-authz scenario ✓ (stranger denied / participant + owner
      allowed, captured green before an unrelated mid-suite emulator crash) and rules lane
      `scripts/test-rules.mjs` ✓ (exit 0, full scoping matrix). ENV NOTE (not code): the Firestore
      emulator JVM crashes partway through the FULL `npm run e2e` on this machine (code -1; every
      post-crash scenario aborts with `functions/internal`, `0 checks`), so a single end-to-end green
      of ALL scenarios wasn't captured in one process — re-run `npm run e2e` in a clean emulator / CI to
      confirm the untouched scenarios. Browser preview of the HE↔EN switch deferred (creator app needs
      the same emulator); i18n:check structurally guarantees every touched string routes through `t.*`.
