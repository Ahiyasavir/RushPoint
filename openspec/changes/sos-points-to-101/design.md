## Decisions

### D1: one constant

`packages/shared/src/emergency.ts`: `EMERGENCY_MEDICAL_NUMBER = '101'` and
`emergencyTelHref() => 'tel:101'`. Tests pin the value, so a change is deliberate.

### D2: a dialog that can offer a call

`dialog.confirm/alert` gain an optional `callAction: { href: string; label: string }`, rendered as a
full-width danger-styled `<a href="tel:…">` ABOVE the dialog's buttons (a link, not a button: the OS
handles `tel:` and it works even if our JS stalls). It does not close the dialog, so the player can
still send the organizer alert after calling.

### D3: copy (he/en, `t.play.*`)

- confirm: "פציעה או סכנה ממשית? התקשרו עכשיו למד״א 101. לכל בעיה אחרת, שלחו התראה למארגנים."
  call label "📞 חיוג ל־101", confirm label unchanged ("שליחת מצוקה").
- sent: "המארגנים קיבלו את ההתראה. הישארו במקום. במצב חירום התקשרו 101." (no "help is on the way").
- failed: "ההתראה לא נשלחה. נסו שוב. במצב חירום התקשרו 101." + the call link.
English: the same content with "Magen David Adom (101)".

## Test strategy

- Pure (`scripts/test-emergency.ts`): the constant and href; a source guard that every
  `dialog.*(t.play.sos…)` call in `PlayScreen.tsx` passes `callAction`, and that no dictionary value of
  `sosSent` still promises help "on the way" (he: "עזרה בדרך", en: "on the way").
- `scripts/test-play-a11y-scan.ts` stays green (the link has text).
- UI via preview at 375×812: tap SOS, the 101 call link is the first thing in the dialog; screenshot.
  `npm run i18n:check:strict`.
