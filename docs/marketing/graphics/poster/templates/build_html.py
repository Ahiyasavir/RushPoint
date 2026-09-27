# -*- coding: utf-8 -*-
"""Emit ONE Canva-importable HTML file with all 4 kit pages (multi-page design).
Each page = a hosted background image + absolutely-positioned <div>s (every one
becomes a native editable Canva element). Positions are % of the page.

Fonts: only Canva-native Hebrew families are named, so the import maps them
cleanly instead of substituting a Latin default that mangles Hebrew.
  body  -> Assistant   (Canva-native, full Hebrew)
  head  -> Heebo        (Canva-native, Hebrew, weight up to 900)
  phone -> Space Mono   (Canva-native, Latin-only content: digits/dashes/X)
"""
import os, io

OUT = os.path.dirname(os.path.abspath(__file__))
BG = "https://rush-point.com/_kit-b83f9d2e"   # where the bg PNGs are hosted

INK, BONE, ORANGE, ORANGE_DK, SOFT = "#191713", "#f4ecde", "#d84e1c", "#963210", "#4e473c"

BODY_FONT = "'Assistant', 'Heebo', sans-serif"
HEAD_FONT = "'Heebo', 'Assistant', sans-serif"
MONO_FONT = "'Space Mono', monospace"

HEAD = """<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700;800&family=Heebo:wght@400;500;700;800;900&family=Space+Mono:wght@700&display=swap" rel="stylesheet">
<style>
 *{margin:0;padding:0;box-sizing:border-box;font-family:BODY_FONT}
 .page{position:relative;overflow:hidden;background:BONE}
 .page img.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
 .t{position:absolute;line-height:1.2;color:INK;font-family:BODY_FONT}
 .r{text-align:right}.c{text-align:center}
 .head{font-family:HEAD_FONT;font-weight:900;color:INK}
 .orange{color:ORANGE}.bone{color:BONE}.soft{color:SOFT}
 .box{position:absolute;border-radius:14px}
 .ink{background:INK}.oj{background:ORANGE}
 .mono{font-family:MONO_FONT;font-weight:700;letter-spacing:.04em}
 .frame{position:absolute;background:#ebe3d4;border:2px solid rgba(25,23,19,.55);border-radius:4px}
 .fcap{position:absolute;text-align:center;color:SOFT;font-weight:600;font-family:BODY_FONT}
</style></head><body>
"""
for _k, _v in {"BODY_FONT": BODY_FONT, "HEAD_FONT": HEAD_FONT, "MONO_FONT": MONO_FONT,
               "BONE": BONE, "INK": INK, "ORANGE": ORANGE, "SOFT": SOFT}.items():
    HEAD = HEAD.replace(_k, _v)

TAIL = "</body></html>"


def el(cls, style, html):
    return f'<div class="{cls}" style="{style}">{html}</div>\n'


