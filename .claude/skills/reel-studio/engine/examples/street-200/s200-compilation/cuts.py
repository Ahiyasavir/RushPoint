# -*- coding: utf-8 -*-
"""The 200 compilation: Ahiya asks Nadav (he says 200), then everyone who said 200 back to back,
then the best of Ahiya + Akiva's day summary on the steps. Goal: follows.

    python cuts.py            -> clips/take.mp4, voice/take.wav, measured.json, captions.json

Times are source seconds, read off the word level transcripts (ingest/<file>.json). A = Ahiya,
K = Akiva, P = the person asked. Captions are what was SAID.
"""
import sys
from pathlib import Path

RD = Path(__file__).resolve().parent
sys.path.insert(0, str(RD.parent / "street-200"))
from street import assemble  # noqa: E402

N9, N10, N8, N7, N13 = (f"VID-20261016-WA00{n:02d}.mp4" for n in (9, 10, 8, 7, 13))
SUM = "20261015_234102.mp4"

CUTS = [
    # the approach: "אח שלי, אח שלי, איך קוראים לך?" ... "200 שקל, מה, אני פראייר" ... "אני לא מאמין"
    dict(src=N9, a=9.62, b=19.15, part="hook", caps=[
        ("A", "אח שלי, אח שלי, איך קוראים לך?", 9.70, 11.30),
        ("P", "נדב.", 11.86, 12.22),
        ("A", "נדב, תגיד מה אתה מעדיף,", 12.24, 13.60),
        ("A", "200 שקל או משימה מסתורית?", 13.62, 15.10),
        ("P", "200 שקל, מה, אני פראייר?", 15.60, 16.95),
        ("P", "אתה ממלא.", 16.92, 17.40),
        ("A", "אני לא מאמין.", 18.00, 19.10)]),
    dict(src=N8, a=2.08, b=5.75, part="montage", caps=[
        ("A", "משימה מסתורית?", 2.10, 2.98), ("P", "200 שקל.", 3.10, 4.15), ("A", "טוב, קח.", 4.65, 5.70)]),
    dict(src=N13, a=11.86, b=14.62, part="montage", caps=[
        ("A", "משימה מסתורית?", 11.88, 12.72), ("P", "וואלה 200 שקל, אח שלי.", 13.04, 14.60)]),
    dict(src=N7, a=1.72, b=4.38, part="montage", caps=[
        ("A", "משימה מסתורית?", 1.74, 2.58), ("P", "200 שקל.", 2.66, 3.44), ("A", "טוב, קח.", 3.50, 4.34)]),
    dict(src=N10, a=4.84, b=10.35, part="montage", caps=[
        ("A", "משימה מסתורית?", 4.86, 5.76), ("P", "200 שקל!", 6.06, 7.18), ("A", "מה, אתם רציניים איתי?", 7.28, 8.48),
        ("A", "אני לא מאמין.", 8.88, 10.06)]),
    # the day summary: only the good parts
    dict(src=SUM, a=33.30, b=41.62, part="summary", zoom=1.3, caps=[
        ("A", "סיכום יום.", 33.42, 34.30), ("A", "היום הגענו לכאן עם אלף שקל,", 34.76, 37.30),
        ("A", "ועם כמה נשארנו?", 38.10, 39.16), ("K", "מינוס שלושת אלפים.", 40.00, 41.55)]),
    dict(src=SUM, a=47.42, b=49.82, part="summary", zoom=1.3, caps=[
        ("A", "הצענו לאנשים, פשוט לקחו לנו את הכסף.", 47.50, 49.75)]),
    dict(src=SUM, a=52.78, b=55.40, part="summary", zoom=1.3, caps=[
        ("A", "נאבד מאתיים שקל,", 52.84, 53.70), ("A", "מישהו פשוט גנב אותו.", 53.78, 55.35)]),
    dict(src=SUM, a=58.26, b=62.82, part="summary", zoom=1.3, caps=[
        ("A", "אנחנו באמת צריכים שתעקבו,", 58.40, 60.46), ("A", "תגיבו על הכל, זה באמת יעזור לנו.", 60.52, 62.75)]),
    dict(src=SUM, a=64.28, b=69.55, part="summary", zoom=1.3, caps=[
        ("K", "תעקבו, תורידו את האפליקציה,", 64.34, 66.60), ("K", "אנחנו מתחננים.", 67.16, 68.10), ("A", "נואשים.", 68.88, 69.50)]),
    dict(src=SUM, a=73.04, b=77.90, part="summary", zoom=1.3, caps=[
        ("A", "אם סחטנו אתכם לצפות בסרטון עד עכשיו,", 73.10, 75.78), ("A", "אז באמת תעשו לייק.", 75.86, 77.85)]),
]

if __name__ == "__main__":
    m, caps = assemble(RD, CUTS, tempo=1.03, denoise_db=32)
    print(m)
