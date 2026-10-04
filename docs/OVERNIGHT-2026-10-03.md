# Overnight 2026-10-03 → 06:30

Mandate (Ahiya, via the chat): finish Udi's list (template-visibility close-out, stages 0, 1, 2 of
the host-sheet plan through OpenSpec + TDD, gates, browser checks), then a thorough pass over
everything about to ship on `field-report-2026-09-27`: find and fix bugs, make it tidy and
documented, and simplify interfaces wherever possible. Nothing is committed or deployed.

## Done

| What | Result |
|---|---|
| template-visibility | full e2e green (139 callables covered), archived to `openspec/changes/archive/2026-10-03-template-visibility`, spec synced |
| Stage 0 `quick-setup-reachable` | Quick Setup reachable on a phone (⋯ menu), readiness grouped, reveal honest. Browser at 375px: verified |
| Stage 1 `host-sheet` | `/host-sheet/:gameId` (+ `?run=`): cover, map plot, route, cards, answer key, game day, staff tear-off page. A4 and 375px: verified |
| Stage 2 `composer-siting-by-station` | one station per stage. Prep level 2: 13.7 → 3.6 map points per game. Cost line in the questionnaire. Browser: verified |

## Two lines per stage, for Ahiya

**Stage 0 (Quick Setup on a phone).** עובד: בטלפון יש "הקמה מהירה (נותרו N)" בתפריט ⋯, ההזמנה חוזרת בביקור הבא ואחרי רענון, רשימת המוכנות מקבצת ("3 משימות בלי נקודה על המפה"), ומסך "המשחק מוכן" אומר מה נשאר.
לבדוק: לבנות משחק בטלפון שלך ברמת הכנה 3 ולראות שזה מרגיש טבעי.

**Stage 1 (Host sheet).** עובד: דף מארח לכל משחק מתפריט ⋯ בעורך ומחדר הבקרה, עם מפה ממוספרת, כרטיס לכל תחנה, כל התשובות, דף תשובות מרוכז ודף קודי צוות לגזירה (רק בריצה, ונעלם כשמכבים תשובות).
להחליט: מפה משורטטת בלי רחובות, בלי כתובות אוטומטיות, ובלי כניסה מכרטיס המשחק בלוח הבקרה (סעיפים 5 עד 7 בתוכנית).

**Stage 2 (fewer map points).** עובד: ברמת הכנה 2 ירדנו מ 13.7 בקשות סימון למשחק ל 3.6 (נקודה אחת לכל שלב), ובשאלון מופיע "תצטרכו לסמן 3 נקודות, בערך 5 דקות".
להחליט: אילו משימות לא מקבלות נקודה אף פעם ואיזה "סוג מקום" לכל משימה (סעיפים 8 עד 10, הרשימה ליד כל משימה ב taskBank.ts).

## Bugs found by playing (each fixed test first)

1. New-game wizard path cards printed the icon NAMES ("sparkle", "book", "doc") as text. Guard: `scripts/test-icon-name-not-text.ts`.
2. Builder: the "just created" router stamp survived a reload, so refreshing never brought the Quick Setup invitation back. Now consumed after it is read.
3. Host sheet: a photo mission was listed as "answer missing", and tap-to-confirm sequence steps printed empty separators.
4. Host sheet: the floating live-run bar covered the sheet (and would print). Hidden on that route, and the background mesh is hidden in print.
6. Run Console: "1 קבוצות תקועות" and 28 more counts read as plurals at one. Guard: `scripts/test-i18n-count-at-one.ts` (both apps, 506 rendered strings; ~150 strings fixed).
5. Dash gate: the new grouped readiness copy used a maqaf ("ל־2"). Reworded.

## Defaults chosen without an answer (all "ברירת מחדל, ניתן לשינוי")

Recorded in `docs/host-sheet-and-prep-plan-action-plan-2026-10-02.md`, part D, items 5 to 10.

## Thorough pass

Played the demo game end to end as a participant at 375px (join, quiz, numeric with a wrong
answer, sequence, photo, finish) and drove the creator side (wizard, Builder, Run Console).

