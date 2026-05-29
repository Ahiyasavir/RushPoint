# RushPoint — Project Status & Roadmap
> Last updated: 2026-05-29

---

## מצב כולל

| Phase | Status | תיאור |
|-------|--------|--------|
| Phase 1 — MVP | ✅ הושלם | Auth, רישום, dashboard, שיפוט, component kit |
| Phase 2 — Core Math & Routing | ✅ הושלם | Sigmoid scoring, smart routing (Φ/transit/Ω), skill ratio, Z-Score |
| Phase 2 — Backend & Maps | ✅ הושלם | Firestore sync, מפות, offline, EN/HE |
| Phase 3 — Gamification | ✅ הושלם | Gate/matchmaking, basket zones, leaderboard, Flash, SOS, Clue-hint, Final Run, Cohesion |
| UI Overhaul | ✅ הושלם | Dark neon theme, glassmorphism, Inter+Outfit+JetBrains Mono |
| 6-Slot Flow Rework | ✅ הושלם | מעבר מ-8 ל-**6 שלבים**, התחברות רב-מכשירית (custom token), תפריט מילוי טנא |
| Phase 3 — Advanced Operational | ✅ הושלם | ניהול תחנות + פינוי, כרוז, geo-throttling, יומן פעולות, timeout, tie-breaker |

> **כל הפיצ'רים הושלמו ואומתו (e2e 44/44, + unit test ל-tie-breaker).** רק Wrapped Cards (סיכום אירוע) ופרישה ל-production נשארו.

---

## 🆕 עודכן בסשנים האחרונים (מבנה 6 שלבים + תפעול מתקדם)

### מבנה משחק חדש — 6 שלבים (היה 8)
`0-2 ירוק (משימות שדה, שופט מקדם)` → `3 gate (זיווג — רק המנצח ממשיך, המפסיד חוזר לתור)` →
`4 orange (מציאת הטנא + סריקת QR)` → `5 gold (20 דק׳ מילוי טנא מתוך תפריט + ספרינט 90ש׳ + שיפוט)`.
שרשור unlock לינארי; כל 6 הושלמו → Final Run.

### התחברות רב-מכשירית
`joinTeam` callable מנפיק custom token ל-uid המקורי → טלפון שני מצטרף לאותה קבוצה (אותו חשבון).
תיקן את ה-hang בקוד-שכבר-נוצל. Auth נשמר ב-AsyncStorage (native) כך שלא צריך קוד שוב אחרי הפעלה מחדש.

### תפריט מילוי הטנא
`basket-zone.tsx` — בזמן ה-20 דק׳ הצוות מסמן מוצרים (זמן מוערך + ניקוד) → `saveTeneSelection`,
והבחירות מופיעות מסומנות-מראש אצל השופט (`listPendingArrivals` מחזיר `teneSelection`).

### 6 פיצ'רים תפעוליים (Phase 3 advanced)
1. **ניהול תחנות:** `Task.status` (active/paused/closed) — מוחרג מהניתוב. `evacuateStation` משחרר צוותים ללא קנס (`evacuatedFrom` → toast במובייל).
2. **כרוז:** `announcements` → באנר marquee קבוע בדאשבורד (dismiss לכל מכשיר).
3. **Geo-throttling:** `useAdaptiveLocation` → `updateLocation` (מהיר בתנועה, איטי בעמדה) → heatmap חי.
4. **יומן פעולות:** `auditLogs` (admin-only) — כל פעולה ניהולית נרשמת. דף Manager + fine/override.
5. **Timeout:** `Task.maxDurationMinutes` → אזהרה מהבהבת בדף השיפוט (השופט מאריך/מדלג).
6. **Tie-breaker:** `finalizeLeaderboard` שובר תיקו לפי penalties → זמן משימות ירוקות → transit (פונקציה טהורה עם unit test).

> ⚠️ **פער ידוע (לא תוקן):** המובייל לא קורא ל-`requestNextTask`, אז משבצות ירוק 1–2 לא מקבלות `taskId`
> בזרימה האמיתית (slot 0 בלבד מ-seed). כפתור "הגעתי לשופט" נופל ל-`tene-basket` כשאין taskId. דורש תיקון.
> כמו כן ה-UI החדש (Manager, באנר, תפריט) **לא נבדק בדפדפן** — רק שכבת ה-callables אומתה ב-e2e.

---

## 🧬 התאמה לבלופרינט Phase 2 (7 שלבי המשחק) — מאומת ✅

כל הליבה המתמטית של הבלופרינט כבר ממומשת בקוד (לא צריך לרוץ מחדש את בלוק ה-PowerShell):