def poster(mode):
    """mode: 'qr' or 'tearoff'."""
    W, Hh = 1240, 1754
    lbl = "פוסטר QR ומספר" if mode == "qr" else "פוסטר עם תלושים"
    P = [f'<div class="page" data-document-role="page" data-label="{lbl}" style="width:{W}px;height:{Hh}px">']
    P.append(f'<img class="bg" src="{BG}/bg-poster-{mode}.png" alt="">')
    R = "6.9%"   # right inset
    P.append(el("t r soft", f"top:3.6%;right:{R};font-size:17px;letter-spacing:.28em;font-weight:600",
                "תצפית שדה · [עיר]"))
    # scarcity badge — TOP-LEFT, clear of the headline
    P.append('<div class="box oj" style="top:6.2%;left:6.9%;width:38%;height:6.4%;border-radius:0"></div>')
    P.append(el("t c bone", "top:6.9%;left:6.9%;width:38%;font-size:24px;font-weight:800", "רק 5 תאריכים ראשונים"))
    P.append(el("t c bone", "top:9.8%;left:6.9%;width:38%;font-size:19px;font-weight:500", "במחיר היכרות"))
    # headline — TOP-RIGHT, nothing drawn over it
    P.append(el("t r head", f"top:14%;right:{R};width:60%;font-size:82px", "[שם האירוע]"))
    # RushPoint bar
    P.append('<div class="box ink" style="top:31.8%;right:6.9%;left:40%;height:8.2%"></div>')
    P.append(el("t c bone", "top:32.9%;left:40%;right:6.9%;font-size:28px;font-weight:800", "רץ על RushPoint"))
    P.append(el("t c bone", "top:36.6%;left:40%;right:6.9%;font-size:16px;font-weight:500", "פלטפורמה מקצועית למשחקי פעולה"))
    # body stack
    P.append(el("t r", f"top:41.6%;right:{R};font-size:29px;font-weight:800", "יום הולדת אקשן בחוץ · לגילאי 10 עד 15"))
    P.append(el("t r soft", f"top:48.6%;right:{R};font-size:26px", "מתחלקים לצוותים ורצים בין תחנות עם משימות בטלפון."))
    P.append(el("t r soft", f"top:52.2%;right:{R};font-size:26px", "כל משימה מקפיצה את הקופה המשותפת למעלה."))
    P.append(el("t r", f"top:57.6%;right:{R};font-size:25px;font-weight:700", "עד 30 משתתפים   ·   משך זמן גמיש"))
    P.append(el("t r", f"top:61.4%;right:{R};font-size:25px;font-weight:700", "המשחק מותאם אישית לאירוע שלכם"))
    P.append(el("t r", f"top:67%;right:{R};font-size:29px;font-weight:800", "חמש התחנות שעל המפה מסתירות מילה."))
    if mode == "qr":
        P.append(el("t r soft", f"top:71.4%;right:{R};font-size:27px", "אמרו אותה בטלפון, וזה מחיר ההיכרות שלכם."))
        P.append(el("t r soft", f"top:75.6%;right:{R};font-size:22px",
                    "אזור בטוח מסומן מראש · מבוגר מלווה · אני מגיע ומפעיל."))
        P.append('<div class="box ink" style="top:79.6%;right:6.9%;width:54%;height:14%"></div>')
        P.append(el("t r bone", "top:81.6%;right:9%;font-size:21px;font-weight:700",
                    "לתיאום תאריך · שיחה קצרה, בלי התחייבות"))
        P.append(el("t r bone mono", "top:84.6%;right:9%;font-size:44px", "05X-XXX-XXXX"))
        P.append(el("t r bone", "top:90.2%;right:9%;font-size:16px;font-weight:500",
                    "המילה מהמפה היא הקוד שאומרים בשיחה"))
        P.append('<div class="box ink" style="top:79.6%;right:62%;left:6.9%;height:16.5%"></div>')
        P.append(el("t c orange", "top:81.4%;right:62%;left:6.9%;font-size:20px;font-weight:800",
                    "ה־QR הזה לדוגמה"))
        P.append(el("t c bone", "top:84%;right:62%;left:6.9%;font-size:15px;line-height:1.7",
                    "צרו קוד משלכם:<br>1. qrcode-monkey.com<br>2. הדביקו wa.me/972 + הטלפון בלי ה־0<br>3. החליפו את הריבוע הזה"))
        P.append(el("t c bone", "top:93.5%;right:62%;left:6.9%;font-size:19px;font-weight:700", "סרקו לתיאום בוואטסאפ"))
    else:
        P.append(el("t r soft", f"top:70.2%;right:{R};font-size:19px",
                    "אמרו אותה בשיחה · אזור בטוח מסומן מראש · מבוגר מלווה · אני מגיע ומפעיל."))
        P.append(el("t r", f"top:73%;right:{R};font-size:21px;font-weight:800",
                    "לתיאום תאריך — קחו תלוש והתקשרו. שיחה קצרה, בלי התחייבות."))
        P.append(el("t r orange", "top:75.9%;right:6.9%;font-size:16px;font-weight:800",
                    "גזרו לאורך הקו · כל תלוש עם השם והטלפון"))
        P.append(f'<div class="box" style="top:77.4%;right:6.9%;left:6.9%;height:2px;background:{INK};border-radius:0"></div>')
        NST = 6
        top0, sth = 77.8, (95.8 - 77.8) / NST
        for i in range(NST):
            top = top0 + i * sth
            if i:
                P.append(f'<div class="box" style="top:{top:.2f}%;right:6.9%;left:6.9%;height:1px;'
                         f'background:rgba(25,23,19,.35);border-radius:0"></div>')
            P.append(f'<div class="t" style="top:{top + sth * 0.28:.2f}%;right:9%;font-size:17px;'
                     f'font-weight:700;color:{INK}">[שם האירוע]</div>\n')
            P.append(f'<div class="t mono" style="top:{top + sth * 0.28:.2f}%;left:9%;font-size:20px;'
                     f'color:{ORANGE_DK}">05X-XXX-XXXX</div>\n')
    P.append(el("t r", "bottom:2.2%;right:6.9%;font-size:15px;font-weight:700;color:#5c5346",
                "מופעל על RushPoint · פלטפורמה מקצועית למשחקי פעולה"))
    P.append(el("t", "bottom:2.2%;left:6.9%;font-size:13px;color:#8a7f6f", "TEMPLATE"))
    P.append("</div>")
    return "".join(P)


