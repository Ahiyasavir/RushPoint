# RushPoint — Project Status & Roadmap
> Last updated: 2026-05-29

---

## מצב כולל

| Phase | Status | תיאור |
|-------|--------|--------|
| Phase 1 — MVP | ✅ הושלם | Auth, רישום, dashboard, שיפוט, component kit |
| Phase 2 — Backend & Maps | ✅ הושלם | Firestore sync, routing, scoring, מפות, offline, EN/HE |
| Phase 3 — Gamification | 🔶 חלקי | Gate/matchmaking, basket zones, leaderboard — SOS/Flash/Final Run חסרים |
| UI Overhaul | ✅ הושלם | Dark neon theme, glassmorphism, Inter+Outfit+JetBrains Mono |

---

## ✅ מה יש — הושלם

### Backend — Cloud Functions (18 פונקציות)

| Function | תיאור |
|----------|--------|
| `registerTeam` | תביעת קוד גישה + יצירת פרופיל + seed gameState |
| `requestNextTask` | הקצאת משימה הבאה (routing חכם) |
| `checkOutTask` | שחרור סלוט בתחנה |
| `getRecommendedTasks` | רשימת משימות מדורגות (ללא commit) |
| `listTeams` | כל הקבוצות + ציון + התקדמות |
| `skipTask` | דילוג על משימה (מעניק ממוצע) |
| `triggerLeaderboardFreeze` | הקפאת/שחרור לוח התוצאות |
| `pushFlashMission` | שידור מיסיון מיוחד לכל הקבוצות |
| `listPendingArrivals` | רשימת קבוצות עם check-in ממתין |
| `checkInArrival` | הקפאת שעון הקבוצה במובייל |
| `finalizeJudgeEvaluation` | ציון סל + sigmoid task score, שחרור + קידום |
| `checkInGate` | כניסה לאזור הגייט (slot 4) |
| `getBasketZone` | מציאת אזור סל + חידה |
| `startCraftingTimer` | התחלת טיימר יצירה + sprint window |
| `joinMatchQueue` | הצטרפות לתור matchmaking |
| `resolveMatch` | הכרעת תוצאה בין שתי קבוצות |
| `bypassMatchmaking` | עקיפת matchmaking (מאסטר) |
| `finalizeLeaderboard` | חישוב סופי + דירוג (Phase 3) |

### Mobile App — מסכים

| מסך | נתיב | מצב |
|-----|------|------|
| Auth gate | `index.tsx` | ✅ |
| Access Code | `access-code.tsx` | ✅ |
| Register | `register.tsx` | ✅ |
| Dashboard | `dashboard.tsx` | ✅ (8 slots, gate card, crafting, matchmaking) |
| Map | `map.tsx` | ✅ (מפה סטטית Mapbox) |
| Basket Zone | `basket-zone.tsx` | ✅ (חידה + match delay + crafting countdown) |

### Mobile App — קומפוננטים

`Text · Button · Card · Badge · Input · Toast · LanguageToggle · SlotCard · ProgressBar`  
+ `tokens.ts` (GLOW, GLASS, GRADIENTS, BG)

### Admin Dashboard — דפים

| דף | מצב |
|----|------|
| HeatmapPage | ✅ (Mapbox live map + legend) |
| CheckInsPage | ✅ (רשימת ממתינים live) |
| JudgePage | ✅ (check-in → grading → finalize → result card) |
| TeamsPage | ✅ (live table + skip action) |
| LeaderboardPage | ✅ (freeze/unfreeze + reveal mode + finalize) |
| MatchmakingPage | ✅ (queue + active matches + resolve) |

### Infrastructure

- ✅ Firebase Emulator Suite (פורט 4000) — `npm run dev:all`
- ✅ Seed data — קוד `1234`, "The Lions" demo team, pending check-in
- ✅ Seed מלא — 4 קבוצות, כל המצבים
- ✅ Bilingual EN/HE + RTL
- ✅ Offline persistence + toast
- ✅ Sigmoid scoring + priority routing
- ✅ TypeScript strict — עובר בלי שגיאות

---

## 🔶 Phase 3 — מה עוד חסר

### 1. Final Run Screen ⭐ עדיפות גבוהה

