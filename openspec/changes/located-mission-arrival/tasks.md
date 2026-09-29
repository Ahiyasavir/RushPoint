# Tasks: located-mission-arrival

Source: `docs/field-report-2026-09-27.md` items 11-13 + decisions of 2026-09-28.

## 1. RED
- [x] 1.1 `scripts/test-mission-arrival.ts` (arrivalGateApplies, sealed-located stub sweep,
      missionPins, bearingDeg). Confirm RED.
- [x] 1.2 e2e scenario "arrival gate" + `markTeamArrived` authz row; sanitizer allowlist for the
      stub. Confirm RED.

## 2. GREEN
- [x] 2.1 Shared helpers + `Run.arrivalGate`, `RunTaskRecord.arrivalByOperator`. 1.1 → green.
- [x] 2.2 `launchRun` stamps the flag; sanitizer D2; `reportArrival` D3; `getMyTeamState`
      `missionPins`; `markTeamArrived` + hardening/rate-limit/capability entries. 1.2 → green.
- [x] 2.3 play-web: sealed-located card in `TaskRunner`; `PlayScreen` probe for both seal kinds;
      `NavMap` D5 + D6; i18n.
- [x] 2.4 creator-web: team page "let them in"; staff console same; i18n.

## 3. Verify
- [x] 3.1 Preview with synthetic GPS: far → chip + arrow; near → opens; map fly/fit on a new mission;
      locked pins; hidden circle only.
- [ ] 3.2 `npm run verify`, `npm run e2e`, exit codes to a file.

## Progress (2026-09-28)

Implemented. e2e 'arrival gate' all PASS; two older scenarios now arrive first. Browser: flag + label + chip above the sheet. Staff console: `getRunOutline` now reports `arrivalGate` (staff cannot read the run doc; one read per staff session) and `staffLetInTarget` (pure, in `lib/staffRouteList.ts`, RED first) decides when the button shows: gate on, a mission with a place, not yet arrived. e2e assertion added for the outline flag; staff button not yet clicked in a browser (needs the new functions build in the dev emulator).
