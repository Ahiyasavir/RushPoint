# -*- coding: utf-8 -*-
"""The footage library: every reusable clip that is NOT Ahiya talking to the camera, cut to its main
moment, on a shelf by what is in it, with a catalogue (README.md) and a contact sheet per shelf.

    python docs/marketing/footage/library/build-library.py

To add a clip: one line in SRC (a short key → the original file) if the source is new, and one row
in CLIPS: (shelf, file name, source key, start second, end second, what you see, what it is good
for, note). start/end None = the whole file. Run it: only changed clips are re encoded, the README
and the sheets are rebuilt. Originals are never moved, renamed or edited.

Who decides what goes in: the reel-studio skill, after every ingest of new footage (SKILL.md step 3).
"""
import json, shutil, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HOME = Path.home()
OUT = Path(__file__).resolve().parent
SRC = {   # short key → the ORIGINAL file, relative to the user folder. Add a line here for new footage.
    "ahiya-actions/canyon-rock-arch": "Downloads/Mobile Devices/VID-20260929-WA0116.mp4",
    "ahiya-actions/desk-head-on-hand": "Downloads/Mobile Devices/YouCut_20260928_230709622.mp4",
    "ahiya-actions/desk-thinking-a": "Downloads/Mobile Devices/20260928_230308.mp4",
    "ahiya-actions/desk-thinking-b": "Downloads/Mobile Devices/20260928_230506.mp4",
    "ahiya-actions/desk-thinking-c": "Downloads/Mobile Devices/20260928_231154.mp4",
    "ahiya-actions/desk-thinking-wide": "Projects/Rushpoint/downloads/סרטון הספק מ4 בבוקר/חומרים/סשן עבודה שלי בבוקר.mp4",
    "ahiya-actions/front-door-a": "Downloads/Mobile Devices/סרטונים 1.10.26/20261001_150836.mp4",
    "ahiya-actions/front-door-b": "Downloads/Mobile Devices/סרטונים 1.10.26/20261001_150904.mp4",
    "ahiya-actions/getting-out-of-bed-dark": "Projects/Rushpoint/downloads/סרטון הספק מ4 בבוקר/חומרים/אני קם מהמיטה (2).mp4",
    "ahiya-actions/hike-trail-and-selfie": "Downloads/Mobile Devices/20260924_162854.mp4",
    "ahiya-actions/hike-walking-away": "Downloads/Mobile Devices/20260924_170827.mp4",
    "ahiya-actions/hills-view": "Downloads/Mobile Devices/20260923_175240.mp4",
    "ahiya-actions/kitchen-fridge": "Downloads/Mobile Devices/20261001_153122.mp4",
    "ahiya-actions/night-trail-flashlight": "Downloads/Mobile Devices/20260923_201655.mp4",
    "ahiya-actions/phone-in-bed-dark": "Downloads/Mobile Devices/20260928_211804.mp4",
    "ahiya-actions/phone-in-hand": "Downloads/Mobile Devices/20261013_210613.mp4",
    "ahiya-actions/phone-out-a": "Downloads/Mobile Devices/20261013_205807.mp4",
    "ahiya-actions/phone-out-b": "Downloads/Mobile Devices/20261013_205823.mp4",
    "ahiya-actions/pullups-park": "Desktop/RushPoint-reels-work/reel3-ai/clips/3D_pullups.mp4",
    "ahiya-actions/rappelling-cliff": "Downloads/Mobile Devices/VID-20260929-WA0102.mp4",
    "ahiya-actions/robotics-robot-field": "Downloads/Mobile Devices/VID-20260224-WA0065.mp4",
    "ahiya-actions/stairs-flowers-down": "Desktop/RushPoint-reels-work/reel2-stairs/clips/2A_hops.mp4",
    "ahiya-actions/stairs-flowers-up": "Desktop/RushPoint-reels-work/reel3-ai/clips/3B_stairs.mp4",
    "ahiya-actions/stairs-railing-down-a": "Desktop/RushPoint-reels-work/reel2-stairs/clips/2A_take2.mp4",
    "ahiya-actions/stairs-railing-down-b": "Desktop/RushPoint-reels-work/reel3-ai/clips/street_hops.mp4",
    "ahiya-actions/typing-laptop-hands": "Desktop/RushPoint-reels-work/race-classroom/clips/desk.mp4",
    "ahiya-actions/typing-laptop-terminal": "Downloads/Mobile Devices/20260928_211529.mp4",
    "ahiya-actions/walk-forest-a": "Videos/סרטון לנוער ישראל/עבודה/20260903_165609.mp4",
    "ahiya-actions/walk-forest-b": "Videos/סרטון לנוער ישראל/עבודה/20260903_165721.mp4",
    "ahiya-actions/walk-to-camera-garden-a": "Downloads/Mobile Devices/סרטונים 1.10.26/20261001_152851.mp4",
    "ahiya-actions/walk-to-camera-garden-b": "Downloads/Mobile Devices/סרטונים 1.10.26/20261001_152921.mp4",
    "ahiya-actions/walking-parking-lot": "Desktop/RushPoint-reels-work/reel3-ai/clips/3G_walk.mp4",
    "ai-generated/kids-running-trail": "Videos/סרטון לנוער ישראל/עבודה/רקע/v2_awv-cf835e6160fa41a0.mp4",
    "app-screens/bug-table": "Projects/Rushpoint/docs/marketing/footage/devlog-hachvav-retro/shot1-bug-table.mp4",
    "app-screens/creator-console-three-screens": "Desktop/RushPoint-reels-work/reel15-bet/clips/builder.mp4",
    "app-screens/creator-route-map": "Pictures/WhatsApp Video 2026-10-07 at 09.42.11.mp4",
    "app-screens/phone-dark-navigate-a": "Desktop/RushPoint-reels-work/reel14-phone/clips/scr_nav.mp4",
    "app-screens/phone-white-arrive": "Desktop/RushPoint-reels-work/race-opening/clips/scr_arrive.mp4",
    "app-screens/phone-white-join": "Desktop/RushPoint-reels-work/race-opening/clips/scr_join.mp4",
    "app-screens/phone-white-navigate": "Desktop/RushPoint-reels-work/race-opening/clips/scr_nav.mp4",
    "app-screens/phone-white-score": "Desktop/RushPoint-reels-work/race-opening/clips/scr_score.mp4",
    "app-screens/phone-white-sealed": "Desktop/RushPoint-reels-work/race-opening/clips/scr_sealed.mp4",
    "app-screens/phone-white-sos": "Desktop/RushPoint-reels-work/race-opening/clips/scr_sos.mp4",
    "app-screens/play-app-devices-and-sos": "Desktop/RushPoint-reels-work/race-opening/clips/raw_a.mp4",
    "app-screens/play-app-full-run-phone-1": "Desktop/RushPoint-reels-work/race-classroom/clips/raw_a.mp4",
    "app-screens/play-app-full-run-phone-2": "Desktop/RushPoint-reels-work/race-classroom/clips/raw_b.mp4",
    "app-screens/play-app-photo-missions": "Videos/סרטון לנוער ישראל/עבודה/רקע/Screen_Recording_20260814_181029_Chrome.mp4",
    "app-screens/play-app-second-phone-joins": "Desktop/RushPoint-reels-work/race-opening/clips/raw_b.mp4",
    "app-screens/terminal-green-tests": "Projects/Rushpoint/downloads/סרטון הספק מ4 בבוקר/חומרים/שוט2_טרמינל-בדיקות-ירוק.mp4",
    "brand/rushpoint-outro-white": "Desktop/RushPoint-reels-work/race-opening/clips/outro.mp4",
    "maps/map-jerusalem-zoom": "Desktop/RushPoint-reels-work/race-classroom/clips/map_city.mp4",
    "maps/map-route-motza-to-park": "Desktop/RushPoint-reels-work/race-classroom/clips/map_route.mp4",
    "maps/map-route-vertical": "Desktop/RushPoint-reels-work/race-opening/clips/map_v.mp4",
    "maps/map-route-vertical-short": "Desktop/RushPoint-reels-work/reel15-bet/clips/map_v.mp4",
    "people/booth-girls-posing": "Downloads/Mobile Devices/20260917_222521.mp4",
    "people/booth-1015-handshake": "Downloads/Mobile Devices/20261015_213954.mp4",
    "people/booth-1015-market": "Downloads/Mobile Devices/20261015_214519.mp4",
    "people/booth-1015-banner": "Downloads/Mobile Devices/20261015_221738.mp4",
    "people/street-1016-approach": "Downloads/Mobile Devices/VID-20261016-WA0009.mp4",
    "people/street-1016-group-tram": "Downloads/Mobile Devices/VID-20261016-WA0016.mp4",
    "people/booth-guys-approach": "Downloads/Mobile Devices/20260917_211926.mp4",
    "people/booth-side-full": "Downloads/Mobile Devices/20260917_212016.mp4",
    "people/booth-table-crowd-full": "Downloads/Mobile Devices/20260917_210601_1.mp4",
    "people/group-arcade-blurred": "Videos/סרטון לנוער ישראל/עבודה/רקע/VID-20260902-WA0046_blurred.mp4",
    "people/group-table-blurred": "Videos/סרטון לנוער ישראל/עבודה/רקע/VID-20260902-WA0049_blurred.mp4",
    "people/hachvav-player-a": "Projects/Rushpoint/downloads/פעולת-פתיחה-חבב-1/02_נחשון ודניאל_פרסומת לכפכף.webm",
    "people/hachvav-player-c": "Projects/Rushpoint/downloads/פעולת-פתיחה-חבב-1/05_ייעד_שידור חי מגילה!.webm",
    "people/hachvav-player-d": "Projects/Rushpoint/downloads/פעולת-פתיחה-חבב-1/07_נחשון ודניאל_שידור חי מגילה!.webm",
    "people/hachvav-player-e": "Projects/Rushpoint/downloads/פעולת-פתיחה-חבב-1/10_ייעד_פרסומת לכפכף.webm",
    "people/hachvav-player-singing": "Projects/Rushpoint/downloads/פעולת-פתיחה-חבב-1/13_עהאנש_שידור חי מגילה!.mp4",
    "people/kid-running-night": "Projects/Rushpoint/downloads/סרטון הספק מ4 בבוקר/_work/shots/01_run.mp4",
    "people/selfie-with-friend": "Documents/WhatsApp Video 2026-09-22 at 10.16.10.mp4",
    "stock/au-flag": "Desktop/RushPoint-reels-work/reel14-phone/stock/au_flag.mp4",
    "stock/city-night": "Desktop/RushPoint-reels-work/reel14-phone/stock/city_night.mp4",
    "stock/classroom": "Desktop/RushPoint-reels-work/reel14-phone/stock/classroom.mp4",
    "stock/friends-run": "Desktop/RushPoint-reels-work/reel14-phone/stock/friends_run.mp4",
    "stock/kangaroo": "Desktop/RushPoint-reels-work/reel14-phone/stock/kangaroo.mp4",
    "stock/scroll-bed": "Desktop/RushPoint-reels-work/reel14-phone/stock/scroll_bed.mp4",
    "stock/texting-night": "Desktop/RushPoint-reels-work/reel14-phone/stock/texting_night.mp4",
    "stock/uk-bigben": "Desktop/RushPoint-reels-work/reel14-phone/stock/uk_bigben.mp4",
}
A, P, APP, MAPS, ST, AI, BR = "ahiya-actions", "people", "app-screens", "maps", "stock", "ai-generated", "brand"
MINOR = "קטינים, סרטון ששחקנים שלחו במשחק: לא לפרסם בלי אישור"
CLIPS = [
    # ── אחיה בפעולה ─────────────────────────────────────────────────────────
    (A, "typing-laptop-hands", "ahiya-actions/typing-laptop-hands", None, None, "ידיים מקלידות על לפטופ, מקרוב ומלמעלה. על המסך רשת של אייקונים", "\"בניתי\", \"עבדתי על זה\", כל שורה על עבודה מול מחשב", "בלי קול"),
    (A, "typing-laptop-terminal", "ahiya-actions/typing-laptop-terminal", 15.5, 22.0, "אותה זווית, על המסך טרמינל כהה עם שורות קוד רצות", "קוד, באגים, לילות של עבודה", ""),
    (A, "phone-in-bed-dark", "ahiya-actions/phone-in-bed-dark", 1.0, 8.0, "שוכב במיטה בחדר חשוך, הפנים מוארות מהטלפון, גולל", "\"במקום עוד ערב בטלפון\", בזבוז זמן, לפני השינוי", "בלי חולצה, לשקול לפני שימוש"),
    (A, "getting-into-bed-dark", "ahiya-actions/getting-out-of-bed-dark", 2.8, 6.4, "חדר חשוך, נכנס למיטה ונשכב", "סוף יום, עייפות", ""),
    (A, "getting-out-of-bed-dark", "ahiya-actions/getting-out-of-bed-dark", 9.8, 14.0, "חדר חשוך, מתיישב במיטה וקם ממנה", "\"קמתי בארבע בבוקר\", התחלה של יום", ""),
    (A, "desk-thinking-chin", "ahiya-actions/desk-thinking-a", 14.5, 22.5, "יושב מול מסך המחשב, אגרוף על הסנטר, מהורהר. גופייה לבנה, מהצד", "התלבטות, פתרון בעיה, \"חשבתי על זה הרבה\"", "גופייה"),
    (A, "desk-tired-head-on-hand", "ahiya-actions/desk-thinking-b", 17.5, 24.0, "אותו שולחן, הראש נשען על היד, עייף, מסתכל למסך", "תסכול, שעות של עבודה, \"זה לא עבד\"", "גופייה"),
    (A, "hand-covers-lens", "ahiya-actions/desk-thinking-b", 23.8, 26.2, "שולח יד ומכסה את העדשה עד שהפריים נהיה אדום כהה", "מעבר בין שני חלקים של סרטון", ""),
    (A, "hand-uncovers-lens", "ahiya-actions/desk-thinking-c", 3.0, 5.8, "העדשה מכוסה, היד יורדת והוא מתגלה מול המצלמה", "פתיחה של סרטון או מעבר", ""),
    (A, "desk-thinking-wide", "ahiya-actions/desk-thinking-wide", 4.0, 12.0, "שוט יציב מהצד: יושב ליד קיר לבן, יד על הפה, חושב. כמעט בלי תנועה", "רקע לכתובית ארוכה או לקריינות", "גופייה"),
    (A, "desk-thinking-close", "ahiya-actions/desk-head-on-hand", 0.5, 5.5, "מקרוב: מסתכל למסך, יד על הסנטר", "רגע של ריכוז", "גופייה"),
    (A, "kitchen-opens-fridge", "ahiya-actions/kitchen-fridge", 2.5, 10.5, "נכנס למטבח, פותח את דלת המקרר ומסתכל פנימה. שוט רחב וקבוע", "שגרה בבית, הפסקה, \"רגע של משעמם\"", ""),
    (A, "stairs-flowers-up", "ahiya-actions/stairs-flowers-down", 1.0, 7.5, "עולה במדרגות אבן עם פרחים אדומים, מהגב", "התקדמות, \"שלב אחרי שלב\"", ""),
    (A, "stairs-flowers-down", "ahiya-actions/stairs-flowers-down", 11.0, 22.5, "יורד באותן מדרגות עד שהוא ממלא את הפריים ועובר ליד המצלמה", "כניסה של אחיה לסרטון, ספירה של צעדים", ""),
    (A, "stairs-flowers-up-run", "ahiya-actions/stairs-flowers-up", 1.8, 7.0, "עולה באותן מדרגות בריצה קלה", "אנרגיה, יציאה לדרך", ""),
    (A, "stairs-railing-up", "ahiya-actions/stairs-railing-down-a", 0.8, 7.5, "עולה במדרגות רחבות עם מעקה בין עצים, מהגב, מתרחק", "יציאה לדרך", ""),
    (A, "stairs-railing-down-a", "ahiya-actions/stairs-railing-down-a", 17.5, 29.0, "יורד במדרגות הרחבות לכיוון המצלמה, מדרגה אחרי מדרגה", "כל מדרגה = פריט ברשימה (ככה נבנה ריל 11)", ""),
    (A, "stairs-railing-down-b", "ahiya-actions/stairs-railing-down-b", 19.0, 30.5, "אותה ירידה, טייק נוסף, בסוף עובר קרוב למצלמה", "גיבוי לקטע הקודם", ""),
    (A, "pullups-bar", "ahiya-actions/pullups-park", 4.0, 12.0, "עושה מתח על מתקן כחול בפארק, מהגב, שוט רחב", "כושר, משמעת, \"מה אני עושה חוץ מהאפליקציה\"", ""),
    (A, "pullups-then-walk-to-camera", "ahiya-actions/pullups-park", 21.0, 26.2, "יורד מהמתקן והולך אל המצלמה", "מעבר מפעולה לדיבור", ""),
    (A, "parking-walk-away", "ahiya-actions/walking-parking-lot", 1.5, 7.5, "הולך בחניה ומתרחק מהמצלמה", "יציאה, \"הלכתי לבדוק\"", ""),
    (A, "parking-walk-toward-phone", "ahiya-actions/walking-parking-lot", 15.0, 24.8, "חוזר לכיוון המצלמה עם טלפון ביד, מסתכל בו", "ניווט עם האפליקציה, הגעה לנקודה", ""),
    (A, "looks-at-phone-then-up-a", "ahiya-actions/phone-out-a", 2.0, 9.0, "מסתכל בטלפון, ואז מרים מבט למצלמה. חולצה אפורה, קיר לבן", "פתיחה (\"הטלפון הזה\"), קבלת הודעה", ""),
    (A, "looks-at-phone-then-up-b", "ahiya-actions/phone-out-b", 1.5, 8.5, "אותו מהלך, טייק נוסף", "גיבוי", ""),
    (A, "shows-phone", "ahiya-actions/phone-in-hand", 1.8, 6.0, "מחזיק טלפון ומצביע עליו, מול המצלמה", "\"הכל פה\", הצגה של האפליקציה", "הוא מדבר בקטע, להשתמש בלי קול"),
    (A, "front-door-knock-and-enter", "ahiya-actions/front-door-a", 2.5, 12.5, "ניגש לדלת כחולה בקשת אבן, דופק ונכנס. מהגב, שוט קבוע", "\"הלכתי מדלת לדלת\", חזרה הביתה, משימה אצל שכן", ""),
    (A, "front-door-comes-out", "ahiya-actions/front-door-a", 17.0, 21.0, "הדלת נפתחת והוא יוצא לכיוון המצלמה", "יציאה מהבית, התחלה של יום", ""),
    (A, "front-door-enter-short", "ahiya-actions/front-door-b", 1.2, 6.5, "ניגש לדלת ונכנס, גרסה קצרה", "גיבוי", ""),
    (A, "walk-up-to-camera-a", "ahiya-actions/walk-to-camera-garden-a", 0.6, 3.4, "מגיע בהליכה בשביל בגינה עד קרוב מאוד לעדשה", "כניסה לפריים לפני משפט פתיחה", ""),
    (A, "walk-up-to-camera-b", "ahiya-actions/walk-to-camera-garden-b", 0.2, 3.5, "אותה כניסה, רקע ירוק", "גיבוי", ""),
    (A, "forest-cross-frame", "ahiya-actions/walk-forest-a", 6.5, 10.2, "חוצה את הפריים ביער אורנים, חולצת פסים", "מעבר, הליכה בשטח", ""),
    (A, "forest-walk-away", "ahiya-actions/walk-forest-a", 22.5, 28.5, "מתרחק מהמצלמה לתוך היער", "יציאה למשחק, סוף של סרטון", ""),
    (A, "forest-walk-toward", "ahiya-actions/walk-forest-a", 31.0, 36.5, "חוזר מהיער לכיוון המצלמה", "כניסה לפריים", ""),
    (A, "forest-walk-away-b", "ahiya-actions/walk-forest-b", 1.0, 6.0, "מתרחק לתוך היער, טייק נוסף", "גיבוי", ""),
    (A, "robotics-robot-on-field", "ahiya-actions/robotics-robot-field", 1.0, 7.5, "רובוט התחרות על המגרש, עם האלמנטים הצהובים", "\"אני גם ברובוטיקה\", מי אני", "478x850, להציג במסגרת"),
    (A, "rappelling-cliff", "ahiya-actions/rappelling-cliff", 0.3, 6.5, "גולש בסנפלינג ממצוק, מלמטה, מול השמיים ואז על הסלע", "אומץ, \"דברים שאני עושה\"", "478x850, להציג במסגרת"),
    (A, "hike-trail-pov", "ahiya-actions/hike-trail-and-selfie", 0.5, 6.0, "שביל עפר בין שדות יבשים, מנקודת המבט של ההולך", "\"71 קילומטר\", מסע, דרך ארוכה", ""),
    (A, "hike-selfie-hat", "ahiya-actions/hike-trail-and-selfie", 12.8, 15.6, "סלפי מלמטה עם כובע רחב ותיק גב, שמיים כחולים", "אמצע מסע, מאמץ", ""),
    (A, "hike-friend-walks-ahead", "ahiya-actions/hike-walking-away", 0.3, 8.0, "מישהו הולך לפנים בשביל, ובסוף נפתח נוף של עמק", "מסע עם חברים, הגעה לנוף", "האדם שהולך לפנים מצולם מהגב"),
    (A, "hills-view", "ahiya-actions/hills-view", None, None, "נוף של גבעות ירוקות ושמיים, מההליכה", "פתיחה של מקום, רקע לכותרת", ""),
    (A, "canyon-rock-arch", "ahiya-actions/canyon-rock-arch", 0.5, 6.5, "קשת סלע טבעית מעל ואדי ירוק, המצלמה זזה לאט", "נוף, טיול, רקע לכותרת", ""),
    (A, "night-trail-flashlight", "ahiya-actions/night-trail-flashlight", 0.5, 5.5, "שביל בלילה לאור פנס, מנקודת המבט של ההולך", "משחק לילה, מתח", "רועד"),
    # ── אנשים ───────────────────────────────────────────────────────────────
    (P, "booth-table-crowd", "people/booth-table-crowd-full", 22.0, 30.0, "העמדה במחנה יהודה בלילה: שולחן כתום עם דפי QR, אנשים עוברים, אורות שוק", "הוכחה שזה אמיתי: \"הקמנו עמדה בשוק\"", "המקור המלא חזר מהטלפון ב 13.10"),
    (P, "booth-visitors-at-table", "people/booth-table-crowd-full", 3.5, 9.5, "אנשים עומדים ליד השולחן ומסתכלים על הדפים", "אנשים מתעניינים", ""),
    (P, "booth-helper-smiling", "people/booth-side-full", 1.0, 5.0, "חבר שעוזר בעמדה, מקרוב, מחייך ומדבר", "הצוות, אווירה", "לבקש את הסכמתו"),
    (P, "booth-visitor-phone", "people/booth-side-full", 25.0, 31.0, "מבקר ליד השולחן הכתום עם טלפון ביד", "\"סרקו את הקוד והצטרפו\"", ""),
    (P, "booth-wide-alley", "people/booth-side-full", 47.5, 52.5, "השוט הרחב ביותר: העמדה והסמטה נמשכת אחורה עם קהל", "פתיחה של הקטע על השוק", ""),
    (P, "booth-guys-approach", "people/booth-guys-approach", None, None, "חבורה ניגשת לשולחן, אחד מצביע", "סקרנות, \"מה זה?\"", ""),
    (P, "booth-girls-posing", "people/booth-girls-posing", None, None, "שלוש בנות עומדות מאחורי הלוח ומצטלמות", "אנשים אוהבים את זה", "לבקש הסכמה לפני פרסום"),
    (P, "booth-handshake-night", "people/booth-1015-handshake", 4.0, 7.0, "אחיה לוחץ יד לנער ליד השולחן הכתום בלילה, השוק מלא אנשים מאחור", "\"פגשנו המון אנשים\", אווירה בעמדה", "15.10. בלי קול. קטין כנראה: הסכמה לפני פרסום"),
    (P, "booth-market-night-wide", "people/booth-1015-market", 27.5, 35.0, "השוק בלילה עם שרשראות אורות, אחיה עם מיקרופון מול שני נערים ליד השולחן", "\"יצאנו לשוק\", פתיחה של קטע עמדה", "15.10. בלי קול. קטינים: הסכמה לפני פרסום"),
    (P, "booth-banner-handshake", "people/booth-1015-banner", 0.0, 1.9, "השלט RushPoint Live על השולחן הכתום, אחיה לוחץ יד לנער", "הוכחה שזה אמיתי, \"RushPoint Live\"", "15.10. קצר. הסכמה לפני פרסום"),
    (P, "street-approach-jaffa", "people/street-1016-approach", 9.6, 11.8, "רחוב יפו בלילה: אחיה עם מיקרופון ניגש לנער ליד קיר תמונות", "\"שאלנו אנשים ברחוב\"", "16.10 (וואטסאפ, 576x1024). בלי קול. קטין: הסכמה"),
    (P, "street-group-tram", "people/street-1016-group-tram", 0.0, 4.5, "חבורה של ארבעה ליד פסי הרכבת הקלה בלילה, אחיה עם מיקרופון", "\"אנשים ברחוב\", ראיון רחוב", "16.10 (וואטסאפ, 576x1024). בלי קול. קטינים: הסכמה"),
    (P, "selfie-with-friend", "people/selfie-with-friend", 1.0, 6.5, "סלפי קרוב עם חבר, שניהם צוחקים, בלילה", "חברים, כיף", "478x850. לבקש את הסכמת החבר"),
    (P, "player-dance-mission", "people/hachvav-player-a", 5.0, 13.0, "נער מבצע משימה מול המצלמה בטיילת בלילה, זז ורוקד", "\"ככה נראית משימה\"", MINOR + ". 480x640"),
    (P, "players-group-on-grass", "people/hachvav-player-c", 8.3, 16.0, "קבוצה יושבת על דשא בלילה, אחד עומד מולם", "קבוצה באמצע משימה", MINOR + ". 480x640"),
    (P, "player-pingpong-mission", "people/hachvav-player-d", 5.0, 13.0, "ילד ליד שולחן פינג פונג בלילה, מבצע משימה", "\"ככה נראית משימה\"", MINOR + ". 480x640. זה גם הקובץ \"משימה במשחק שהיה בחמישי\""),
    (P, "players-show-shoe", "people/hachvav-player-e", 5.0, 12.0, "שני נערים מקרוב, מראים נעל למצלמה וצוחקים", "משימת חפץ, הומור", MINOR + ". 480x640"),
    (P, "player-singing", "people/hachvav-player-singing", 0.5, 6.5, "משתתפת שרה בחוץ בלילה, עומדת מול המצלמה", "משימת שירה", MINOR + ". 480x640. אחרי 7 שניות הסרטון מסתובב על הצד"),
    (P, "kid-running-night", "people/kid-running-night", None, None, "ילד רץ בלילה, שנייה אחת", "אנרגיה, חיתוך מהיר", MINOR),
    (P, "group-phones-blurred", "people/group-arcade-blurred", None, None, "שלושה יושבים עם טלפונים ומשחקים. פני הבנות מטושטשות, הבנים גלויים", "שחקנים באמצע משחק", "רק פני הבנות מטושטשות, שני הבנים גלויים: לא לפרסם בלי אישור"),
    (P, "group-table-blurred", "people/group-table-blurred", None, None, "קבוצה סביב שולחן עם אוכל בחוץ, הפנים מטושטשות", "משחק עם חברים, משפחה", "רוב הפנים מטושטשות, לבדוק את מי שיושב בחזית לפני פרסום"),
    # ── מסכי האפליקציה ──────────────────────────────────────────────────────
    (APP, "play-map-and-mission-card", "app-screens/play-app-full-run-phone-1", 20.0, 28.0, "אפליקציית השחקנים: מפה עם הנקודה הבאה וכרטיס \"משימה בדרך\"", "\"הטלפון מנווט אתכם לנקודה\"", "412x838, להדביק בתוך טלפון"),
    (APP, "play-answering-question", "app-screens/play-app-full-run-phone-1", 96.0, 106.0, "משימה פתוחה עם ארבע תשובות, אחת נבחרת", "\"בכל נקודה מחכה משימה\"", "412x838. טקסט המשימה גלוי"),
    (APP, "play-next-mission", "app-screens/play-app-full-run-phone-1", 108.0, 117.5, "אחרי התשובה: המפה חוזרת עם המשימה הבאה", "רצף, \"וממשיכים לנקודה הבאה\"", "412x838"),
    (APP, "play-team-member-view", "app-screens/play-app-full-run-phone-2", 70.0, 78.0, "הטלפון השני בקבוצה: רואה את המשימה, הטלפון הראשון עונה", "\"כולם רואים, אחד עונה\"", "412x838"),
    (APP, "play-add-phone-qr", "app-screens/play-app-devices-and-sos", 4.0, 10.5, "נפתחת חלונית הטלפונים של הקבוצה עם קוד QR", "\"חבר מצטרף בסריקה\"", "412x838"),
    (APP, "play-sos-sheet", "app-screens/play-app-devices-and-sos", 36.5, 46.0, "לחיצה על SOS: חלון מצוקה עם 101, 100, 102", "בטיחות", "412x838"),
    (APP, "play-join-and-load", "app-screens/play-app-second-phone-joins", 3.5, 11.5, "מסך הצטרפות, שם, והמשחק נטען עם המפה", "\"מצטרפים עם קוד\"", "412x838"),
    (APP, "phone-white-join", "app-screens/phone-white-join", None, None, "טלפון מוכן על רקע לבן: הצטרפות לקבוצה", "להדביק כמו שהוא בסרטון עם רקע לבן", "1080x1920, בלי קול"),
    (APP, "phone-white-arrive", "app-screens/phone-white-arrive", None, None, "טלפון על לבן: מגיעים לנקודה והמשימה נפתחת", "כנ״ל", "טקסט המשימה מטושטש"),
    (APP, "phone-white-navigate", "app-screens/phone-white-navigate", None, None, "טלפון על לבן: ניווט על המפה", "כנ״ל", ""),
    (APP, "phone-white-score", "app-screens/phone-white-score", None, None, "טלפון על לבן: הניקוד עולה", "כנ״ל", "טקסט המשימה מטושטש"),
    (APP, "phone-white-sealed", "app-screens/phone-white-sealed", None, None, "טלפון על לבן: משימה סגורה עם מרחק", "כנ״ל", ""),
    (APP, "phone-white-sos", "app-screens/phone-white-sos", None, None, "טלפון על לבן: חלון ה SOS", "כנ״ל", ""),
    (APP, "phone-dark-navigate", "app-screens/phone-dark-navigate-a", None, None, "טלפון על רקע כהה: מפה ומשימה בדרך", "סרטון עם רקע כהה", "1080x1920, בלי קול"),
    (APP, "creator-builder-task-list", "app-screens/creator-console-three-screens", 12.5, 19.5, "הבונה של היוצר: רשימת משימות של משחק", "\"בונים משחק בכמה דקות\"", "1080x1920, בלי קול"),
    (APP, "creator-builder-satellite-map", "app-screens/creator-console-three-screens", 21.5, 27.0, "הבונה: נעיצת נקודה על מפת לוויין", "\"מסמנים נקודות על מפה\"", ""),
    (APP, "creator-route-map-phone", "app-screens/creator-route-map", None, None, "הקלטת מסך מהטלפון: מפת מסלול בבונה", "היוצר בנייד", "392x850"),
    (APP, "real-phone-join-with-code", "app-screens/play-app-photo-missions", 5.5, 10.5, "הקלטת מסך אמיתית מטלפון: מסך הפתיחה והקלדת קוד", "\"נכנסים עם קוד\"", "1080x2340"),
    (APP, "real-phone-photo-mission", "app-screens/play-app-photo-missions", 23.5, 31.0, "הקלטה אמיתית: משימת צילום \"הביטלס\" עם תמונת הדוגמה", "\"המשימות הן לא חידון\"", "1080x2340. טקסט המשימה גלוי"),
    (APP, "real-phone-finish-screen", "app-screens/play-app-photo-missions", 49.0, 53.6, "הקלטה אמיתית: מסך \"סיימתם!\" עם ניקוד 69", "סיום, ניקוד", "1080x2340"),
    (APP, "bug-table-scroll", "app-screens/bug-table", None, None, "טבלת באגים כהה, נגללת", "\"מצאתי 30 באגים\", devlog", ""),
    (APP, "terminal-green-tests", "app-screens/terminal-green-tests", 1.5, 8.0, "טרמינל: טסטים רצים ומסתיימים בירוק", "\"הכל עובד\", devlog", ""),
    # ── מפות ────────────────────────────────────────────────────────────────
    (MAPS, "map-jerusalem-zoom", "maps/map-jerusalem-zoom", None, None, "מפה, זום לירושלים, נקודות כתומות מתפזרות בכל העיר, בלי מסלול", "פתיחה של מקום, \"מרוץ בכל העיר\"", "לרוחב 16:9; לאורך נחתך למרכז, מ va=1.5 הנקודות כבר שם (19, 21)"),
    (MAPS, "map-route-motza-to-park", "maps/map-route-motza-to-park", None, None, "המסלול ממוצא לפארק התנ״ך נמתח על המפה עם שמות", "הסבר של מסלול המירוץ לציון", "לרוחב 16:9. רק המירוץ לציון (כלל 80)"),
    (MAPS, "map-route-vertical-short", "maps/map-route-vertical-short", None, None, "אותו מסלול לאורך, קצר", "כנ״ל, לסרטון לאורך", "רק המירוץ לציון (כתוב מוצא). למירוץ אחר: map-jerusalem-zoom (כלל 80)"),
    (MAPS, "map-route-vertical", "maps/map-route-vertical", None, None, "אותו מסלול לאורך, הגרסה המלאה", "כנ״ל", "להאיץ לפי אורך המשפט. רק המירוץ לציון (כלל 80)"),
    # ── סטוק ────────────────────────────────────────────────────────────────
    (ST, "au-flag", "stock/au-flag", None, None, "דגל אוסטרליה מתנופף", "חדשות מהעולם", "Mixkit 42088"),
    (ST, "city-night", "stock/city-night", None, None, "עיר בלילה מלמעלה", "\"בעולם\", רקע לכותרת", "Mixkit 42343"),
    (ST, "classroom", "stock/classroom", None, None, "כיתה, ילדים ליד שולחנות", "בית ספר", "Mixkit 35954"),
    (ST, "friends-run", "stock/friends-run", None, None, "חברים רצים בשדה מול השמש, צלליות", "חופש, משחק בחוץ", "Mixkit 23582"),
    (ST, "kangaroo", "stock/kangaroo", None, None, "קנגורו", "אוסטרליה", "Mixkit 11149"),
    (ST, "scroll-bed", "stock/scroll-bed", None, None, "גלילה בטלפון במיטה", "זמן מסך", "Mixkit 13168"),
    (ST, "texting-night", "stock/texting-night", None, None, "יד מקלידה בטלפון, מקרוב", "זמן מסך", "Mixkit 14669"),
    (ST, "uk-bigben", "stock/uk-bigben", None, None, "ביג בן", "בריטניה", "Mixkit 33823"),
    # ── AI, מותג ────────────────────────────────────────────────────────────
    (AI, "kids-running-trail", "ai-generated/kids-running-trail", None, None, "ילדים רצים בשביל בהר", "לא לשימוש כמות שהוא", "נוצר ב AI, יש סימן מים בפינה"),
    (BR, "rushpoint-outro-white", "brand/rushpoint-outro-white", None, None, "האייקון קופץ פנימה, השם RushPoint נכתב, קו כתום נמתח. רקע לבן", "סיום של סרטון (רק כשאחיה מבקש לוגו)", "בלי קול, 2.6 שניות"),
]
SHELVES = [
    (A, "אחיה בפעולה", "אתה עושה משהו ולא מדבר למצלמה."),
    (P, "אנשים", "העמדה בשוק, שחקנים באמצע משחק, חברים. **רוב מי שמופיע כאן קטין: קוראים את עמודת ההערות לפני פרסום.**"),
    (APP, "מסכי האפליקציה", "הקלטות מסך אמיתיות וטלפונים מוכנים להדבקה."),
    (MAPS, "מפות", "מפות מונפשות. שלוש מהן הן המסלול של המירוץ לציון ורק לו; למירוץ אחר בעיר: map-jerusalem-zoom."),
    (ST, "סטוק", "Mixkit, רישיון חופשי לשימוש מסחרי בלי קרדיט (`stock/LICENSES.txt`)."),
    (AI, "נוצר ב AI", "לא להציג כצילום אמיתי."),
    (BR, "מותג", "אנימציות של RushPoint."),
]


