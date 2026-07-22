# Google Play — store listing copy & assets

Everything the Play Console listing form asks for, ready to paste.
Generated artwork lives in [`assets/`](assets/). Regenerate with:

```bash
npm run play:assets
```

```bash
npm run play:screenshots
```

`play:assets` writes **only** the feature graphic. `play:screenshots` drives a real
game through the real UI and writes the phone set — it needs the emulator up
(`npm run emulator`); add `-- --lang=en` for the English set.

> **Scope:** the app published to Play is **`play-web` — the participant app**
> (see [PLAY_STORE.md](../../PLAY_STORE.md)). All copy below is written for a
> **player joining someone else's game**, not for a creator building one.

---

## ⚠️ Read before submitting: the cold-install problem

`apps/play-web/src/App.tsx` routes a visitor with **no query parameters** straight to
`JoinScreen`, which demands an access code. The public entry points (`?game=`,
`?challenge=`, `?board=`) are all **URL-driven** — a person who installs from the Play
Store arrives with a bare launch, so they land on the code prompt with **nothing to do**.

Two real consequences:

1. **Play review risk.** Reviewers routinely reject apps under the *"minimum
   functionality"* policy when a fresh install shows only a gate they can't get past.
   At minimum, give the reviewer a working code in **Play Console → App content →
   App access** (there's a field for login/access instructions — fill it in with a live
   access code and keep that run alive during review).
2. **Rating risk.** Organic installers who aren't attending an event can't try anything,
   and "I can't use it" one-star reviews are hard to undo.

**The copy below is written defensively** — the short description and the opening line of
the full description both state up-front that a code from an organizer is required, so
expectations are set before install rather than after.

> **Worth considering before launch** (product change, not copy): a demo/sample game
> reachable from the join screen with no code. The building blocks already exist
> (`ChallengeTeaser`, `GamePromoScreen`). That would turn a dead-end cold install into a
> playable first impression. Not a blocker — but it's the single highest-leverage change
> for store conversion.

---

## App name (max 30 chars)

| Lang | Value | Len |
|---|---|---|
| **HE** | `RushPoint משחק שדה` | 19 |
| **EN** | `RushPoint Field Game` | 21 |

## Short description (max 80 chars)

**HE** (67)
```
הצטרפו למשחק שדה חי עם קוד מהמארגן. משימות, ניווט GPS וניקוד אוטומטי.
```

**EN** (77)
```
Join a live real world team game with an organizer's code. Tasks, GPS, scores.
```

---

## Full description (max 4000 chars)

### Hebrew

```
RushPoint הופך אירוע אמיתי למשחק שדה קבוצתי. טיול שכבה, בר מצווה או בת מצווה, גיבוש צוות, או יום כיף משפחתי.

⚠️ חשוב לדעת: זו אפליקציית המשתתפים. כדי לשחק צריך קוד גישה מהמארגן של האירוע. אין קוד עדיין? האפליקציה תמתין עד שיהיה לכם.

איך זה עובד
① המארגן שולח לכם קוד גישה
② מזינים אותו. בלי הרשמה, בלי סיסמה, בלי חשבון
③ האפליקציה מנווטת אתכם למשימה הראשונה, ומשם זה מתגלגל

מה מחכה לכם בדרך
• ניווט GPS חי. האפליקציה בוחרת לכם את המשימה הבאה לפי המיקום והקצב שלכם
• משימות מכל סוג. צ׳ק אין בנקודה, חידונים, משימות צילום, קודים סודיים בעמדות, שאלות מספריות, רצפים ומשימות שמע
• ניקוד אוטומטי. בלי שופטים, בלי ויכוחים. המהירות והדיוק שלכם נספרים לבד
• טבלת מובילים. כשהמארגן פותח אותה, רואים מיד איפה אתם עומדים מול שאר הקבוצות
• רמזים. נתקעתם? אפשר לחשוף רמז במחיר נקודות
• עדכונים מהמארגן. הודעות ומשימות בזק שנוחתות אצלכם באמצע המשחק
• קבוצה על כמה טלפונים. כל חברי הקבוצה רואים את אותה ההתקדמות בזמן אמת
• כפתור מצוקה. קריאה ישירה לצוות המארגן בלחיצה אחת
• עובד גם כשהרשת חלשה. האפליקציה בנויה לשטח, לא למעבדה
• עברית ואנגלית מלאות

בסוף המשחק
טבלת דירוג סופית, סיכום ההישגים של הקבוצה, ותמונה לשיתוף שאפשר לשלוח מיד לקבוצת הוואטסאפ.

פרטיות
ההצטרפות אנונימית. לא צריך חשבון ולא צריך למסור פרטים אישיים. מיקום GPS נאסף רק בזמן משחק פעיל, ורק כדי לנווט אתכם ולאמת משימות. תמונות שאתם מעלים נראות רק למארגן ולצוות שלו, ולא לאף אחד אחר.

רוצים להריץ אירוע משלכם?
את המשחקים בונים בחינם בקונסולת היוצרים באתר RushPoint. לא צריך את האפליקציה הזו בשביל זה.
```

