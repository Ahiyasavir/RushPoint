# מגרש הבדיקות — QA Playground

A single game that contains **every task type and every meaningful option**, built for
manual QA from a phone. Definition: [scripts/lib/qa-game-def.mjs](../scripts/lib/qa-game-def.mjs).

| | |
|---|---|
| **Join code** | `TESTALL` |
| **Map pin (every located task)** | `31.809413, 35.192348` |
| **Station code (smart station / QR)** | `MAGIC77` — QR payload `RP1:MAGIC77` |
| **Final answer** | `2026` |
| **Creator login** | `qa@rushpoint.dev` / `test1234` |
| Stages / tasks | 6 / 26 |
| Scoring | `smart_weighted`, power-ups ON, photo feed ON |

Re-seed on demand: `node scripts/qa-game.mjs --seed`
Self-play the whole thing via the API: `node scripts/qa-game.mjs --simulate`
It is also re-seeded automatically on every emulator boot (`scripts/seed-local.mjs`).

## Answer key

| Stage | Task | Type / option under test | What to do |
|---|---|---|---|
| 1 | צ׳ק-אין בנקודה | `field`, radius 150 m, **image media** | be at the pin → "בוצע" |
| 1 | משימה מיידית | `field`, `triggerMode: instant` | completes with no GPS check |
| 1 | דיווח עצמי | `self_report`, locationless | tap done from anywhere |
| 2 | חידון בחירה | `quiz` + `choices` | **כחול** |
| 2 | חידון חופשי | `quiz` typed + **paid hint** (25 pts) + auto-escalation (2 min / 2 wrong) | **ירושלים** |
| 2 | סדרו לפי הסדר | `quiz` + `orderItems` (drag to sort) | ראשון · שני · שלישי · רביעי |
| 2 | מספר ±2 | `numeric`, tolerance 2 | **11** (9–13 accepted) |
| 2 | מספר בנקודה | `numeric` + `requirePresence` | **10**, must be at the pin |
| 2 | סקר בחירה | `survey` + `surveyChoices` | any option, 0 pts |
| 2 | סקר טקסט | `survey` free text | any text |
| 3 | תמונה אוטומטית | `photo`, `autoApprove: true` | instant points + photo feed |
| 3 | תמונה לאישור | `photo`, staff review queue | approve from Run Console / `?staff` |
| 3 | הקלטת קול | `photo` + `captureKind: 'audio'` | voice recorder widget |
| 3 | תחנה חכמה | `smart_station`, code + QR, attempt limit 5 | **MAGIC77** |
| 3 | וידאו | `self_report` + **YouTube media** | watch → done |
| 4 | רצף | `sequence`, 3 steps (2 answered, 1 tap) | **21** → tap → **מגרש** |
| 4 | גיאופנס | `geofence`, 120 m auto check-in | just stand at the pin |
| 4 | מיקום נסתר | `hideLocation` + `locationClue` (no pin) | stand at the pin, 200 m radius |
| 4 | משימה נעולה | `unlockAfterTaskIds: ['qa-sequence']` | unlocks after the sequence |
| 4 | משימה מתוזמנת | `releaseAfterMinutes: 1` + `expiresAfterMinutes: 240` | countdown then unlock |
| 4 | אפשרות א׳ / ב׳ | `exclusiveGroups` — pick ONE | the other locks |
| 5 | 3 משימות | stage `requiredTaskCount: 2` | any 2 of 3 closes the stage |
| 6 | קוד סיום | `numeric`, `isFinal` | **2026** → Final screen |

Also exercised: game **narrative chapters** (stage intro/outro cards), the **"how to play"
primer**, a **safe zone** (5 km around the pin), **instant play** from the gallery, and all
five registration field types (text / number / select / phone / checkbox, team + member level).
