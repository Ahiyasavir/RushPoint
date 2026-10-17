# -*- coding: utf-8 -*-
"""Mystery mission 1: Akiva asks Shlomo, Aharon and Yeshaya; they pick the secret surprise, hear about
the race, and take the 1,000. WA0014 (one take). The date ("ב 22 לאוקטובר") is cut out (rule 36).
A = Akiva here (the one asking), P = the boys."""
import sys
from pathlib import Path

RD = Path(__file__).resolve().parent
sys.path.insert(0, str(RD.parent / "street-200"))
from street import assemble  # noqa: E402

S = "VID-20261016-WA0014.mp4"
CUTS = [
    dict(src=S, a=0.78, b=7.92, part="hook", caps=[
        ("A", "אהלן חבר'ה, אתם רוצים 200 שקל?", 0.86, 2.34), ("P", "כן. כן.", 2.54, 3.30),
        ("A", "או שאתם מעדיפים הפתעה סודית?", 3.60, 6.20), ("P", "הפתעה סודית. יאללה.", 6.42, 7.88)]),
    dict(src=S, a=7.94, b=12.62, part="names", caps=[
        ("A", "אז תקשיבו, מה השם?", 7.98, 9.58), ("P", "שלמה.", 9.66, 10.30), ("P", "אהרן.", 10.46, 10.95),
        ("A", "אני עקיבא.", 11.84, 12.60)]),   # the third name is unclear on the tape: not guessed (rule 22)
    dict(src=S, a=16.84, b=22.86, part="pitch", caps=[
        ("A", "אז ככה, יש לנו 200 שקל,", 16.88, 19.22), ("A", "או עכשיו, אנחנו בנינו סטארט אפ של המרוץ למיליון.", 19.22, 22.84)]),
    dict(src=S, a=23.42, b=24.24, part="pitch", caps=[("A", "בחמישי הבא,", 23.46, 24.22)]),
    dict(src=S, a=25.98, b=29.28, part="pitch", caps=[("A", "אנחנו עושים מרוץ שהזוכה מקבל 1,000 שקל.", 26.00, 29.26)]),
    dict(src=S, a=29.22, b=34.82, part="choice", caps=[
        ("A", "עכשיו, מה אתם מעדיפים?", 29.24, 30.58), ("A", "לזכות ב 1,000 שקל, או 200 שקל?", 30.78, 32.62),
        ("P", "1,000 שקל. 1,000, 1,000.", 32.70, 34.80)]),
    dict(src=S, a=34.82, b=39.80, part="end", caps=[
        ("A", "אז תעקבו, ותקבלו את ה 1,000 שקל.", 34.86, 37.06), ("P", "תביא. תביא.", 37.08, 38.50),
        ("P", "אני עוקב, מבטיח.", 38.80, 39.76)]),
]

if __name__ == "__main__":
    print(assemble(RD, CUTS, tempo=1.03, denoise_db=32)[0])
