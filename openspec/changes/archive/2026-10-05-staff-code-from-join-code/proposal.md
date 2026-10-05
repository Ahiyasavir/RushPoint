## Why

A marshal who opens the staff app without the organizer's link (the "כניסת מארגנים" link on the
join screen, or typing player.rush-point.com/?staff) was asked for an owner id, a game id and a run
id before the code: three internal identifiers nobody has. Ahiya, 2026-10-05: "מסובך רצח ולא
אידיאלי בכלל, חייב לפשט את זה". The 6-digit staff PIN cannot address a run on its own: it is only
unique inside one run.

His design: the staff code IS the game's join code, with extra characters planted at random places
inside it. Measured with him: one planted character gives about 250 possible codes (players know
the join code, so a curious player could try them all within an event); two give about 30,000,
beyond reach of the existing lockout. He chose two.

## What Changes

- A new staff code is the run's 6-character join code with 2 characters from the join-code alphabet
  inserted at random positions (for example `63MZWC` → `6K3MZW7C`). Codes made before this change
  keep working through the links that carry the run.
- The staff sign-in screen asks for a name and the code, nothing else, with or without a link.
- `staffSignIn` accepts a code alone: the server finds the run by trying every way of removing two
  characters from it against `accessCodes/{CODE}` (at most 28 documents, one `getAll`), then checks
  the code against that run's staff codes exactly as before. A wrong code built on a run's join code
  counts against THAT run's lockout, so guessing stays bounded.
- No new collection: the join code document already points at the run, so nothing new has to be
  cleaned up when a game or account is deleted.

## Capabilities

### New Capabilities
- `staff-code-from-join-code`: how a staff code is made and how it finds its run.

## Impact

- New pure module `packages/shared/src/staffCode.ts` (`makeStaffCode`, `normalizeStaffCode`,
  `candidateJoinCodes`). Test: `scripts/test-staff-code.ts`.
- `functions/src/runs/staffInvite.ts` (mint from the run's join code), `functions/src/index.ts`
  (`staffSignIn` resolves the run from the code, returns the run address).
- `apps/play-web/src/screens/StaffConsole.tsx` (`StaffSignIn`), `services/calls.ts`, i18n HE + EN.
- `apps/creator-web/src/i18n.ts` (the staff link note: the link is now optional).
- `scripts/e2e-verify.mjs`: sign in with the code alone; a wrong code counts against the run.
