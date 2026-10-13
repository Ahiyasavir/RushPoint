# -*- coding: utf-8 -*-
"""Reel 15: the 13 clips of 2026-10-05 (schoolyard, one tripod) → clips/take.mp4, one flowing take.

    python assemble.py     → clips/take.mp4 + measured.json (timer_start, timer_stop, take_end) + captions.json

The shoot was 13 short clips, each a beat of the conversation, with him walking in and out of
frame at the ends and some side talk (the mic setup, an English sentence, chatter after the end).
CUTS keeps only the conversation (transcribed first, see ingest/ingest.json). To make the cuts
invisible on a locked tripod shot: every other segment is framed ~11% tighter (a jump cut between
two framings reads as a camera change, a jump between identical framings reads as a cut), audio
gets a 60 ms crossfade, and each start is pulled to the first voice onset so no breath or footstep
leads a segment. Speed 1.12x on picture and sound together (founder rule 1).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

RD = Path(__file__).resolve().parent
SRC = RD / "src"
sys.path.insert(0, r"C:\Users\savir\Projects\Rushpoint\.claude\skills\reel-studio\engine")
os.environ.setdefault("RP_VOICE_LUFS", "-19")
from lib.audio import prep_voice  # noqa: E402
sys.path.insert(0, str(RD.parent))
from _portrait import GRADE  # noqa: E402

TEMPO = 1.03        # Ahiya: 1.12 was a bit too fast to follow in a two person talk
W, H = 1080, 1920
# (take, a_hint, b, caption as said, who)  who: A = Ahiya, N = the teen, AN = both in this segment
CUTS = [
    ("20261005_175830.mp4", -6.94, 10.10, [("A", "אח שלי, אפשר להביא לך 200 שקל?"), ("N", "מה, כאילו...")]),
    ("20261005_175843.mp4", 1.45, 6.90, [("A", "אין בעיה, אני רק רוצה לשאול אותך כמה שאלות לפני זה."),
                                         ("A", "יש לך תוכניות ליום חמישי הקרוב?"), ("N", "לא.")]),
    ("20261005_175909.mp4", 0.45, 10.65, [("A", "בוא נעשה הסכם כזה. אם אני מצליח תוך 60 שניות למצוא לך משהו לעשות עם חברים שלך בחמישי הקרוב,"),
                                          ("A", "המאתיים שקל האלה נשארים אצלי. איך אני איתך?"), ("N", "בוא.")]),
    ("20261005_175929.mp4", 0.10, 9.80, [("A", "בן כמה אתה?"), ("N", "חמש עשרה."), ("A", "כמה בערך חברים אתם תצאו בחמישי?"),
                                         ("N", "ארבעה."), ("A", "אז זה בול בשבילכם.")]),
    ("20261005_175951.mp4", 1.18, 6.55, [("A", "בניתי לכם אפליקציה שיוצרת לכם משחק בסגנון המרוץ למיליון, עם המשימות שאתם בוחרים.")]),
    ("20261005_180013.mp4", 0.00, 6.50, [("A", "מתחלקים לשתי קבוצות, והפלאפון שלך מנווט אותך למיקום ולמשימות על המפה.")]),
    ("20261005_180035.mp4", 0.80, 4.45, [("A", "בכל נקודה נפתחת משימה, וזה לא איזה חידון או משהו כזה.")]),
    ("20261005_180055.mp4", 1.26, 9.10, [("A", "לדוגמה, למכור למישהו רנדומלי שמפו ברחוב ב 10 שקל, או להתחיל עם אטב ולהחליף אותו עם אנשים עד שמקבלים טוש.")]),
    ("20261005_180115.mp4", 4.18, 5.95, [("A", "היית עושה את זה?"), ("N", "כן!")]),
    ("20261005_180132.mp4", 1.20, 6.35, [("A", "הפלאפון סופר את הנקודות לבד, לא צריך להתווכח מי מנצח ומי לא.")]),
    ("20261005_180149.mp4", 0.95, 12.70, [("A", "בניתי משחק כזה בירושלים, ואני יכול גם להביא לך אותו. תחשוב על זה,"),
                                          ("A", "זה לא עוד ערב בפלאפונים, זה ערב שאתם יוצאים החוצה ומשחקים משחק מטורף."),
                                          ("N", "וואי, זה נשמע מטורף.")]),
    ("20261005_180229.mp4", 1.00, 6.85, [("A", "נו, אז מה אתה אומר על התוכנית הזאת?"), ("N", "חד משמעית, היא שווה הרבה יותר מ 200 שקל. היידה.")]),
    ("20261005_180246.mp4", 1.00, 8.40, [("A", "יאללה, אז את ה 200 שקל אני אשמור. תחפש בגוגל RushPoint, ואני אראה לך את המשחק בירושלים."),
                                         ("N", "בסדר, אני עכשיו אחפש את זה.")]),
]
TIMER_FROM = 3       # segment index whose first word starts the minute ("בן כמה אתה?")
TIMER_TO = 11        # segment where the clock stops ("מה אתה אומר על התוכנית הזאת?")


def onset(name: str, hint: float) -> float:
    if hint < 0:                      # an exact, hand measured start (the tail of "המיקרופון" sat before 6.9)
        return -hint
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(SRC / name), "-vn", "-ac", "1", "-ar", "16000",
                          "-af", "highpass=f=150,lowpass=f=1500", "-f", "f32le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    db = 20 * np.log10(np.array([np.sqrt(np.mean(x[i:i + 320] ** 2)) + 1e-9 for i in range(0, len(x) - 320, 320)]))
    floor, peak = np.percentile(db, 10), np.percentile(db, 97)
    thr = max(floor + 18, peak - 26)
    i0 = max(int((hint - 0.25) / 0.02), 0)
    for i in range(i0, min(len(db) - 3, i0 + 60)):
        if db[i] > thr and db[i + 1] > thr and db[i + 2] > thr:
            return max(i * 0.02 - 0.06, 0)
    return hint


def main():
    (RD / "voice").mkdir(exist_ok=True)
    work = RD / "_seg"
    work.mkdir(exist_ok=True)
    segs, caps, t = [], [], 0.0
    timer_start = timer_stop = 0.0
    for k, (name, hint, b, lines) in enumerate(CUTS):
        a = onset(name, hint)
        wav = work / f"s{k:02d}.wav"
        prep_voice(SRC / name, wav, keep=(a, b), noise=None, tempo=TEMPO)
        d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)],
                                 capture_output=True, text=True).stdout)
        d = round(d * 30) / 30            # whole frames, so audio and picture end together
        tight = False
        # tight: 89% of the frame, anchored a little high (their heads sit in the upper third)
        vf = (f"setpts=(PTS-STARTPTS)/{TEMPO},fps=30,{GRADE},"
              + ("crop=iw*0.89:ih*0.89:iw*0.055:ih*0.04,scale=1080:1920:flags=lanczos," if tight else "scale=1080:1920,")
              + "format=yuv420p")
        out = work / f"s{k:02d}.mp4"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", str(SRC / name), "-i", str(wav),
                        "-filter_complex", f"[0:v]{vf}[v];[1:a]apad,atrim=0:{d:.4f}[a]", "-map", "[v]", "-map", "[a]", "-t", f"{d:.4f}",
                        "-c:v", "libx264", "-crf", "15", "-preset", "fast", "-c:a", "pcm_s16le", "-ar", "48000", str(out)], check=True)
        if k == TIMER_FROM:
            timer_start = t + 0.05
        if k == TIMER_TO:
            timer_stop = t + 1.9          # the clock stops as he finishes asking (≈ "...הזאת?")
        # captions: the segment's lines spread by word count over its length
        n = [len(l.split()) for _, l in lines]
        step = d / sum(n)
        tt = t
        for (who, line), m in zip(lines, n):
            c = {"start": round(tt + 0.03, 3), "end": round(tt + m * step - 0.03, 3), "text": line, "style": "sub", "size": 78}
            if who == "N":
                c["color"] = "#FFB300"
            caps.append(c)
            tt += m * step
        segs.append((out, d))
        t += d
    # plain concat, video and audio together (segments are frame exact, so nothing drifts)
    inputs = []
    for p, d in segs:
        inputs += ["-i", str(p)]
    fc = "".join(f"[{i}:v][{i}:a]" for i in range(len(segs))) + f"concat=n={len(segs)}:v=1:a=1[v][a]"
    subprocess.run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
                    "-c:v", "libx264", "-crf", "15", "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le",
                    str(RD / "clips" / "take.mov")], check=True)
    raw = RD / "_seg" / "take_raw.wav"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(RD / "clips" / "take.mov"), "-map", "0:a", "-ac", "1", "-ar", "48000",
                    str(raw)], check=True)
    # the mall: DeepFilterNet in its own venv, capped at 14 dB so a natural bed stays (toolkit gotcha)
    dn = RD / "_seg" / "take_dn.wav"
    subprocess.run([sys.executable, str(Path.home() / ".claude/toolkits/video-editing/tools/denoise_voice.py"), str(raw), str(dn), "11"],
                   check=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(dn), "-af", ("dynaudnorm=f=250:g=11:p=0.9:m=8,"            # quiet words (the shampoo line) come up
                   "equalizer=f=3300:t=q:w=1.2:g=-3.5,equalizer=f=6500:t=q:w=1.4:g=-3,deesser=i=0.45,"  # not harsh
                   "acompressor=threshold=-20dB:ratio=2:attack=8:release=120:makeup=1,"
                   "loudnorm=I=-19:TP=-1.5:LRA=7,aresample=48000"),
                    "-t", f"{sum(d for _, d in segs):.4f}", str(RD / "voice" / "take.wav")], check=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(RD / "clips" / "take.mov"), "-an", "-c:v", "copy",
                    str(RD / "clips" / "take.mp4")], check=True)
    (RD / "clips" / "take.placeholder").unlink(missing_ok=True)
    total = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                  str(RD / "clips" / "take.mp4")], capture_output=True, text=True).stdout)
    joins, acc = [], 0.0
    for p, d in segs[:-1]:
        acc += d
        joins.append(round(acc, 3))
    m = {"timer_start": round(timer_start, 3), "timer_stop": round(timer_stop, 3), "take_end": round(total, 3), "joins": joins,
         "seg_start": [round(sum(d for _, d in segs[:i]), 3) for i in range(len(segs))]}
    (RD / "measured.json").write_text(json.dumps(m, indent=1), encoding="utf-8")
    (RD / "captions.json").write_text(json.dumps(caps, ensure_ascii=False, indent=1), encoding="utf-8")
    print(m, f"timer shows {60 - (timer_stop - timer_start):.0f} s left when it stops")


if __name__ == "__main__":
    main()
