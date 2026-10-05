## 1. RED

- [x] 1.1 `scripts/test-emergency.ts`: the three services and their numbers, declared once;
  `sosCallbackVerdict` (empty ⇒ ok without a number, an Israeli mobile ⇒ ok, garbage ⇒ refused);
  the SOS sheet renders a `tel:` link per service and the callback field; the copy names 101 and
  never promises help is coming. Run it and watch it fail.
- [x] 1.2 `scripts/e2e-verify.mjs`: `triggerSOS` stores `callbackPhone`; a bad one is
  `invalid-argument`.

## 2. GREEN

- [x] 2.1 shared: `EMERGENCY_SERVICES`, `sosCallbackVerdict`.
- [x] 2.2 `triggerSOS` accepts and stores `callbackPhone`.
- [x] 2.3 play-web `SosSheet` + PlayScreen wiring + `calls.ts` + i18n HE/EN.
- [x] 2.4 console + staff alert rows show the number as a call link.

## 3. Verify

- [x] 3.1 Browser at 375px: the sheet, the authorities list, sending with and without a number.
- [x] 3.2 Gates: `npm run verify`, `npm run e2e`, `npm run i18n:check:strict`.