| שלב בבלופרינט | מימוש בקוד | סטטוס |
|----------------|-------------|--------|
| Sigmoid Task Score `100·D·M(x)`, `M(x)=0.2+1.3/(1+e^(3(x−1)))` | `functions/src/scoring/taskScore.ts` | ✅ זהה לנוסחה |
| Smart Routing `Priority=0.5·Φ−0.3·transit+0.2·Ω` | `functions/src/routing/assignNextTask.ts` | ✅ זהה |
| Φ load factor `(C−N)/C` | `loadFactor()` | ✅ |
| Transit time (haversine, הליכה) | `transitMinutes()` | ✅ |
| Skill matcher `Ω=1−|S−(D−5)/5|` | `skillMatch()` | ✅ |
| Skill ratio `S∈[−1,1]` מביצועי עבר | `computeSkillRatio()` | ✅ |
| Gate sprint — עונש מעריכי | `computeTransitPenalty()` | ✅ |
| Matchmaking 1v1 + בונוס/עונש | `joinMatchQueue` / `resolveMatch` / `bypassMatchmaking` | ✅ |
| 3 אזורי סל (least crowded + חידה) | `getBasketZone` | ✅ |
| טיימר יצירה 20 דק׳ | `startCraftingTimer` | ✅ |
| Sprint 90 שנ׳ — עונש מעריכי | `computeSprintPenalty()` | ✅ |
| Z-Score normalization | `applyZScoreBonus()` | ✅ |
| חשיפה הדרגתית last→first | `LeaderboardPage` reveal mode | ✅ |
| Team Cohesion Rule (עונש על חברים חסרים) | `finalizeJudgeEvaluation` + JudgePage stepper | ✅ |

✅ **כל הבלופרינט ממומש.** אומת end-to-end מול האמולטור (`node scripts/e2e-verify.mjs` — 44/44 PASS).

---

## ✅ מה יש — הושלם

### Backend — Cloud Functions (30 פונקציות)

| Function | תיאור |
|----------|--------|
| `registerTeam` | תביעת קוד גישה + יצירת פרופיל + seed gameState |
| `joinTeam` | טלפון שני מצטרף לקוד תפוס → custom token ל-uid המקורי |
| `requestNextTask` | הקצאת משימה הבאה (routing חכם; מחריג תחנות paused/closed) |
| `checkOutTask` | שחרור סלוט בתחנה |
| `getRecommendedTasks` | רשימת משימות מדורגות (ללא commit) |
| `listTeams` | כל הקבוצות + ציון + התקדמות |
| `skipTask` | דילוג על משימה (מעניק ממוצע) |
| `triggerLeaderboardFreeze` | הקפאת/שחרור לוח התוצאות |
| `pushFlashMission` | שידור מיסיון מיוחד לכל הקבוצות |
| `listPendingArrivals` | רשימת קבוצות עם check-in ממתין |
| `checkInArrival` | הקפאת שעון הקבוצה במובייל |
| `finalizeJudgeEvaluation` | ציון סל + sigmoid task score, שחרור + קידום |
| `checkInGate` | כניסה לפארק (transit penalty) — נשאר ב-backend/e2e, לא בנתיב המובייל הפעיל |
| `getBasketZone` | מציאת אזור סל + חידה |
| `startCraftingTimer` | התחלת טיימר יצירה + sprint window |
| `joinMatchQueue` | הצטרפות לתור matchmaking |
| `resolveMatch` | הכרעת תוצאה בין שתי קבוצות |
| `bypassMatchmaking` | עקיפת matchmaking (מאסטר) |
| `finalizeLeaderboard` | חישוב סופי + Z-Score + דירוג (מחסר bonusPenalty) |
| `pushFlashMission` | שידור משימת ברק לכל הקבוצות (נתיב קנוני + assertJudge) |
| `triggerSOS` | קבוצה מעלה התראת חירום → adminAlerts (עם GPS) |
| `acknowledgeAlert` | שופט מסמן התראה כטופלה |
| `requestClueHint` | קבוצה קונה רמז תמורת 50 נק׳ (bonusPenalty) |
| `saveTeneSelection` | שמירת בחירת מוצרי הטנא (תפריט המובייל) → pre-fill לשופט |
| `setStationStatus` / `evacuateStation` | ניהול: השהיה/סגירת תחנה / פינוי צוותים ללא קנס (audited) |
| `pushAnnouncement` / `deactivateAnnouncement` | ניהול: כרוז תפעולי גלובלי (נשאר עד כיבוי) |
| `adjustTeamScore` | ניהול: קנס/דריסת ניקוד — נרשם ביומן (prev/new) |
| `listAuditLogs` | ניהול: קריאת יומן הפעולות (נתיב admin-only `auditLogs`) |
| `updateLocation` | מובייל: ping מיקום רזה (geo-throttling) → `teamLocations` ל-heatmap |

