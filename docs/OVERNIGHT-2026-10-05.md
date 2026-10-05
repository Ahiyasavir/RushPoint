# Overnight 2026-10-05 → 08:00 6.10

Mandate (Ahiya, 21:40): keep working until 08:00, very thoroughly and thinking one step further;
cover every task and every piece of deploy feedback so far, verify seriously, then tidy and document
the files, then start the desktop layouts of the player app and the staff app. Wake-ups every 30
minutes (cron 12a001ef) plus a 07:47 wrap-up (07bbd9ea).

Rules for the night: never deploy, never push, never `git stash` (another session works on reels in
this tree: `.claude/skills/reel-studio/**` is not ours, do not touch or commit it). Commit locally in
coherent batches. Every fix test-first, every UI change seen in a real browser.

## A. Land what is built
- [ ] A1 Full gates (`verify` + emulator `e2e`) over the 5.10 fixes: staff code, SOS sheet, now-screen
  picker, invite scroll, print CSS, flag, overlay order, skip without points, contributions,
  publish stamp, fair final score, deploy PDF + test game tooling. Then commit locally.

## B. Open feedback (docs/ISSUES-2026-10-05.md)
- [ ] B1 #14 host sheet map shows no streets or text: reproduce in a browser, fix, test.
- [ ] B2 #12 "שיתוף והגדרות" goes to the wrong place: find the control, decide what it should do.
- [ ] B3 See every 5.10 fix work in a real browser (local stack): staff sign-in with a code only,
  SOS sheet + callback in console/staff, flag only, one-phone contribution, send back + route from
  the team page, skip stage choice, now-screen picker, host sheet print preview, publish reaching the
  phone, score breakdown.
- [ ] B4 Think one step further on each fix: places that show a score (public board, TV, report),
  places that show a staff code (host sheet staff page, codes panel), old links and 6-digit codes,
  CLAUDE.md sections that describe the old behaviour.

## C. Serious verification
- [ ] C1 `verify:emulator` (rules, 8-team simulate, adversarial simulate).
- [ ] C2 Browser-fidelity play of the deploy test game end to end at 375px.

## D. Tidy and document
- [ ] D1 CLAUDE.md, DEPLOY.md, scripts/README.md, docs/README.md, openspec changes README.
- [ ] D2 Archive the finished OpenSpec changes into the living specs.
- [ ] D3 Regenerate the deploy checklist PDF (what is left for him + what the next deploy brings).

## E. Desktop layouts
- [ ] E1 OpenSpec: player app and staff app on a computer (use the width, no phone squeeze).
- [ ] E2 Build and verify at 1440 and 1024, without changing the phone layout.

## Log