def probe(p):
    j = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height:stream_side_data=rotation", "-of", "json", str(p)], capture_output=True, text=True, encoding="utf-8", errors="replace").stdout)
    v = [s for s in j["streams"] if s["codec_type"] == "video"][0]
    w, h = v["width"], v["height"]
    for sd in v.get("side_data_list", []):
        if abs(int(sd.get("rotation", 0))) in (90, 270): w, h = h, w
    return float(j["format"].get("duration") or 0), w, h, any(s["codec_type"] == "audio" for s in j["streams"])


def make(row):
    shelf, name, key, a, b, what, use, note = row
    src = HOME / SRC[key]
    dst = OUT / shelf / f"{name}.mp4"
    dst.parent.mkdir(parents=True, exist_ok=True)
    stamp = dst.with_suffix(".src")
    sig = f"{SRC[key]}|{a}|{b}|{src.stat().st_size}"
    if not (dst.exists() and stamp.exists() and stamp.read_text(encoding="utf-8") == sig):
        cut = (["-ss", f"{a:.2f}"] if a is not None else []) + (["-t", f"{b - a:.2f}"] if a is not None else [])
        subprocess.run(["ffmpeg", "-y", "-v", "error", *cut, "-i", str(src), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-crf", "17", "-preset", "fast",
                        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(dst)], check=True)
        stamp.write_text(sig, encoding="utf-8")
    d, w, h, au = probe(dst)
    return {"shelf": shelf, "file": dst.name, "path": dst, "dur": d, "w": w, "h": h, "audio": au, "what": what, "use": use, "note": note,
            "src": SRC[key], "span": "כל הקובץ" if a is None else f"{a:g} עד {b:g}"}


