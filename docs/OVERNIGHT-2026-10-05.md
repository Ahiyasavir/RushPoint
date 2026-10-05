# Overnight 2026-10-05 → 08:00 6.10

Mandate (Ahiya, 21:40): keep working until 08:00, very thoroughly and thinking one step further;
cover every task and every piece of deploy feedback so far, verify seriously, then tidy and document
the files, then start the desktop layouts of the player app and the staff app. Wake-ups every 30
minutes (cron 12a001ef) plus a 07:47 wrap-up (07bbd9ea).

Rules for the night: never deploy, never push, never `git stash` (another session works on reels in
this tree: `.claude/skills/reel-studio/**` is not ours, do not touch or commit it). Commit locally in
coherent batches. Every fix test-first, every UI change seen in a real browser.

## A. Land what is built
- [x] A1 Full gates (`verify` + emulator `e2e`) over the 5.10 fixes: staff code, SOS sheet, now-screen
  picker, invite scroll, print CSS, flag, overlay order, skip without points, contributions,
  publish stamp, fair final score, deploy PDF + test game tooling. Then commit locally.

## B. Open feedback (docs/ISSUES-2026-10-05.md)
- [x] B1 #14 host sheet map shows no streets or text: reproduce in a browser, fix, test.
- [x] B2 #12 "שיתוף והגדרות" goes to the wrong place: find the control, decide what it should do.
- [ ] B3 See every 5.10 fix work in a real browser (local stack): staff sign-in with a code only,
  SOS sheet + callback in console/staff, flag only, one-phone contribution, send back + route from
  the team page, skip stage choice, now-screen picker, host sheet print preview, publish reaching the
  phone, score breakdown.
- [x] B4 Think one step further on each fix: places that show a score (public board, TV, report),
  places that show a staff code (host sheet staff page, codes panel), old links and 6-digit codes,
  CLAUDE.md sections that describe the old behaviour.

## C. Serious verification
- [x] C1 `verify:emulator` (rules, 8-team simulate, adversarial simulate).
- [ ] C2 Browser-fidelity play of the deploy test game end to end at 375px.

## D. Tidy and document
- [x] D1 CLAUDE.md, DEPLOY.md, scripts/README.md, docs/README.md, openspec changes README.
- [x] D2 Archive the finished OpenSpec changes into the living specs.
- [x] D3 Regenerate the deploy checklist PDF (what is left for him + what the next deploy brings).

## E. Desktop layouts
- [x] E1 OpenSpec: player app and staff app on a computer (use the width, no phone squeeze).
- [ ] E2 Build and verify at 1440 and 1024, without changing the phone layout.

## Log
- 22:55 A1 green (verify + e2e ALL PASS, 139 callables) → commit 8eb4d79. B2: tab renamed "שיתוף וצוות" + a jump index on every section of 3+ panels (test-section-index), browser check pending in B3.
- 23:40 B1: cause found by rendering his point: open fields at z16 = no text. Fix: detail map ≤ z16, retina tiles, "איפה זה" overview 3 levels out with the detail frame (test-print-map). Seen in a browser.
- 23:55 B3 in a real browser (local stack, run wM52knEOQyXt2UGHmCwj): staff sign-in with name + code typed "mk6u 5fwb" ✓; answering button ✓; SOS sheet, callback reaches staff app as tel:+972527654321 ✓; now-screen picker auto-opens, star adds the card ✓ (fixed: list closed after the first star); section index + goToPanel ✓ (smooth scroll does not animate in a hidden pane, verified the call); send-back picker above the team page ✓; skip stage without points: stage completed, score 0, no ledger ✓.
- B4 so far: CLAUDE.md scoring section rewritten; speed-bonus line on public board, TV, ceremony; printed staff card says how to sign in without a scanner; SOS service names no longer repeat the number.
- 00:30 D1: scripts/README (checks:pdf, deploy:test-game), docs/README (deploy checks, issues, overnight), CLAUDE.md scoring. D2 prepared: specs for fair-final-score + deploy-test-game, umbrella change deploy-feedback-2026-10-05 (6 capabilities), all five valid; archive after C1. D3: 2026-10-05 PDF report updated; NEXT-draft.md/.pdf = the next deploy's checklist, ready.
- 01:20 E1: change desktop-layouts-play-staff (proposal, spec, tasks). E2 code: useWideLayout (one query, 1024px), staffLayout table (phone order unchanged, 3 desktop columns, quick bar phone-only), StaffConsole renders every section through the table, PlayScreen map + mission column side by side on wide, GameScreen/Screen take `wide`, final screen wider. test-staff-layout + test-wide-layout green, typecheck + lint clean. Browser check after C1 frees the emulator ports.
- 01:55 C1: e2e ALL PASS, Firestore + Storage rules suites passed, doc-cache check ran; the 8-team sim then FAILED live/final ordering parity. Cause: fair-final-score adds the speed bonus only to published/final boards, and the audit compared the UNPUBLISHED live board with the final one (8 finishers ⇒ bonus ⇒ different order). Not drift, the requested behaviour. Audits now compare the published live board with the final one and assert an unpublished board has no bonus (run-audit.mjs, simulate-adversarial.mjs); CLAUDE.md notes it. Rerun: LOAD SIM CONSISTENT, ADVERSARIAL SIM CONSISTENT.
- 02:05 D2: archived staff-code-from-join-code, sos-callback-and-authorities, fair-final-score, deploy-test-game, deploy-feedback-2026-10-05 into openspec/specs (11 new capability specs).
