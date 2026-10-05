# -*- coding: utf-8 -*-
"""Build reel 3's phone screens (P1..P6 + the 04:04 lock screen) into the work folder.

    python reels/reel3-ai/make_proofs.py

Style follows Ahiya's own phone (dark WhatsApp "מערכת" self chat, Google Calendar dark,
his lock screen wallpaper). Content: P1 and P4 are his real message / real day; the rest
are written in his voice on his instruction ("create them yourself"). Every other
person's name is wrapped in [[...]] and comes out blurred.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from lib import phone  # noqa: E402
from lib.common import reel_dir  # noqa: E402

R = reel_dir("reel3-ai")
P = R / "proofs"
P.mkdir(exist_ok=True)

phone.whatsapp(P / "P1.png", "מערכת", [{"out": True, "time": "04:04", "text":
    "בוקר טוב. היום רביעי 30/9, חול המועד סוכות.\n\nהלוז של היום:\n"
    "יום שני, והאחרון, של ים אל ים מחדש עם [[עילאי]]. אין שום דבר אחר קבוע בלוח.\n"
    "19:30, אימון כוח לריצה. אחרי יומיים הליכה ברצף, עדיף לוותר עליו הערב.\n"
    "היום גם יום ההולדת של [[ינון]] בבאר שבע. שווה לפחות לשלוח לו ברכה.\n\n"
    "מוטיבציה ליום: זה היום השני ברצף שהרגליים כבר יודעות מה זו עייפות אמיתית. "
    "לגמור אותו כמו שצריך לא פחות חשוב מהיום הראשון."}],
    "04:04", subtitle="You", day_chip="Today")

phone.whatsapp(P / "P2.png", "מערכת", [{"out": True, "time": "06:12", "text":
    "סיכום המיילים מהלילה:\n1. [[שם השולח]] אישר את ההרשמה, נשאר רק לשלם.\n"
    "2. קבלה על השרתים, $40.\n3. [[שם השולח]] שאל אם אפשר לקבוע שיחה ביום ראשון.\n\n"
    "כל השאר פרסומות. סימנתי כנקרא."}],
    "06:12", subtitle="You", day_chip="Today")

phone.whatsapp(P / "P3.png", "שם חבר", [
    {"out": False, "time": "20:41", "text": "אחי אתה מגיע הערב?"},
    {"out": True, "time": "20:43", "text": "הערב לא, יש לי מבחן במתמטיקה ב 13.10 ואני באמצע צילומים. מחר בטוח"},
    {"out": False, "time": "20:44", "text": "סבבה, מחר"}],
    "20:44", subtitle="online", blur_title=True, day_chip="Today")

phone.gcal_day(P / "P4.png", "18:02", "Thu", "1", "October",
               [("כות שמחת תורה (Day 14/17)", "#4F86C6"), ("שרטוט (Day 5/21)", "#9E8FD0")],
               [(5.0, 5.9, "קימה + ריצה קלה (רק אם הרגליים בסדר)", False),
                (8.0, 9.9, "פארק התנ״ך (ניקוי עצים)", False),
                (11.0, 11.9, "מתמטיקה (מבחן 13.10)", True),
                (13.3, 14.4, "צילום: סרטון המדרגות + שוטים לסרטון העוזר", False),
                (17.3, 18.1, "סידור חדר יסודי", False),
                (19.0, 19.6, "שוטים בחושך לסרטון העוזר", False)])

phone.doc_view(P / "P5.png", "21:15", "דף עזר · מתמטיקה · מבחן 13.10", [
    ("h", "נגזרות"), ("f", "(xⁿ)′ = n·xⁿ⁻¹"), ("f", "(sin x)′ = cos x    (cos x)′ = −sin x"),
    ("p", "כלל השרשרת: גוזרים את החיצונית, כפול הנגזרת של הפנימית."),
    ("h", "משוואה ריבועית"), ("f", "x = (−b ± √(b² − 4ac)) / 2a"),
    ("p", "אם הדיסקרימיננטה שלילית, אין פתרון ממשי."),
    ("h", "מה לזכור במבחן"), ("p", "לבדוק תחום הגדרה לפני שגוזרים."),
    ("p", "בשאלות חקירה: נקודות קיצון, עלייה וירידה, ואז שרטוט.")])

phone.whatsapp(P / "P6.png", "שם המורה", [
    {"out": True, "time": "08:05", "text": "שלום, לא הגעתי היום לשיעור. אשלים את החומר עד יום ראשון ואשלח לך את התרגילים. תודה"},
    {"out": False, "time": "08:20", "text": "תודה שעדכנת 🙏"}],
    "08:20", subtitle="last seen today", blur_title=True, day_chip="Today")

phone.lock_screen(R / "assets" / "lock_0404.png", R / "assets" / "wallpaper_clean.jpg", "04", "04",
                  "Thu 1 October", "מערכת", "בוקר טוב. היום חמישי 1/10, חול המועד סוכות.", "now")
phone.lock_screen(R / "assets" / "lock_0404_empty.png", R / "assets" / "wallpaper_clean.jpg", "04", "04",
                  "Thu 1 October", "", "", "")
# the hook frames: rendered at the video's own 1080x1920 so nothing is cropped, clock below the safe line
for name, body in (("hook_0404_empty.png", ""), ("hook_0404.png", "בוקר טוב. היום חמישי 1/10, חול המועד סוכות.")):
    phone.lock_screen(R / "assets" / name, R / "assets" / "wallpaper_clean.jpg", "04", "04", "Thu 1 October",
                      "מערכת", body, "now", ph=1920, top=300)
print("proofs built in", P)
