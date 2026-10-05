## Why

Ahiya, 2026-10-05: the SOS flow should ask the team for a phone number of one of its members so the
organizers can call back, and it should not only point to Magen David Adom: "a button to contact
the authorities, and then it gives them all the options" (police and fire as well).

Today SOS is a confirm dialog with one `tel:101` link, and the alert reaches the console with a
location and nothing to call.

## What Changes

- The SOS button opens an SOS sheet instead of a confirm dialog:
  - **"פנייה לרשויות"** opens three call links: Magen David Adom 101, Police 100, Fire and rescue
    102. Real `tel:` links, so the phone dials even if the app is stuck, and the sheet stays open.
  - **The alert to the organizers** with a field "a phone number of one of you, so we can call
    back". It is remembered on this phone for the run. An empty field never blocks sending (in an
    emergency an alert without a number beats no alert); a number that cannot be dialled is pointed
    out instead of being sent.
  - After sending: the organizers got it and will call back on the number given; stay where you are.
    The authorities button stays on screen.
- `triggerSOS` accepts `callbackPhone`, refuses one that is not a dialable number, and stores it on
  the alert. Alerts are already in the 90-day run PII sweep.
- The run console and the staff app show the number on the SOS row as a call link.

## Capabilities

### New Capabilities
- `sos-callback-and-authorities`: what the SOS sheet offers and what an SOS alert carries.

## Impact

- `packages/shared/src/emergency.ts` (`EMERGENCY_SERVICES`, `sosCallbackVerdict`).
- `functions/src/index.ts` (`triggerSOS`).
- play-web: new `components/SosSheet.tsx`, `screens/PlayScreen.tsx`, `services/calls.ts`, i18n.
- creator-web `RunConsolePage.tsx` alert row; play-web `StaffConsole.tsx` alert row; i18n.
- Tests: `scripts/test-emergency.ts` (rewritten for the sheet), `scripts/e2e-verify.mjs`.