7. **Counts at one, both apps.** ~150 strings rendered "1 שלבים", "עוד 1 ריצות", "1 teams" and so on.
   Fixed with real singular wording; gate `scripts/test-i18n-count-at-one.ts` renders all 506
   count functions with n=1 in both languages, with a declared exception list (abbreviations,
   ratings, values that are never 1) that fails when stale.
8. **"שלב" meant two things.** A sequence mission's steps were also "שלב", inside a game made of
   stages. They are "צעד" now everywhere (player progress, the submit button, the Builder editor,
   the run report, the type name).
9. **Photo mission had the wrong primary button.** Before any photo the big orange button was
   "send", which could only answer "take a photo first". Now "take a photo" is primary and send
   appears only once there is a photo; then send comes before the retake controls so it stays
   above the fold at 375px. Gate: `scripts/test-photo-entry-one-action.ts`.
10. **False "upload may be slow".** A small photo that re-encoding could not shrink was warned that
    its upload would be slow. Now the warning needs the uploaded bytes to really be large
    (`warnsSlowUpload`, in `scripts/test-image-resize.ts`).
12. **Maps spoke English.** MapLibre's own text (the two-finger hint, zoom buttons, attribution
    toggle, the map's accessible name) was English on every Hebrew screen, in all 7 maps of both
    apps. Every map now gets `locale: mapLocale(t.mapUi)`. Gate: `scripts/test-map-locale.ts`;
    CLAUDE.md records the rule beside the RTL-plugin one.
13. **Map credits ran under our buttons.** In the mission editor the attribution line sat at the
    bottom edge under the map/satellite switch ("pTiler © OpenStreetMap c"). It is a collapsed
    control in the empty top-left corner now. Checked at 375px.
14. **"965 שע׳".** The Run Console inbox showed a long-stuck team's age in hours. Now m:ss under an
    hour, hours under two days, then days (`lib/inboxAge.ts`, `scripts/test-inbox-age.ts`).
15. **Quick Setup card hid its buttons on a phone.** The inline card was capped at 45% of a wrapper that sizes to its own content: 113px of a 242px card. It's capped at 45dvh below lg now (test in `test-quick-setup-flow.ts`).
16. **The stage 2 station line was invisible.** Quick Setup hid it behind "show the template note". A one-line note (≤140 characters) is now shown open; the station line was shortened (test in `test-composer-siting.ts`). The progress label "תחנה 2 מתוך 4" became "2 מתוך 4", so "תחנה" means only a point on the map.

**Resumed 01:56.** `npm run verify` green on 13 to 16; the "2 מתוך 4" label checked in the browser.
17. **Quick Setup congratulated an unfinished game.** Pressing "next" past required steps that were never filled ended on "זהו, סיימתם! המשחק שלכם מוכן להשקה" with confetti, while launch still listed 3 missing points. `finishVerdict` now decides: nothing outstanding ⇒ celebrate; otherwise "עברתם על הכל, נשארו N דברים" and where they wait, no confetti. Checked at 375px.
11. **Line ending churn.** Eight files had flipped LF→CRLF against HEAD (~700 lines of noise in the
    diff). Restored to HEAD's endings, content unchanged.
18. **A finished team offered dead actions in the staff app.** The team that crossed the finish line
    still showed "hold" (does nothing) and "send to a mission" (the server refuses). Now a finished
    team shows score and "send back" plus a "סיימה" badge that says why
    (`lib/staffTeamActions.ts`, `scripts/test-staff-team-actions.ts`). Checked at 375px.

20. **The public leaderboard link opened the staff app.** On a phone that had once signed in as
    staff, `?board=` / `?tv=` / `?recap=` were swallowed by the stored staff session. A public link
    now wins over a stored session, as `?code=` already did. So does a game page link (`?game=`
    alone); a legacy staff link (`owner`+`game`+`run`) and `?staff=` still land in staff. Tests in
    `scripts/test-play-route.ts`; checked in the browser.

21. **Two stock glyphs survived the no-emoji change on the join screen.** The colorblind switch
    was a "◐" character and the "no account needed" line led with "●". The switch now draws a new
    `contrast` icon (added to `iconPaths.ts`, passes `test-icon-paths`), the dot is a drawn circle.