### English

```
RushPoint turns a real event into a team field game: a school trip, a bar/bat mitzvah, a team offsite, or a family day out.

⚠️ Please note: this is the participant app. You need an access code from your event's organizer to play. No code yet? The app will wait until you have one.

How it works
① Your organizer sends you an access code
② Enter it: no signup, no password, no account
③ The app routes you to your first task, and off you go

What's waiting on the route
• Live GPS routing: the app picks your next task based on where you are and how fast you're moving
• Every kind of task: check in at a location, quizzes, photo missions, secret station codes, numeric answers, step sequences, and audio tasks
• Automatic scoring: no judges, no arguments. Your speed and accuracy are counted for you
• Leaderboard: when your organizer opens it up, see exactly where you stand against the other teams
• Hints: stuck? Reveal a hint for a points cost
• Organizer updates: announcements and surprise flash missions land mid game
• One team, several phones: everyone on the team follows the same progress
• SOS button: reach the organizing staff directly, instantly
• Built for the field: keeps working when the signal doesn't
• Full Hebrew and English

When the game ends
Final standings, a summary of your team's run, and a shareable image for the group chat.

Privacy
Joining is anonymous: no account, no personal details required. GPS location is collected only during an active game, and only to route you and verify tasks. Photos you upload are visible only to the organizer and their staff.

Want to run your own event?
Games are built for free in the Creator console on the RushPoint website: you don't need this app for that.
```

---

## Graphics

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512 PNG, 32-bit | ✅ `apps/play-web/public/icon-512.png` |
| Feature graphic — Hebrew | **1024×500** PNG/JPEG, no alpha | ✅ [`assets/feature-graphic.png`](assets/feature-graphic.png) |
| Feature graphic — English | same | ✅ [`assets/feature-graphic-en.png`](assets/feature-graphic-en.png) |
| Phone screenshots — Hebrew | min 2, max 8; 320–3840 px per side; **max 2:1 aspect** | ✅ 6 × 1080×2160 in [`assets/screenshots/he/`](assets/screenshots/he/) |
| Phone screenshots — English | same | ✅ 6 × 1080×2160 in [`assets/screenshots/en/`](assets/screenshots/en/) |
| 7" / 10" tablet shots | optional | ⬜ skip unless targeting tablets |

Regenerate with `npm run play:assets` (Hebrew) or `node scripts/gen-play-assets.mjs --lang=en` (English).

### The captured set

Both language sets are real frames from a real playthrough of a Hebrew/English game
("מרדף בעיר העתיקה" / "Old City Chase"), ordered to tell a story:

| # | File | Shows |
|---|---|---|
| 01 | `01-join.png` | Team join — team name + member list (sets the "you need a code" expectation) |
| 02 | `02-navigate.png` | Live map, next task, distance badge, SOS |
| 03 | `03-announcement.png` | An organizer flash mission landing mid-game |
| 04 | `04-quiz.png` | A quiz task with the map above it |
| 05 | `05-photo.png` | A photo mission |
| 06 | `06-final.png` | Finish — trophy, final score, run stats, share button |

> ⚠️ **Aspect ratio is the trap here.** Play rejects phone screenshots wider than
> **2:1**. A native Pixel 7 capture is 1082×2202 = 2.035:1 and **fails**. The generator
> pins a 432×864 @2.5 viewport → exactly 1080×2160. If you re-shoot by hand, check the
> ratio before uploading.

> **Localized listings:** Play accepts a separate screenshot set per language — upload
> `he/` on the Hebrew listing and `en/` on the English one.

---

## Other Play Console fields

| Field | Value |
|---|---|
| Category | **Apps → Events** (or Games → Casual — Events fits the real use better) |
| Contains ads | **No** |
| In-app purchases | **No** — free mode, `PAYMENTS_ENABLED = false` |
| Price | Free |
| Privacy Policy URL | ✅ **`https://rushpoint-creator.web.app/privacy`** — deployed & browser-verified 2026-07-22 |
| App access | ⚠️ **Provide a live access code** — see the cold-install warning above |
| Data Safety | answers pre-derived in [PLAY_STORE.md §6](../../PLAY_STORE.md) |
| Target audience | ⚠️ decide deliberately — [PLAY_STORE.md §7](../../PLAY_STORE.md) |