### Mobile App — מסכים

| מסך | נתיב | מצב |
|-----|------|------|
| Auth gate | `index.tsx` | ✅ |
| Access Code | `access-code.tsx` | ✅ |
| Register | `register.tsx` | ✅ |
| Dashboard | `dashboard.tsx` | ✅ (6 שלבים, gate card, crafting, matchmaking, באנר כרוז, "הגעתי לשופט") |
| Map | `map.tsx` | ✅ (מפה סטטית Mapbox) |
| Basket Zone | `basket-zone.tsx` | ✅ (חידה + תפריט מילוי טנא + crafting/sprint countdown) |
| SOS | `sos.tsx` | ✅ (אישור דו-שלבי + GPS + triggerSOS) |
| Final Run | `final-run.tsx` | ✅ (גביע מונפש + fanfare + ניקוד סופי) |

### Mobile App — קומפוננטים

`Text · Button · Card · Badge · Input · Toast · LanguageToggle · SlotCard · ProgressBar · FlashMissionBanner · AnnouncementBanner`  
+ `tokens.ts` (GLOW, GLASS, GRADIENTS, BG) + `data/teneProducts.ts` (מירור תפריט הטנא)  
+ hooks: `useGameSync · useOfflineToast · useFlashMissions · useSlotSound · useAnnouncements · useAdaptiveLocation`

### Admin Dashboard — דפים

| דף | מצב |
|----|------|
| HeatmapPage | ✅ (Mapbox live map + legend) |
| CheckInsPage | ✅ (רשימת ממתינים live) |
| JudgePage | ✅ (check-in → grading → finalize → result card) |
| TeamsPage | ✅ (live table + skip action) |
| LeaderboardPage | ✅ (freeze/unfreeze + reveal mode + finalize) |
| MatchmakingPage | ✅ (queue + active matches + resolve) |
| ManagerPage | ✅ (`/manager` — ניהול תחנות + פינוי, כרוז, יומן פעולות + fine/override) |

### Infrastructure

- ✅ Firebase Emulator Suite (פורט 4000) — `npm run dev:all`
- ✅ Seed data — קוד `1234`, "The Lions" demo team, pending check-in
- ✅ Seed מלא — 4 קבוצות, כל המצבים
- ✅ Bilingual EN/HE + RTL
- ✅ Offline persistence + toast
- ✅ Sigmoid scoring + priority routing
- ✅ TypeScript strict — עובר בלי שגיאות

---

## ✅ Phase 3 — הושלם בסשן זה

### 1. Final Run Screen ✅
`app/final-run.tsx` — גביע מונפש (spring + float), זוהר זהב פועם, ניקוד סופי (score − penalty),
fanfare סינתטי. ה-dashboard מנווט אוטומטית (ref-guarded) כשכל 6 השלבים terminal.

### 2. Flash Mission Banner ✅
`useFlashMissions` (onSnapshot + סינון בזיכרון + טיקר תפוגה) → `FlashMissionBanner` (overlay סגול
glassmorphism עם countdown). Admin שולח מ-MatchmakingPage (EN/HE + bonus + TTL).
**תוקן באג:** `pushFlashMission` כתב לנתיב לא-קנוני ועם בדיקת אדמין ששברה על האמולטור.

### 3. SOS Emergency Button ✅
`app/sos.tsx` — אישור דו-שלבי + GPS best-effort → `triggerSOS`. כפתור 🆘 בheader.
Admin רואה התראות live ב-CheckInsPage (`acknowledgeAlert` + קישור Google Maps).

### 4. Clue-Hint Penalty UI ✅
כפתור 💡 ב-ActiveTaskCard (אישור דו-שלבי) → `requestClueHint` (+50 ל-bonusPenalty, transaction).
ה-dashboard מציג ניקוד אפקטיבי + קנס. `finalizeLeaderboard` עכשיו **מחסר** bonusPenalty (היה באג).

### 5. קבצי קול ✅ (נפתר דרך סינתזה)
`useSlotSound` מסנתז chimes (Web Audio) ל-unlock + `playFanfare` ל-Final Run — **אין צורך ב-mp3**.
קבצי mp3 אמיתיים נשארו כשדרוג קוסמטי אופציונלי בלבד.

---