22. **The Quick Setup finish dialog reopened on every visit** (older than tonight; fix 17 made
    it visible). It fired on "any transition into done", and the stored record loads after the first
    render, so every page load was idle → done. Now only `running → done` (the creator actually
    finishing) opens it (`reachedFinishLine`). Checked: a reload with a stored `done` shows nothing.

23. **"100 קבוצות בו זמנית" on a mission nobody limited.** The mission editor's "עוד הגדרות" row
    named capacity 100 as a setting, but 100 is the platform's "no queue here" and every bank mission
    carries it, so most composed missions looked restricted. Capacity at or above
    `UNLIMITED_CAPACITY_THRESHOLD` is no longer listed (`scripts/test-mission-settings-rows.ts`).

24. **Every confirmation in creator-web was invisible to a screen reader.** The shared dialog
    (end the run, delete, start all teams...) was a plain div: no role, no aria-modal, no name, and
    Escape did nothing. It is an `alertdialog` named by its title (or message), described by its
    message, and Escape cancels (OK on an alert). Gate in `scripts/test-creator-a11y-scan.ts`;
    checked in the browser.

25. **The flash mission was unreadable on a player's phone.** Its title, timer, badge and "you won"
    line used dark-theme shades (`text-purple-200`, #e9d5ff) on a near-white card, about 1.2:1;
    play-web reverses only the zinc scale. Now purple-900/800/700 (title 9.4:1, measured in the
    browser). The same class of leftover in creator-web (`text-amber-400` hints in the Builder, the
    share sheet's "not in the gallery" notice, the error page) moved to the `ink-*` tokens. Gate:
    `scripts/test-pale-text.ts` (both apps, one declared on-dark exception).

26. **A flash mission the team was on was said twice.** The live strip ("you are on this mission
    now", title, +50, timer) sat right above the mission card with the same title and points. The
    card now carries the countdown and the strip skips the flash the team is on
    (`scripts/test-flash-said-once.ts`); the dead `youAreOnIt` string is gone. Checked at 375px.
27. **"Needs you now" was silent about a flash waiting for approval.** A mission photo in that state
    got a chip; a flash mission did not, though the console already counted it for its clock. New
    `flashPending` warning ("משימת בזק אחת מחכה לאישור שלכם") that opens the flash panel
    (`runConsole.test.ts`). Played end to end: player takes it, sends, the chip appears, approve,
    the player sees "זכיתם! +50" and the score moves.

28. **"כתבו הודעה למטה"** in the player chat reads as "write a message below" just as easily
    as "to HQ". Now "כתבו הודעה למארגנים".

29. **Run history said "משחקים עכשיו" about August runs.** `live` only means nobody pressed
    "end the run". Within a day of launch it still says playing now; after that "עדיין פתוחה"
    (`lib/runHistoryBadge.ts`, `scripts/test-run-history-badge.ts`).

30. **Eight full-screen windows were not dialogs to a screen reader.** Neither app has a shared
    modal; each window is a hand-built overlay, and the new-game wizard, the reveal, the template
    picker, delete and purge confirmations, the share sheet, the task library, the expanded map
    and the console's feedback view had no role, no aria-modal, no name. Each now declares
    `dialog` (or `alertdialog` for the destructive ones) with its own title. Gate:
    `scripts/test-overlay-dialog-roles.ts` (28 windows across both apps).

31. **Host sheet: the "printed on" line was on the last page only**, though the design promised it
    on every page (a sheet printed before the game changed must be recognisable). Every printed page
    now carries the game, the print date and the page number through an `@page` footer (Chrome; the
    last page keeps its line elsewhere). The title is escaped by `cssString` (tested), since one
    quote in a game name would otherwise end the CSS string.

**Final gates (06:32):** `npm run verify:emulator` (offset 1000) green: e2e ALL PASS, rules,
LOAD SIM CONSISTENT. **Correction (2026-10-04, morning):** the "verify green" claimed here was
from BEFORE fix 31; fix 31's inline `@page` CSS in `HostSheetPage.tsx` failed the dash gate and the
i18n strict gate (both read it as hardcoded English). Fixed by building the rule in the pure module
(`pageFooterCss`, tested); `npm run verify` green again after that.

**Known, not fixed (minor):** at 320px width (first-generation iPhone SE) the Builder's phone header
overflows by 4px, so the ⋯ button's edge is off-screen; from 360px up it fits. The fix touches the
header's shrink rules, not worth the risk overnight.

**Documented:** CLAUDE.md gained three gotchas (MapLibre's own English words; pale dark-theme
shades on the light themes; router state surviving a reload and "transition" checks against a
restored state).

## Simplification proposals (need a yes before building)

These change a deliberate design, so they are written up rather than built.

1. **Staff app team cards: one row, one button.** Today every team card in the staff app carries
   9 buttons inline (‎-10 -5 +5 +10, "סכום אחר", hold, send to mission, skip, send back); six teams
   make 54 buttons on one phone screen, where a marshal mostly needs to FIND a team. Proposal: the
   row shows the star, name, score, badges and "hold" (kept one tap away, as the code comment
   insists), plus one "פעולות" button that opens the rest under that row.
19. **Two "talk to the organizer" sections in the staff app.** The teams' chat reused the players'
    title "צ׳אט עם המטה", so beside "קשר עם המנהל" both read as the organizer. Staff now see
    "צ׳אט עם הקבוצות", the name the creator console already uses for the same chat.

2. **One voice for the creator app.** About 45 Hebrew strings in creator-web are masculine
   singular ("גלה משחקי שדה... העתק כל אחת לחשבונך", "הקלד את שם המשחק כדי לאשר", "הורד עותק
   של כל הנתונים שאנו מחזיקים עליך"), beside newer copy in plural ("לחצו", "סמנו"). Short button
   verbs in the singular are normal Hebrew UI ("שמור", "מחק"); full sentences that address one man
   are not. Proposal: sentences in plural, buttons left as they are. List:
   `grep -nE "'(גלה|העתק|לחץ|בחר|הוסף|צור|שמור|ערוך|מחק|גרור|הזן|הקלד|סמן|פתח|שתף|נסה|התחל|הפעל|שלח|חפש|הורד) " apps/creator-web/src/i18n.ts`.

3. **Past flash missions in the console.** Every ended flash mission keeps its own
   "לתת N נקודות ל: בחרו קבוצה" picker with every team listed, even after a team won, so the panel
   grows with each flash sent. Proposal: ended flashes fold into a "history" line, the award picker
   only on the open one (or on an ended one that has no winner).

4. **The floating "ריצה חיה" bar and forgotten runs.** A run nobody ended stays `live` forever, so
   the floating bar ("ריצה חיה · עוד 5 ריצות · חזרה לריצה · סיום ריצה") sits on every creator screen,
   over content, because of test runs from August. Proposal: the bar shows only runs launched in the
   last day (same rule as fix 29); older open runs stay one tap away in /live and the history, where
   "עדיין פתוחה" now says what they are. Optionally a one-line "you have 5 runs still open, end
   them?" on the dashboard instead of a permanent bar.

## Content notes (data, not code; nothing changed)

- The public demo game "אקדמיית הסוכנים" (`?game=demo-instant-spy`, the landing page's
  "נסה משחק לדוגמה") has one description that runs Hebrew then English in the same paragraph, and
  tags "מכל-מקום" (hyphen) and "spy". Worth a HE-only description and Hebrew tags if production
  carries the same seed.

## Built 2026-10-04 (the four proposals, approved by Ahiya)

Each one through OpenSpec, a failing test first, code, a browser check, `npm run verify` green,
archived.

| Change | Result |
|---|---|
| `active-run-bar-recent` | The floating "ריצה חיה" bar shows only runs launched in the last day, by one predicate (`isPlayingNow`) shared with the history badge. Checked on real local data (7 live runs, only today's qualifies); the visual check of the bar was not possible because the window was hidden. |
| `flash-console-history` | Past flash missions fold into one "N משימות בזק קודמות" line with their winners; open, waiting and just-ended ones stay in full. Played the full cycle. |
| `staff-team-card-actions` | Staff team cards: name, score, hold, and one "פעולות" button for score steps and routing. 7 teams: 31 buttons, down from over 60. |
| `hebrew-one-voice` | 57 Hebrew sentences moved to the plural; gate `scripts/test-hebrew-voice.ts` over 1,455 rendered sentences. |
