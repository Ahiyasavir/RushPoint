# Tasks: staff-capabilities

## 1. RED

- [x] 1.1 `scripts/test-staff-capabilities.ts` against the not-yet-existing `staffCapabilities.ts`. Confirm RED.
- [x] 1.2 Extend `scripts/test-callable-hardening.ts` to require a capability per staff-reachable callable. Confirm RED.
- [x] 1.3 e2e scenarios (design, test strategy). Confirm RED (today every staff call is allowed, codes are single-use).
- [x] 1.4 Rules tests for `staffGrants`, codes and the `teamLocations` capability. Confirm RED.

## 2. GREEN

- [x] 2.1 `packages/shared/src/staffCapabilities.ts`; `Game.staffDefaults` type. 1.1 → green.
- [x] 2.2 `assertStaffCan` in `functions/src/auth.ts`; the 14 callables declare their capability. 1.2 → green.
- [x] 2.3 `inviteStaff` creates multi-use labelled codes with capabilities (default from the game);
      `staffSignIn` handles multi-use codes, writes the grant, mints `caps`/`codeId`; legacy paths.
- [x] 2.4 `updateStaffCode`, `removeStaffMember` (+ `revokeRefreshTokens`), `refreshStaffSession`; exports,
      `PRIVILEGED_CALLABLES`, rate limits, typed wrappers. 1.3 → green.
- [x] 2.5 `firestore.rules` (design D4). 1.4 → green.
- [x] 2.6 `updateGame`/`importGameFile` validate `staffDefaults`; Builder settings checklist; `BUILDER_EDITABLE_FIELDS`.
- [x] 2.7 Run Console staff codes panel (design D5), replacing the hardcoded permissions array.
- [x] 2.8 Staff console: `useStaffGrant`, render only allowed actions, react to version/removal.
- [x] 2.9 i18n he/en both apps.

## 3. REFACTOR

- [x] 3.1 Stop writing the dead `permissions` field (keep reading it in the legacy path for one release).
- [x] 3.2 CLAUDE.md: a new staff-reachable callable must declare its capability.

## 4. Verify

- [x] 4.1 Preview flow (design, test strategy).
- [ ] 4.2 `npm run verify:emulator` (e2e + rules) and `npm run verify` green, exit codes to a file.
- [ ] 4.3 Deploy order: functions (VPS) first, then rules (`--only firestore:rules,firestore:indexes`), then hosting.

## Progress notes (2026-09-26)

- RED observed for 1.1 (module missing), 1.2 (C6 listed all 17 bare gates, 0 gated) and the refusal
  marker / classifier cases. NOT observed RED: the rules tests (1.4) and the e2e scenario (1.3) were
  written after the rules and callables; the creator-web `staffCodes` vitest was written just
  before its implementation but could not run until shared was rebuilt. Honest order, recorded.
- Found by the C6 guard, not in the design: `getRunSurveyResults` also admitted staff (inline token
  check). It exposes teams' own free-text answers, so it is gated by `review`.
- Decided: `getRunOutline` is an ALWAYS-granted capability (`outline`): mission names only, and the
  staff console shows raw ids without it.
- Compatibility: an invite minted before this change has no `capabilities` field and resolves FULL
  (not "safety only"), and stays single-use; a staff token without a grant is full (legacy, logged
  once). The e2e "Fix 5" concurrency scenario now pins single-use on a legacy invite and adds the
  opposite for a new shared code (4 concurrent sign-ins, 4 grants).
- A refusal carries `details.reason` (`staff-capability-missing` / `staff-removed`). Without it the
  staff app classified `permission-denied` as an expired session and sent the marshal to the PIN
  screen, where the same code is refused again (`classifyStaffError`, test-failure-visibility).
- `staffDefaults` is exported in the game file and validated LOUDLY on save and import (a dropped
  value means everything). Found on the way and spun off: the game-file drift guard never
  typechecks, so autoStartLateJoiners / autoApproveAllMedia / requireAllMembersOnline are silently
  lost on export (separate task).
- Gates so far: typecheck green; e2e `--only=staff` 6 scenarios green (37 checks in the new one);
  rules suites green; targeted unit tests green. Owed: full verify + full e2e, 4.1 preview, deploy.

### Browser verification (2026-09-26)

- Run Console: "invite staff" opens the codes panel with the new-code form; a "Judge" code was
  created and listed with its PIN and permissions. Reloading keeps the panel (a one-document
  listener says the run has codes; before that fix the panel vanished on reload).
- Staff phone on that code: review, hold, map, staff channel and chat only; no point buttons, no
  skip / send back, no announcements, no feed.
- Organizer ticked "points" and saved: the staff phone grew -10/-5/+5/+10 and "custom amount" within
  seconds, no reload, no new PIN; `refreshStaffSession` fired (the version bump).
- Remove person: confirm dialog, then the staff phone switched to the "removed" card. Fixed while
  checking: the staff channel and alerts are now hidden once removed; the copy no longer assumes one
  male organizer or a male staff member.
- Known and accepted: a removed person who RELOADS sees "session expired" (their refresh token was
  revoked) and, if they sign in again, "the organizers removed you". The server refuses every action
  throughout.
- Builder: "What run staff can do" under Game capabilities; unticking points autosaved
  `staffDefaults` without `score`.
- Two more real-world fixes from the self review: the staff access hook now follows the auth state
  (a reloaded console used to read `auth.currentUser` as null once and never listen), and removing
  staff never revokes the session of a phone that also PLAYS in the run (team or attached device).
