# -*- coding: utf-8 -*-
"""The booth: a passer by who met us a minute earlier takes the mic and sells the race to others
("זה לא בשביל הכסף, זה בשביל החוויה"); Ahiya: "וואלה אחי, התקבלת לצוות השיווק שלנו".
20261015_214907 (Samsung, at the booth). P = the people at the booth, A = Ahiya.
The 13..25 s stretch is unintelligible in the recording and is left out. The last line was said with the
camera on the table, so its picture is the glasses guy from earlier (va), a reaction shot."""
import sys
from pathlib import Path

RD = Path(__file__).resolve().parent
sys.path.insert(0, str(RD.parent / "street-200"))
from street import assemble  # noqa: E402

S = "20261015_214907.mp4"
CUTS = [
    dict(src=S, a=0.70, b=7.30, part="hook", caps=[
        ("P", "תקשיב אחי, אני פעם ראשונה שלי פה,", 0.76, 3.98), ("P", "אני לא הכרתי אותם לפני,", 4.10, 5.10),
        ("P", "זה נשמע מאוד מטורף, אני קורא לך רעיון.", 5.28, 7.26)]),
    dict(src=S, a=7.26, b=12.60, part="pitch", caps=[
        ("P", "אתה בא לפה עם כמה חברים, חברות, כמה שאתה רוצה אחי,", 7.26, 10.20), ("P", "אתה מסתובב בירושלים, יש לך משימות,", 10.22, 12.56)]),
    dict(src=S, a=30.16, b=34.24, part="pitch", caps=[
        ("P", "אתה מתחיל ממקום התחלתי,", 30.20, 32.22), ("P", "נותנים לך משימות, חידות וזה,", 32.24, 34.20)]),
    dict(src=S, a=35.66, b=39.60, part="pitch", caps=[
        ("P", "אתה הולך עם חברים וזה,", 35.70, 36.94), ("P", "אתה מנצח, אלף שקל, אחי.", 38.08, 39.56)]),
    dict(src=S, a=40.48, b=47.08, part="heart", caps=[
        ("P", "אחי, עזוב את זה, גם לא קשור לכסף,", 40.52, 42.34), ("P", "זה בשביל החוויה, אחי, זה בשביל החוויה.", 42.44, 45.32),
        ("P", "צודק, לא בשביל הכסף, לא בשביל הכסף.", 45.40, 47.04)]),
    dict(src=S, a=47.50, b=50.22, part="heart", caps=[("P", "חוויה, אתה מסתובב עם חברים בירושלים, אחי.", 47.54, 50.18)]),
    dict(src=S, a=73.14, b=75.98, va=57.50, part="end", caps=[("A", "וואלה אחי, התקבלת לצוות השיווק שלנו.", 73.20, 75.94)]),
]

if __name__ == "__main__":
    print(assemble(RD, CUTS, tempo=1.03, denoise_db=32)[0])