def story():
    W, Hh = 1080, 1920
    R = "6.5%"
    P = [f'<div class="page" data-document-role="page" data-label="סטורי" style="width:{W}px;height:{Hh}px">',
         f'<img class="bg" src="{BG}/bg-story.png" alt="">']
    P.append('<div class="frame" style="top:2%;right:2%;left:2%;height:26%"></div>')
    P.append('<div class="fcap" style="top:13.5%;right:2%;left:2%;font-size:23px">＋&nbsp;&nbsp;הוסיפו תמונה מאירוע שלכם</div>')
    P.append(el("t r bone", "top:31.5%;right:6.5%;left:6.5%;font-size:22px;font-weight:700",
                "יום הולדת אקשן בחוץ · גילאי 10 עד 15 · עד 30 משתתפים"))
    P.append(el("t r head", "top:33.5%;right:6.5%;font-size:70px", "[שם האירוע]"))
    P.append(el("t r", f"top:44%;right:{R};font-size:30px;font-weight:700",
                "יש רגע אחד ביום ההולדת שבו כולם שותקים:<br>השנייה לפני שהמשימה הראשונה נפתחת בטלפון."))
    P.append(el("t r soft", f"top:53%;right:{R};font-size:27px",
                "אני [השם], מארגן/ת ימי הולדת אקשן.<br>הצוותים רצים בין תחנות עם משימות בטלפון,<br>וכל אירוע נבנה סביבכם."))
    P.append(el("t r", f"top:64%;right:{R};font-size:27px",
                '<b style="color:%s">להורים:</b> אתם תדאגו לכיבוד, אני אדאג לתוכן שלא יישכח.<br>'
                '<b style="color:%s">לילדים:</b> יום ההולדת שידברו עליו בכיתה שבועיים.' % (ORANGE_DK, ORANGE_DK)))
    P.append(el("t r", f"top:71.5%;right:{R};font-size:27px;font-weight:700", "5 האירועים הראשונים במחיר היכרות."))
    P.append('<div class="frame" style="top:74.5%;right:6.5%;width:43%;height:12%"></div>')
    P.append('<div class="fcap" style="top:79.7%;right:6.5%;width:43%;font-size:20px">＋&nbsp;&nbsp;הצוות במשחק</div>')
    P.append('<div class="frame" style="top:74.5%;left:6.5%;width:43%;height:12%"></div>')
    P.append('<div class="fcap" style="top:79.7%;left:6.5%;width:43%;font-size:20px">＋&nbsp;&nbsp;האפליקציה בפעולה</div>')
    P.append(el("t r", f"top:88%;right:{R};font-size:29px;font-weight:700", "רוצים כזה ליום הולדת? כתבו לי:"))
    P.append(el("t r mono", f"top:90.5%;right:{R};font-size:56px;color:{ORANGE_DK}", "05X-XXX-XXXX"))
    P.append(el("t r", f"top:95%;right:{R};font-size:26px;font-weight:600", "שלכם, [השם]"))
    P.append(el("t r soft", f"bottom:1.8%;right:{R};font-size:17px;font-weight:700",
                "מופעל על RushPoint · פלטפורמה מקצועית למשחקי פעולה"))
    P.append("</div>")
    return "".join(P)


def home():
    W, Hh = 1080, 1920
    R = "7%"
    P = [f'<div class="page" data-document-role="page" data-label="המירוץ בבית" style="width:{W}px;height:{Hh}px">',
         f'<img class="bg" src="{BG}/bg-home.png" alt="">']
    P.append(el("t r soft", f"top:3%;right:{R};font-size:19px;letter-spacing:.22em;font-weight:500", "משחק בית · לכל המשפחה"))
    P.append(el("t r head", f"top:6%;right:{R};font-size:88px", "המירוץ"))
    P.append(el("t r head orange", f"top:16%;right:{R};font-size:88px", "בבית"))
    P.append(el("t r", f"top:27%;right:{R};font-size:30px;font-weight:700",
                "המשחק שהופך את סידור הבית<br>למירוץ בין צוותים"))
    P.append('<div class="box oj" style="top:35%;right:7%;width:52%;height:9%"></div>')
    P.append(el("t c bone", "top:36%;right:7%;width:52%;font-size:60px;font-weight:900", "חינם לגמרי"))
    P.append(el("t c bone", "top:41.5%;right:7%;width:52%;font-size:20px;font-weight:500", "בלי תשלום, בלי הרשמה"))
    P.append(el("t r", f"top:76%;right:{R};font-size:24px;line-height:2",
                "1&nbsp;&nbsp;מחלקים את הילדים לצוותים<br>"
                "2&nbsp;&nbsp;כל צוות מקבל משימות בטלפון<br>"
                "3&nbsp;&nbsp;מסדרים, משתפים פעולה, צוברים נקודות"))
    P.append(el("t r soft", f"top:87%;right:{R};font-size:20px;font-weight:700", "בלי הכנות · בלי ציוד · תוך דקה אתם משחקים"))
    P.append(el("t r orange", f"top:91%;right:{R};font-size:28px;font-weight:800", "הקישור למשחק למטה"))
    P.append(el("t r soft", f"bottom:2%;right:{R};font-size:16px;font-weight:700",
                "מופעל על RushPoint · פלטפורמה מקצועית למשחקי פעולה"))
    P.append("</div>")
    return "".join(P)


pages = poster("qr") + poster("tearoff") + story() + home()
io.open(os.path.join(OUT, "tpl-kit.html"), "w", encoding="utf-8", newline="").write(HEAD + pages + TAIL)
print("wrote tpl-kit.html")
