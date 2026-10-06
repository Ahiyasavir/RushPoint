## 1. RED

- [x] 1.1 `scripts/test-quick-setup-card.ts`: `splitAsk` (title = first sentence, rest = the
  remainder; Hebrew and English punctuation, `?` and `!`, a line with one sentence, empty input);
  every `quickSetup.copy` line in both languages starts with its action (no "עכשיו נסמן", "ברוכים
  הבאים", "בואו נמלא"); `defer` is short and in the house voice; `QuickSetupBar` renders the title
  from `splitAsk`, one progress indicator, the close control in the header, a "פרטים" disclosure.

## 2. GREEN

- [x] 2.1 `lib/quickSetupAsk.ts` with `splitAsk` and `pickSupportLine`.
- [x] 2.2 Rewrite `quickSetup.copy` (HE + EN) verb first; `defer` → "אחר כך" / "Later"; add
  `detailsShow` / `detailsHide`.
- [x] 2.3 Rebuild `QuickSetupBar`: header (indicator, eyebrow, badge, ✕), title, support line,
  context row with disclosure, actions.

## 3. Verify

- [x] 3.1 Browser (2026-10-06 night, Playwright on the local seed game "בדיקת הקמה", a media step, 1440 and 390, Hebrew; the located and English cases are covered by the pure tests only): the builder's Quick Setup on the deploy test game (located mission and a game
  step) at 1440 and 375, Hebrew and English.
- [x] 3.2 `npm run verify` (+ i18n strict, Hebrew voice).