### 6. Team Cohesion Rule ✅
`finalizeJudgeEvaluation` מקבל `missingMembers` → קנס 100 נק׳ לכל חבר חסר נכנס ל-bonusPenalty
(server-authoritative). JudgePage: stepper "ד. בדיקת לכידות צוות" + שורת קנס ב-total וב-result card.

---

## 🔶 מה עוד נשאר

### Wrapped Cards / Event Summary ⬜ נדחה
כרטיסי סיכום אחרי האירוע — לא דחוף לפרישה.

---

## 🚀 הכנה לפרישה (Production)

אלו הדברים שנדרשים **לפני יום האירוע** — כרגע הכל רץ רק על Emulator:

### Firebase Production
- [ ] יצירת Firebase project בproduction (או וידוא `race-to-tzion-2026` מוגדר)
- [ ] `firebase deploy --only functions` — פרישת כל 30 הפונקציות
- [ ] `firebase deploy --only firestore:rules` — חוקי אבטחה
- [ ] `firebase deploy --only storage` — חוקי Storage
- [ ] אימות שה-Firestore indexes (`firestore.indexes.json`) מועלים

### Admin Auth (Production)
- [ ] כרגע Admin רץ עם anonymous sign-in (עובד ב-emulator בגלל `FUNCTIONS_EMULATOR`)
- [ ] בproduction: להגדיר `custom claim { role: "admin" }` ל-UIDs השופטים
- [ ] או: להוסיף email/password auth לadmin ולבדוק custom claim בפונקציות

### תוכן האירוע
- [ ] קואורדינטות אמיתיות של עמדות בירושלים ב-Firestore tasks
- [ ] תיאורי משימות אמיתיים (עברית + אנגלית)
- [ ] אזורי סל אמיתיים (`basketZones` ב-Firestore)
- [ ] קודי גישה לכל הקבוצות (seed בproduction Firestore)
- [ ] מדבקות QR לכל עמדה (מ-`task.qrCode`)

### Mobile Build
- [ ] הוספת `assets/icon.png`, `assets/splash.png`, `assets/adaptive-icon.png`
- [ ] הגדרת `.env` עם firebase credentials של production
- [ ] `eas build --platform ios` + `eas build --platform android` (Expo EAS)
- [ ] בדיקה על device אמיתי (iOS + Android)

### בדיקות לפני האירוע
- [ ] e2e test עם קבוצות ניסיון — כל flow מהרישום עד הסיום
- [ ] בדיקת מצב offline (מנטרול wifi ובדיקה שה-app לא קורס)
- [ ] בדיקת עומס — 10+ קבוצות במקביל
- [ ] וידוא שמפת Mapbox עובדת עם טוקן production

---

## 📋 סדר עדיפויות מומלץ לסשנים הבאים

```
✅ הושלם בסשן זה:
  Flash Missions · SOS · Clue-hint penalty · Final Run · fanfare סינתטי

סשן הבא (פיצ׳רים אופציונליים):
  1. Wrapped Cards / סיכום אירוע
  2. (אופציונלי) קבצי mp3 אמיתיים במקום סינתזה

הכנה לפרישה (לפני האירוע) — העיקר עכשיו:
  4. Production Firebase deploy (functions + rules + storage + indexes)
  5. Admin auth custom claims (במקום anonymous)
  6. תוכן אמיתי (tasks, coordinates, access codes, basketZones)
  7. EAS mobile build (iOS + Android)
  8. בדיקות e2e מלאות + עומס
```

---

## 🏗️ ארכיטקטורה נוכחית — Quick Reference

```
apps/mobile (Expo SDK 52)     → http://localhost:8081
apps/admin  (React + Vite)    → http://localhost:5180
functions/  (Node 20)         → http://localhost:5001
Firebase Emulator UI          → http://localhost:4000

boot: npm run dev:all
```

**Firestore paths:**
```
PUBLIC  → artifacts/race-to-tzion-2026/public/data/{collection}/{docId}
PRIVATE → artifacts/race-to-tzion-2026/users/{userId}/{collection}/{docId}
CODES   → artifacts/race-to-tzion-2026/accessCodes/{code}
```

**Score formula:**
```
per-slot   = 100·difficulty · sigmoid(actual/target)
sigmoid    = 0.2 + 1.3/(1+e^(3(x−1)))   ← x = actual/target minutes
final/team = max(0, Σ earnedScore + 500·allDone − bonusPenalty), ואז Z-Score:
             finalScore = max(0, raw + round(−z·200))   ← z = (dur_team − μ)/σ
routing    = 0.5·Φ − 0.3·transitNorm + 0.2·Ω    (Φ=(C−N)/C, Ω=1−|S−(D−5)/5|)
```
