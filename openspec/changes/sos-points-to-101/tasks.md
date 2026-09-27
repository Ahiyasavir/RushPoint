# Tasks: sos-points-to-101

## 1. RED

- [x] 1.1 `scripts/test-emergency.ts` (design, test strategy). Run it; confirm it fails (missing module,
      no `callAction`, "עזרה בדרך" still in `sosSent`).

## 2. GREEN

- [x] 2.1 `packages/shared/src/emergency.ts`; export from the barrel.
- [x] 2.2 `dialog.tsx`: optional `callAction` for confirm and alert (design D2).
- [x] 2.3 `PlayScreen.sos()`: pass the 101 call action to the confirm, sent and failed dialogs; new copy (D3).
- [x] 2.4 `TaskRunner` help-alert failure line mentions 101. 1.1 → green.

## 3. Verify

- [x] 3.1 Preview at 375×812 (screenshot of the SOS dialog).
- [ ] 3.2 `npm run verify` green (exit code to a file).

## Progress notes (2026-09-25)

- Verified in the running app at 375×812: the SOS confirm leads with a `tel:101` link.
- Critical review: the call link and "send SOS" were both solid red and read as the same control;
  the call is now white with a thick red border. "101" is bound to the preceding word with a no-break
  space so it never wraps alone.
