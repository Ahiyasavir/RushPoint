## Why

At prep level 2 ("just locations") the composer turns about 11 missions per game into a
required map pin, one mission at a time (measured over 4,032 games per level,
`docs/auto-build-setup-research-2026-10-02.md` §1.3). Most of those pins are invented:
the mission is a `fromAnywhere` bank entry whose substance is a conversation, a riddle
or a group agreement, and a place adds nothing to it. Dropping pins is about 80% of all
the setup work a composed game asks for, and it is what a creator reads as "this is a
lot of work".

## What Changes

- A bank mission declares whether a place helps it: `siting: 'never' | 'possible' |
  'must'`, and when it helps, a generic `spot` kind (bench, big tree, sign, open grass,
  entrance, any corner) that tells the creator what to look for. Absent `siting` is
  derived from today's tags, so an unannotated mission behaves as it did.
- **Stations, not missions.** In a placed game each stage gets at most ONE invented pin:
  one anchor mission per stage (preferring one with a spot kind, never a `never`). The
  stage's other play-anywhere missions are played wherever the team stands. A stage
  that already holds a mission sited by nature (`locationBased`) gets no invented pin.
- The Quick Setup prompt for a station names the spot kind ("a bench works well").
- The questionnaire's prep question shows its cost live: "you will place N points on
  the map (about M minutes)".

## Capabilities

### New Capabilities
- `composer-siting-by-station`: how the composer decides which missions of a placed
  game need a pin, and what the questionnaire says it costs.

## Impact

- `apps/creator-web/src/taskBank.ts` (type + annotations), `lib/composeGame.ts`
  (siting resolver, station anchoring, prep cost preview), `components/SmartBuildWizard.tsx`
  (the cost line), i18n HE + EN.
- Tests: new `scripts/test-composer-siting.ts`; `scripts/test-composer-wizard-steps.ts`
  updated where it asserted a pin per siteable mission.
- Composed games put more teams through one spot. Capacity and routing already handle
  it; the load sim is re-run as part of `verify:emulator`.
