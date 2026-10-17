# -*- coding: utf-8 -*-
"""Mystery mission 2: the girls from the north (Beit Rimon). Two takes they break by laughing, then
the real one: they pick the secret surprise, hear about the race, choose the 1,000. WA0015 (one file).
A = Ahiya, P = the girls. Names are skipped (unclear in the audio). The middle of 39..45 is checked
by transcribing the cut back before captions are trusted."""
import sys
from pathlib import Path

RD = Path(__file__).resolve().parent
sys.path.insert(0, str(RD.parent / "street-200"))
from street import assemble  # noqa: E402

S = "VID-20261016-WA0015.mp4"
CUTS = [
    # the broken takes, as a cold open
    dict(src=S, a=0.0, b=4.06, part="blooper", caps=[
        ("A", "אתם רוצות 200 שקל?", 0.0, 1.48), ("P", "רגע, רגע.", 1.50, 1.95), ("P", "מה, אבל כמה, כמה אפשר?", 2.08, 4.02)]),
    dict(src=S, a=25.70, b=31.72, part="blooper", caps=[
        ("A", "אהלן, אתם רוצות 200 שקל?", 25.74, 27.36), ("A", "מה אתה עושה?", 27.98, 29.10),
        ("A", "די.", 31.30, 31.68)]),
    # the real take
    dict(src=S, a=36.38, b=41.24, part="hook", caps=[
        ("A", "אהלן, אתם רוצות 200 שקל?", 36.42, 38.08), ("P", "יאללה.", 38.12, 38.70), ("A", "או... או?", 39.34, 40.10),
        ("P", "הפתעה סודית.", 40.36, 41.20)]),
    dict(src=S, a=49.28, b=51.88, part="where", caps=[("A", "איפה אתם?", 49.30, 49.98), ("P", "מבית רימון.", 50.78, 51.84)]),
    dict(src=S, a=55.96, b=61.90, part="pitch", caps=[
        ("A", "קיצר, אנחנו בנינו אפליקציה שעושה לנו מרוץ.", 56.00, 58.42), ("A", "משחקים כמו המרוץ למיליון.", 58.44, 59.80),
        ("A", "סבבה? בחמישי הבא אנחנו עושים מרוץ.", 59.86, 61.88)]),
    dict(src=S, a=61.92, b=65.56, part="pitch", caps=[
        ("A", "אם תירשמו ותנצחו,", 61.94, 64.18), ("A", "בסופו של דבר תקבלו 1,000 שקל.", 64.20, 65.54)]),
    dict(src=S, a=65.52, b=70.28, part="choice", caps=[
        ("A", "עכשיו, מה אתן מעדיפות?", 65.54, 66.86), ("A", "200 שקל או 1,000 שקל?", 66.88, 68.78),
        ("P", "1,000 שקל.", 68.86, 70.24)]),
    dict(src=S, a=70.50, b=72.98, part="end", caps=[("A", "אז תעקבו ואולי תנצחו.", 70.54, 71.90)]),
]

if __name__ == "__main__":
    print(assemble(RD, CUTS, tempo=1.03, denoise_db=32)[0])