**מה חסר:** כשכל 8 הסלוטים מסתיימים — אין מסך חגיגה.  
`finalizeJudgeEvaluation` מחזיר `allDone: true` כשמשימה אחרונה מסתיימת, אבל ה-dashboard לא מטפל בזה.

**מה לבנות:**
- מסך `app/final-run.tsx` — ✨ ממתין לחנות מוצגות (animation + מוזיקה + מיקום סופי)
- לוגיקה ב-dashboard: כשכל הסלוטים `completed` → `router.replace('/final-run')`
- קובץ `final_run.mp3` ב-`assets/sounds/`

---

### 2. Flash Mission Banner ⭐ עדיפות גבוהה

**מה חסר:** `pushFlashMission` קיים בBackend, אבל Mobile לא מאזין לflash missions.

**מה לבנות:**
- `FlashMissionBanner.tsx` — popup overlay עם countdown ו-neon styling
- hook ב-dashboard שמאזין ל-`artifacts/{appId}/public/data/flashMissions` (onSnapshot)
- Admin: כפתור שליחה ב-MatchmakingPage עם טופס (כותרת + TTL)
- כשflash mission חדש מגיע → banner מופיע + צליל התראה

---

### 3. SOS Emergency Button 🆘

**מה חסר:** אין כפתור SOS במובייל, אין callable בbackend.

**מה לבנות:**
- `app/sos.tsx` — מסך עם כפתור גדול + מאשר דו-שלבי (מניעת לחיצה בשגגה)
- Cloud Function `triggerSOS` — כותב מסמך `adminAlerts/{id}` ב-Firestore
- Admin: התראה live ב-CheckInsPage כשSOS מגיע
- כפתור קטן בpressable ב-dashboard header (🆘 icon)

---

### 4. Clue-Hint Penalty UI 💡

**מה חסר:** `bonusPenalty` קיים ב-gameState ובfunctions, אבל אין UI לבקשת רמז.

**מה לבנות:**
- כפתור "💡 רמז" ב-ActiveTaskCard — 50 נקודות לניכוי
- אישור דו-שלבי לפני בקשה
- Cloud Function `requestClueHint` — מוסיף 50 ל-`bonusPenalty`
- הצגת `bonusPenalty` ב-dashboard (אם > 0)

---

### 5. קבצי קול 🔊

**מה חסר:** תיקיית `assets/sounds/` ריקה (רק README).

**מה נדרש:**
- `unlock_green.mp3` — צליל השלמת משימה ירוקה
- `unlock_orange.mp3` — כניסה לאזור הגן/סל
- `unlock_gold.mp3` — התחלת craft זהב
- `final_run.mp3` — צליל חגיגה גמר (Phase 3)

מקורות חינמיים: Freesound.org / Zapsplat  
ה-hook `useSlotSound.ts` כבר קיים ומוכן לטעון את הקבצים.

---

### 6. Wrapped Cards / Event Summary ⬜ נדחה

כרטיסי סיכום אחרי האירוע (Phase 3 מאוחר — לא דחוף לפרישה).

---

## 🚀 הכנה לפרישה (Production)

אלו הדברים שנדרשים **לפני יום האירוע** — כרגע הכל רץ רק על Emulator:

### Firebase Production
- [ ] יצירת Firebase project בproduction (או וידוא `race-to-tzion-2026` מוגדר)
- [ ] `firebase deploy --only functions` — פרישת כל 18 הפונקציות
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
סשן הבא:
  1. Flash Mission Banner (mobile listener + admin UI)
  2. Final Run screen (+ animation + ניווט מdashboard)

אחריו:
  3. SOS button + callable + admin alert
  4. Clue-hint penalty UI
  5. Sound files (רכישה + הוספה)

הכנה לפרישה (לפני האירוע):
  6. Production Firebase deploy
  7. Admin auth custom claims
  8. תוכן אמיתי (tasks, coordinates, access codes)
  9. EAS mobile build
  10. בדיקות e2e מלאות
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
per-slot = 100·difficulty · sigmoid(actual/target)
sigmoid  = 0.2 + 1.3/(1+e^(3(x−1)))   ← x = actual/target minutes
```