keep = {(r[0], r[1] + ".mp4") for r in CLIPS}
for shelf, _, _ in SHELVES:
    d = OUT / shelf
    if d.exists():
        for f in d.iterdir():
            if f.suffix.lower() in (".mp4", ".webm", ".src") and (shelf, f.with_suffix(".mp4").name) not in keep:
                f.unlink()                                  # copies from the first pass: only files this script made
with ThreadPoolExecutor(4) as ex:
    items = list(ex.map(make, CLIPS))
lic = HOME / "Desktop/RushPoint-reels-work/reel14-phone/stock/LICENSES.txt"
if lic.exists(): shutil.copy2(lic, OUT / "stock" / "LICENSES.txt")
photo = HOME / "Downloads/Mobile Devices/20260917_211309.jpg"
if photo.exists():
    im = Image.open(photo); im.thumbnail((1600, 1600)); im.save(OUT / "people" / "booth-photo-poster-and-table.jpg", quality=86)

TW, TH = 150, 266
font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 15)
total = sum(i["dur"] for i in items)
md = ["# ספריית חומרים", "",
      f"{len(items)} קטעים קצרים ({total / 60:.0f} דקות בסך הכל) שאפשר להכניס לסרטון, בלי אף קטע שבו אתה מדבר למצלמה.",
      "כל קטע נחתך לדבר העיקרי שבו, ויש לו שורה שאומרת מה רואים, למה הוא מתאים, ומאיפה הוא בא.", "",
      "נבנתה ב 13.10.2026 מסריקה של כל חומרי הסרטונים הקודמים: ההורדות מהטלפון (כולל 22 הקבצים שהעברת באותו ערב),",
      "תיקיות העבודה של הרילס, תיקיית `downloads` בריפו ותיקיית הווידאו של המחשב.", "",
      "- **אלה עותקים חתוכים.** המקור נשאר במקומו. העמודה \"מקור\" אומרת מאיזה קובץ ומאילו שניות, אם צריך קטע ארוך יותר.",
      "- **קבצי mp4 לא נכנסים ל git**, אז אין להם גיבוי מחוץ למחשב הזה.",
      "- בכל מדף יש `sheet.jpg`: שלושה פריימים מכל קטע, כדי לבחור בעין.",
      "- איכות: crf 17 ברזולוציה המקורית. הקול נשמר כשיש.", "",
      "| מדף | מה יש בו | קטעים | אורך כולל |", "|---|---|---|---|"]
