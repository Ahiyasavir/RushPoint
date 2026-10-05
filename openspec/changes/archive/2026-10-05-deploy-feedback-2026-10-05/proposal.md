## Why

Ahiya checked the 2026-10-05 production deploy (commit 695b7af) and reported fifteen problems
(docs/ISSUES-2026-10-05.md). The larger ones got their own changes (staff-code-from-join-code,
sos-callback-and-authorities, fair-final-score, deploy-test-game). This change records the rest:
fixes and small features built test-first the same night, so the living specs say what the product
now does.

## What Changes

- **Host sheet map context** (#14 "no streets, no text, nothing"): the detail map stops at zoom 16
  with retina tiles, and an "איפה זה" overview three levels out marks the detail frame. His one
  station was in open fields, where zoom 16 has no names at all.
- **Console section index** (#12 "goes to the regular QR"): the tab is "שיתוף וצוות", and a section
  of three or more panels opens with an index that jumps to each.
- **Team picker in "עכשיו"** (#4): search and star teams where the organizer prepares; it opens by
  itself while nothing is followed and stays open while starring.
- **Skip a stage with or without points** (#11): `skipStage({ noPoints })`, and the console asks.
- **Published standings reach phones at once** (#7): publishing stamps each team document, which
  every phone already listens to; phones otherwise read the run on a 60 s poll.
- **"I did my part" reaches the phone** (#6): `taskContributions` joins the participant projection,
  and the submitting phone counts as having done its part.
- Bug fixes with tests and no new behaviour to specify: the host sheet printed blank pages (a dead
  global print rule, test-print-css), the send-back and route pickers drew under the team page
  (test-overlay-order), the flag's label covered the road (test-active-flag-marker), "הזמנת צוות"
  scrolled to nothing (goToPanel).

## Impact

creator-web (printMap, hostSheet, HostSheetPage, RunConsolePage, FollowedStrip, runConsoleLayout,
SendBackPicker, RoutePicker, index.css, i18n), play-web (NavMap, TaskRunner, i18n), shared
(testMode projection, teamParticipation), functions (skipStage, completeTask, refreshLeaderboard).
Tests named in each requirement.
