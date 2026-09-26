# Proposal: shared-launch-opens-console

## Why

Requested by the product owner on 2026-09-26: "When a game is shared with me and I launch it
from the link, it shows the code but does not open the manager dashboard. I want it to open the
dashboard right away."

Today `SharedGamePage` → `launchSharedRun` (`functions/src/games/share.ts`) creates the run under
the LINK OWNER's account (`launchRunCore({ ownerUid: link.ownerUid, … })`). The person who pressed
launch is not the owner, so the owner-only Run Console (`/run/:gameId/:runId`) is closed to them;
the page instead shows `LaunchedPanel` (access code, join link, a staff link and a staff PIN).
Operating the run therefore means copying a PIN into the play-web staff console, a much thinner
tool than the Run Console.

## What changes (to decide in design)

The launcher should land in a full manager dashboard for the run they just started, with no PIN
copying. Two candidate approaches:

- **A. Launch a copy in the launcher's own account.** `duplicateGame` (through `rehostGameMedia`)
  then the ordinary `launchRun`, then `navigate('/run/<newGameId>/<runId>')`. The launcher owns
  everything and gets the real console. Cost: a copy appears in their games list; billing/free-run
  accounting moves to the launcher; the link's `allowCopy=false` setting would need a rule (a
  hidden or locked copy).
- **B. Give the launcher operator access to the owner's run.** A run-scoped operator grant (like
  staff capabilities, but for signed-in creators) that the Run Console honours, then navigate
  straight there. The game stays the owner's. Cost: the Run Console and its callables need a
  non-owner authorization path, audited and covered by the e2e authz matrix.

## Out of scope

Changing who pays for a shared launch, or the share link's copy/launch limits.

## Decision (product owner, 2026-09-26)

"I don't want it to open for me; I want the dashboard to open for whoever launches it. Right now
they only see a panel of codes, very clumsy and unclear." ⇒ **Approach A.**

- `launchSharedRun` copies the game into the LAUNCHER's account (through `rehostGameMedia`, like
  `duplicateGame`), launches the run there through `launchRunCore`, and returns
  `{ gameId, runId, accessCode }`. The client navigates straight to `/run/:gameId/:runId`; the codes
  panel (`LaunchedPanel`) is gone.
- The copy carries `sharedLaunch: { locked, fromToken }`. It is hidden from the games list (it is a
  run of someone else's game, reached from the runs list). When the link does not allow copying
  (`allowCopy: false`) it is `locked`: `updateGame`, `duplicateGame`, `exportGameFile`,
  `publishGame`, `translateGame` and `createGameShareLink` refuse it (`failed-precondition`,
  `share-launch-locked`), and the Builder shows a notice instead of the editor. Otherwise the link
  would be a copy door the owner closed.
- The run lives in the launcher's account. The owner no longer sees it; the link's `launchCount`
  still tells them it was used. If payments are switched back on, the launcher's own wallet decides
  the launch, like any launch they make.
- No staff PIN is minted any more: the launcher IS the owner of the copy.

## Tasks

- [x] 1 e2e (RED): launch returns `gameId`; the run is in the LAUNCHER's live runs, not the owner's;
      the copy is flagged and locked for a no-copy link; each locked door refuses; the copy is not in
      `listGames`; a player can join; the count, revoke and unauthenticated refusals still hold.
- [x] 2 Server: `launchSharedRun` rewrite + `assertNotShareLocked` on the six doors + `listGames` filter.
- [x] 3 Client: navigate to the console; the Builder's locked notice; i18n he/en.
- [x] 4 Browser check (a second creator opened a no-copy link, pressed "הפעלת המשחק" and landed in the Run Console of their own locked copy; the Builder shows the lock notice; the games list stays empty and the live-run chip leads back): launch from a share link lands in the Run Console.
