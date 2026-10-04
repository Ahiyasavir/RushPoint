## Why

A host running a game on the day needs one thing in their hand: where every station is,
in what order, how many missions each stage needs, how each mission is judged
(automatic or a person approves), and every answer. Today none of that exists outside
the Builder, which is a phone-unfriendly editor of fields, not a briefing. The station
QR print in the Run Console covers only code stations and prints no answers.

The plan and its research are in
`docs/host-sheet-and-prep-plan-action-plan-2026-10-02.md` (part B) and
`docs/auto-build-setup-research-2026-10-02.md`.

## What Changes

- A printable **host sheet** for any game, at `/host-sheet/:gameId`, and for a live
  run at `/host-sheet/:gameId?run=<runId>` (which adds the join code and the staff codes).
- A cover (title, facts, how you win in plain words, join code), the route stage by
  stage with each stage's rule in words ("2 of 4", "only one of", "opens after 20 min",
  "final stage"), a card per mission (type in words, what players see, where, the
  answer, approval mode, hint and its price, limits, operator notes), a condensed
  answer table, and a game-day page.
- **Staff codes tear-off page**: last page, run version only, disabled codes excluded,
  and omitted entirely when "include answers" is off.
- Three switches before printing: include answers (on), one card per page (off),
  include map (on).
- Printed through the browser (print / save as PDF), A4 portrait, readable in black
  and white, RTL in Hebrew.
- Reached from the Builder `⋯` menu and from the Run Console.
- No new callable and no server change: the owner already reads the full game through
  `getGame`, and the run's staff codes through the listener `StaffCodesPanel` uses.

## Capabilities

### New Capabilities
- `host-sheet`: a printable briefing of a game (and optionally one run) for its host.

## Impact

- New: `apps/creator-web/src/lib/hostSheet.ts` (pure model), `pages/HostSheetPage.tsx`,
  a route in `App.tsx`, menu entries in `BuilderPage.tsx` and `RunConsolePage.tsx`,
  i18n HE + EN.
- Tests: `scripts/test-host-sheet.ts` (pure lane).
- No server, rules or data-model change.
