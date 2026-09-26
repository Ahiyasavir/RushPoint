## Why

Ahiya, 2026-09-25: *"I want the SOS button to also guide them to call 101 if there is a serious
problem."*

Today the SOS flow (`apps/play-web/src/screens/PlayScreen.tsx`, `sos()`) is a text confirm "send a
distress alert to the organizers?", then "sent, stay where you are, help is on the way" or "failed".
It only ever reaches the ORGANIZER, who may be a teenager running a birthday game kilometres away.
Nothing in the app tells a team with an injured member or a real danger to call emergency services,
and the "help is on the way" copy can actively delay that call. The dialog component
(`components/dialog.tsx`) supports text only, so there is no way to offer a tap-to-call link today.

## What Changes

- The SOS confirmation leads with the emergency path: for an injury or real danger, call 101
  (Magen David Adom) now, with a one-tap call button; the organizer alert is the second option.
- The "sent" message no longer promises that help is on the way; it says the organizers were alerted
  and repeats the 101 call button for a serious situation.
- The "failed" message offers the 101 call button as well.
- The TaskRunner "I'm stuck" alert (the second `triggerSOS` entry point) is unchanged in purpose (it
  is not an emergency) but its failure line mentions 101 for emergencies.
- The number is declared once, so it can never drift between screens.

## Non-goals

- Calling the organizer (that is `quick-dial-and-actions`).
- Locale-dependent emergency numbers (the platform is Israel-only by geo-block; 101 is correct for
  every player the API accepts).
- Automatically dialing anything.

## Surfaces

play-web only: `components/dialog.tsx` (optional call action), `screens/PlayScreen.tsx`,
`components/TaskRunner.tsx`, `i18n.ts`; shared constant `EMERGENCY_MEDICAL_NUMBER` in
`packages/shared/src/emergency.ts`.
