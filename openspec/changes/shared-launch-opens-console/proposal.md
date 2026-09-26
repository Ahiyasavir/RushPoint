# Proposal: shared-launch-opens-console (queued, not started)

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