for shelf, he, about in SHELVES:
    its = [i for i in items if i["shelf"] == shelf]
    md.append(f"| [{he}](#{shelf}) · `{shelf}/` | {about} | {len(its)} | {sum(i['dur'] for i in its):.0f} שניות |")
md.append("")
for shelf, he, about in SHELVES:
    its = [i for i in items if i["shelf"] == shelf]
    md += [f'<a id="{shelf}"></a>', f"## {he}", "", about, "", f"![{he}]({shelf}/sheet.jpg)", "",
           "| קובץ | אורך | מה רואים | מתאים ל | צורה וקול | מקור (שניות) | הערות |", "|---|---|---|---|---|---|---|"]
    cols = 4
    sheet = Image.new("RGB", (cols * (TW * 3 + 12), ((len(its) + cols - 1) // cols) * (TH + 26)), "white")
    dr = ImageDraw.Draw(sheet)
    for k, it in enumerate(its):
        shape = ("לאורך" if it["h"] > it["w"] else "לרוחב") + f" {it['w']}x{it['h']}, " + ("עם קול" if it["audio"] else "בלי קול")
        md.append(f"| `{it['file']}` | {it['dur']:.1f}ש | {it['what']} | {it['use']} | {shape} | `{Path(it['src']).name}` ({it['span']}) | {it['note']} |")
        x, y = (k % cols) * (TW * 3 + 12), (k // cols) * (TH + 26)
        for j, frac in enumerate((0.1, 0.5, 0.9)):
            raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{it['dur'] * frac:.2f}", "-i", str(it["path"]), "-frames:v", "1", "-vf",
                                  f"scale={TW}:{TH}:force_original_aspect_ratio=decrease,pad={TW}:{TH}:(ow-iw)/2:(oh-ih)/2:white", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
            if len(raw) == TW * TH * 3: sheet.paste(Image.frombytes("RGB", (TW, TH), raw), (x + j * TW, y + 22))
        dr.text((x + 3, y + 2), f"{it['file'][:-4]}  {it['dur']:.0f}s", fill="black", font=font)
    sheet.save(OUT / shelf / "sheet.jpg", quality=82)
    if shelf == P:
        md += ["", "תמונה: `booth-photo-poster-and-table.jpg`, העמדה ביום עם הפוסטר של RushPoint Live, השולחן הכתום ושתי מבקרות מהגב."]
    md.append("")
md += ["## מה לא נכנס, ואיפה הוא", "",
       "- **אתה מדבר למצלמה** (כ 190 קבצים): כל הטייקים של הרילס, סרטון הכיתות וסרטון הפתיחה. הם ב `Downloads/Mobile Devices` וב `Desktop/RushPoint-reels-work/<ריל>/src`.",
       "- **השיחה עם הנער בקניון (ריל 15)**: `Downloads/Mobile Devices/20261005_1758*` עד `1802*`. מחכים לאישור הורה.",
       "- **סרטון של שחקנים שצולם על הצד ובחושך** (`downloads/פעולת-פתיחה-חבב-1`, השני ברשימה): לא שמיש.",
       "- **סרטונים גמורים**: [../../videos](../../videos). **צילומי העמדה החתוכים הישנים**: [../booth-2026-09-17](../booth-2026-09-17).",
       "- **חודש ארגון, המזח, הקלטת זום**: בתיקיית הווידאו של המחשב, לא קשורים ל RushPoint.", "",
       "## איך מוסיפים קטע", "",
       "מוסיפים שורה לרשימה `CLIPS` ב `build-library.py` שבתיקייה הזאת (מדף, שם, קובץ מקור, שנייה התחלה, שנייה סוף, מה רואים,",
       "למה מתאים, הערה) ומריצים אותו. הוא חותך רק את מה שהשתנה ובונה מחדש את הדף הזה ואת דפי התצוגה."]
(OUT / "README.md").write_text("\n".join(md) + "\n", encoding="utf-8", newline="\n")
(OUT / "sources.json").write_text(json.dumps({f"{i['shelf']}/{i['file']}": {"source": i["src"], "span": i["span"]} for i in items}, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
print(len(items), "clips", round(total), "s", round(sum(i["path"].stat().st_size for i in items) / 1048576), "MB")
