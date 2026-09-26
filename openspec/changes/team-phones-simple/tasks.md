# Tasks: team-phones-simple

Prerequisite: `attached-phone-uploads` shipped (a second phone must be able to upload at all).

## 1. RED

- [x] 1.1 `scripts/test-device-deep-link.ts` and `scripts/test-sender-quiet.ts` against the
      not-yet-existing parsers/verdict (design D1, D5). Confirm RED.
- [x] 1.2 e2e: attached non-controller submits a photo → accepted with `submittedBy`; same device
      `submitTaskAnswer` → refused `not-controller`; non-attached stranger → denied; `devicePresence`
      lists both devices. Confirm the first and last fail today.
- [x] 1.3 Source guard (design, test strategy) over `TaskRunner.tsx`/`PlayScreen.tsx`. Confirm RED.

## 2. GREEN

- [x] 2.1 `playRoute.ts` parses `join`; `getJoinInfo` accepts an optional device code and returns only the
      team display name; JoinScreen one-field attach (design D1). 1.1 (link part) → green.
- [x] 2.2 `submitStationPhoto`: any attached device; `submittedBy` stamped (design D2). 1.2 (submit part) → green.
- [x] 2.3 `devicePresenceStore.ts` + `getMyTeamState.devicePresence`; `senderQuiet` in shared (design D5).
      1.1, 1.2 → green.
- [x] 2.4 `TaskRunner` `role` prop; `ViewerCard` replaces controls on non-media missions; media controls
      enabled for viewers (design D3). Delete the drawer banner. 1.3 → green.
- [x] 2.5 Hand-over without a dialog + undo toast + haptic (design D4).
- [x] 2.6 "Add a phone" sheet (lazy QR, `routeShare`, typed code) + waiting-screen card + header chip (design D1, D6).
- [x] 2.7 Quiet-sender notice on the other phones with "take over".
- [x] 2.8 Console: show `submittedBy` name in the photo review queue and the media gallery.
- [x] 2.9 i18n he/en for every new string.

## 3. REFACTOR

- [x] 3.1 `TeamDevicesPanel` renders as a sheet from the header strip and from the drawer; one component.
      (Done as ONE component reached two ways: the header "📱 N" chip opens the drawer's devices
      tab through the existing `openRequest`, instead of a second sheet container.)
- [x] 3.2 CLAUDE.md: add `devicePresenceStore.ts` to the single-process module list.

## 4. Verify

- [ ] 4.1 Preview flows in design, test strategy; screenshots at 375×812.
- [ ] 4.2 `npm run verify` (incl. `bundle:budget`), `npm run e2e` green, exit codes to a file.
- [ ] 4.3 After deploy: three real phones, one team: scan to add, hand over twice, film from a
      non-sending phone, kill the sending phone and see the quiet notice within ~4 minutes.
