# Overnight 2026-10-05 → 08:00 6.10

## סיכום לבוקר (6.10)

**הכל נבנה ונבדק, שום דבר לא עלה.** 12 קומיטים מקומיים מאז הדיפלויי של 5.10 על field-report-2026-09-27 (de18c30 עד 35d11cf, כולל תיקון לשון היחיד), לא בוצע push ולא דיפלויי. כשתחליט לעלות: DEPLOY.md, ורשימת הבדיקות לדיפלויי הבא מוכנה ב-`docs/deploy-checks/NEXT-draft.pdf` (16 במחשב, 4 בטלפון, 2 מיוחדות). משחק הבדיקות ייווצר לבד.

**מה שביקשת**
- כל 15 התקלות מהבדיקות של 5.10 נבנו (`docs/ISSUES-2026-10-05.md`), וכל אחת נראתה עובדת בדפדפן אמיתי, חוץ משתיים שנשארו לך ברשימה: הדפסה אמיתית (בדקתי רק שחוקי ההדפסה לא מסתירים כלום) ומשימה "לכל הטלפונים" עם שני טלפונים (מכוסה בבדיקות האוטומטיות).
- פריסת מחשב (#15): לצוות שלוש עמודות, לשחקן מפה ומשימה זו לצד זו (המשימה מימין), מסך סיום רחב. מתחת ל-1024 שום דבר לא השתנה בטלפון.

**מה מצאתי בעצמי בלילה**
1. **תקלה 16, רצינית:** מי שפתח את אפליקציית השחקן בדפדפן שמחובר כצוות הצטרף למשחק בזהות של הצוות (הצוות נהיה קבוצה, עם הרשאות צוות). עכשיו השרת מסרב, ומסך ההצטרפות מציע "החליפו לשחקן".
2. **סכנה לאירוע חי:** בדיקה אוטומטית שרצה ליד playtest חי הרגה לו את שירות התמונות, ומשימות צילום היו נכשלות באמצע משחק. תוקן ונבדק על המחשב עצמו.
3. סימולציית הדפדפן נכשלה שלוש פעמים, ואף פעם לא בגלל האפליקציה (חוסר זיכרון באמולטור ושלושה באגים בכלי הבדיקה). תוקנה, ועוברת עם קבוצה אחת ועם שלוש.
4. במחשב: פס גלילה הצידה מתחת למשימה. תוקן.

**בדיקות על המצב הסופי:** verify ירוק, e2e ירוק (139/139 פונקציות), verify:emulator מלא ירוק (חוקים, סימולציית עומס, סימולציית רמאויות), סימולציית דפדפן ירוקה.

**החלטות שמחכות לך**
- push ודיפלויי, מתי שנוח.
- תקציב הגודל של אפליקציית השחקן הוגדל ב-1KB (בשביל תקלה 16). הפתרון האמיתי: לטעון את המילון האנגלי רק למי שבוחר אנגלית (~17KB פחות לכל שחקן). השארתי לזה משימה מוכנה.

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
- [x] B3 See every 5.10 fix work in a real browser (local stack): staff sign-in with a code only,
  SOS sheet + callback in console/staff, flag only, one-phone contribution, send back + route from
  the team page, skip stage choice, now-screen picker, host sheet print preview, publish reaching the
  phone, score breakdown.
- [x] B4 Think one step further on each fix: places that show a score (public board, TV, report),
  places that show a staff code (host sheet staff page, codes panel), old links and 6-digit codes,
  CLAUDE.md sections that describe the old behaviour.

## C. Serious verification
- [x] C1 `verify:emulator` (rules, 8-team simulate, adversarial simulate).
- [x] C2 Browser-fidelity play end to end (Pixel 7 profile, synthetic GPS): 1 and 3 teams, every mission type, located missions unsealed by arrival, offline banner, Final screen.

## D. Tidy and document
- [x] D1 CLAUDE.md, DEPLOY.md, scripts/README.md, docs/README.md, openspec changes README.
- [x] D2 Archive the finished OpenSpec changes into the living specs.
- [x] D3 Regenerate the deploy checklist PDF (what is left for him + what the next deploy brings).

## E. Desktop layouts
- [x] E1 OpenSpec: player app and staff app on a computer (use the width, no phone squeeze).
- [x] E2 Build and verify at 1440 and 1024, without changing the phone layout.

## Log
(Entries are in order. The clock times on the earlier entries were estimates and have been removed; from E2 on the time is read from the machine clock.)
- 22:55 A1 green (verify + e2e ALL PASS, 139 callables) → commit 8eb4d79. B2: tab renamed "שיתוף וצוות" + a jump index on every section of 3+ panels (test-section-index), browser check pending in B3.
- B1: cause found by rendering his point: open fields at z16 = no text. Fix: detail map ≤ z16, retina tiles, "איפה זה" overview 3 levels out with the detail frame (test-print-map). Seen in a browser.
- B3 in a real browser (local stack, run wM52knEOQyXt2UGHmCwj): staff sign-in with name + code typed "mk6u 5fwb" ✓; answering button ✓; SOS sheet, callback reaches staff app as tel:+972527654321 ✓; now-screen picker auto-opens, star adds the card ✓ (fixed: list closed after the first star); section index + goToPanel ✓ (smooth scroll does not animate in a hidden pane, verified the call); send-back picker above the team page ✓; skip stage without points: stage completed, score 0, no ledger ✓.
- B4 so far: CLAUDE.md scoring section rewritten; speed-bonus line on public board, TV, ceremony; printed staff card says how to sign in without a scanner; SOS service names no longer repeat the number.
- D1: scripts/README (checks:pdf, deploy:test-game), docs/README (deploy checks, issues, overnight), CLAUDE.md scoring. D2 prepared: specs for fair-final-score + deploy-test-game, umbrella change deploy-feedback-2026-10-05 (6 capabilities), all five valid; archive after C1. D3: 2026-10-05 PDF report updated; NEXT-draft.md/.pdf = the next deploy's checklist, ready.
- E1: change desktop-layouts-play-staff (proposal, spec, tasks). E2 code: useWideLayout (one query, 1024px), staffLayout table (phone order unchanged, 3 desktop columns, quick bar phone-only), StaffConsole renders every section through the table, PlayScreen map + mission column side by side on wide, GameScreen/Screen take `wide`, final screen wider. test-staff-layout + test-wide-layout green, typecheck + lint clean. Browser check after C1 frees the emulator ports.
- C1: e2e ALL PASS, Firestore + Storage rules suites passed, doc-cache check ran; the 8-team sim then FAILED live/final ordering parity. Cause: fair-final-score adds the speed bonus only to published/final boards, and the audit compared the UNPUBLISHED live board with the final one (8 finishers ⇒ bonus ⇒ different order). Not drift, the requested behaviour. Audits now compare the published live board with the final one and assert an unpublished board has no bonus (run-audit.mjs, simulate-adversarial.mjs); CLAUDE.md notes it. Rerun: LOAD SIM CONSISTENT, ADVERSARIAL SIM CONSISTENT.
- D2: archived staff-code-from-join-code, sos-callback-and-authorities, fair-final-score, deploy-test-game, deploy-feedback-2026-10-05 into openspec/specs (11 new capability specs).
- 23:15 E2 verified in a browser (local run ptT2BtJSASLl7PWrynN8). Staff: 1440 three columns 359/466/359, 1024 280/364/280, no horizontal scroll, map open; 375 phone order unchanged, map closed. Player: 1440 map 776 + mission 440 side by side, no drawer; 1024 map 520 + mission 440; 375 unchanged (full map + drawer). Fixed while looking: (1) in Hebrew the mission column sat on the LEFT, so it now leads the reading direction (`order-first`, pinned in test-wide-layout); (2) the final screen showed "?" for total time and fastest stage when the organisers ended the run before a team finished, which reads as an error, so now "אין עדיין"/"Not yet"; (3) useWideLayout also listens to `resize` as a fallback (the hidden pane fired neither event, so this was not proved as a real-browser bug, and the comment says so). test-top-overlay-stack accepted only a bare `<GameScreen>`, now accepts props. `npm run verify` EXIT=0.
- 23:20 to 02:44 the session hit its usage limit; resumed at 02:44.
- 02:52 Issue #16 (found while testing, not reported): a player and a marshal in one browser. Worse than the misleading "expired" message it first looked like: Firebase keeps one user per origin and `ensureAuth` keeps whatever is restored, so the player app JOINED AS THE MARSHAL (the staff uid became a team with staff claims). Fixed test-first: `joinRun`, `joinTeamAsDevice` and `startInstantPlay` refuse a staff token (`assertNotStaffIdentity`, reason `staff-identity`, e2e + a declared static check); the join screen maps it before "race finished" and offers "switch to a player", which signs out, starts a fresh player and reruns the refused join; the console words its error from the LIVE identity (the switch signs out first, so the error arrives while nobody is signed in: the first browser pass still said "expired", which is how that was found). All three verified in a real browser. CLAUDE.md gotcha added.
- 03:55 C2 first attempt: the 3-team browser sim reached no final screen. Cause was NOT the product: the dev emulator had crashed ("Storage rules runtime not available") at the first photo upload. Root cause, proved on the real process table: an OFFSET gate's stale-helper sweep (emulator-exec runs it when one of its own ports is still busy) killed the live default stack's Storage rules runtime JVM and functions workers, which carry no `--port`, and also targeted the live backup loop. Beside a live playtest that is photo missions failing mid-event. Fixed test-first in `scripts/lib/staleHelperSweep.mjs` (`foreign-live-stack`, `DEFAULT_STACK_HELPER_PATTERNS`), 156/156; a dry run on the live table now kills only the finished gate's own JVM on 9080. CLAUDE.md updated. Sim rerun on a healthy stack in progress.
- 04:22 C2 done. After the sweep fix the sim still failed twice, both NOT the product: (a) the Functions emulator's worker pool grows and never shrinks (4 → 38 → 55 workers, ~100 MB each); at 52 workers / 171 MB free every new worker failed "Failed to load function" and teams sat on a sealed mission; (b) a harness race read the last card after the Final screen replaced it (server audit: every mission done). Fixed in the harness: probe `localhost` not 127.0.0.1 (it booted and leaked a second play-web every run), kill the spawned tree on Windows, `waitForFunctions` before setup, re-poll a vanished card. Result on a fresh stack: ✅ BROWSER SIM CONSISTENT with 1 team (twice) and 3 teams (67 s). Also checked by hand at 375: a located mission shows only the flag on the map (#9). CLAUDE.md records the worker-pool limit.
- 04:33 B3 finished, the four items not yet seen: #8 public board after a 5-team run shows the breakdown per team ("242 + 1 מהירות", fastest +20, slowest no line), reads right to left correctly; #7 publish reaches the phone: the team document arrives 272 ms after the publish, and the phone's getMyTeamState count went 21 → 23 within 2 s of a publish and stayed flat in a control window after an unpublish (the fallback poll is 60 s); #13 the real host-sheet page carries 7 print rules and only header, toolbar and background are hidden (an actual printer dialog still needs a human); #6 a mission needing 2 participants, played by a ONE-phone team: no counter, no extra button, the answer completed it (50 points, on to mission 2). The two-phone half needs two browsers (issue #16), covered by e2e.
- 04:56 Serious pass on the FINAL state, dev stack stopped so nothing competes for CPU: `npm run verify:emulator` EXIT=0 in 22 min (e2e ALL PASS 139/139, both rules suites, LOAD SIM CONSISTENT, ADVERSARIAL SIM CONSISTENT).
- 05:02 The wide layout WITHOUT a map, never seen in a browser before: the mission is a centred 672 px column, no empty map pane. Both wide columns showed a grey strip at the bottom: a HORIZONTAL scrollbar, because a child with `-mx-1 px-1` stuck out 4 px and a vertically scrolling column makes overflow-x auto (the phone's sheet hid it). Fixed test-first (`px-1` + `overflow-x-hidden` on both, pinned in test-wide-layout), re-measured in the browser: 672/672 and 440/440, no scrollbar. verify EXIT=0.
