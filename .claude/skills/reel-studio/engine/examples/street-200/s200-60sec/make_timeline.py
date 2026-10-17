# -*- coding: utf-8 -*-
"""The 60 second pitch. The countdown starts as he finishes "60 שניות" and its 0 lands EXACTLY as he
finishes "את זה או 200 שקל עכשיו?" (Ahiya 2026-10-16: "שיפול בול על 60 שניות"; speech is never slowed,
the 60 timer seconds are spread over the real span, faster than real time if the span is shorter)."""
import sys
from pathlib import Path

RD = Path(__file__).resolve().parent
sys.path.insert(0, str(RD.parent / "street-200"))
import tl_common as T  # noqa: E402
import cuts as C  # noqa: E402

G = RD / "graphics"
M, CAPS = T.load(RD)
st = M["seg_start"]
TEMPO = 1.03


from street import src_to_t  # noqa: E402


def at(seg: int, src_t: float) -> float:
    """Source second -> timeline second (seg kept for reading; the lookup is by source time)."""
    return src_to_t(M, src_t)


t0 = round(at(1, 10.84), 3)       # end of "שניות"
t1 = round(at(8, 59.86), 3)       # end of "עכשיו?"
shots = T.shots_over_take(M)
thousand = T.first(CAPS, "מקבלים 1,000", "A")
step = (t1 - t0) / 60
ovs = [{"png": T.question(G, "q", "רוצים 200 שקל?", "תקשיבו לי 60 שניות"), "start": 0.0, "end": t0, "kind": "text"}]
sfx = []
for k in range(60):
    s = t0 + k * step
    ovs.append({"png": T.timer_png(G, 60 - k), "start": round(s, 3), "end": round(s + step, 3), "kind": "text"})
    sfx.append({"at": round(s, 3), "file": "sfx/tick.wav", "gain": -10 if 60 - k > 10 else -5})
ovs.append({"png": T.timer_png(G, 0), "start": t1, "end": round(t1 + 1.6, 3), "kind": "text"})
sfx.append({"at": t1, "file": "sfx/ding.wav", "gain": -3})
ovs.append({"png": T.big(G, "k1000", "1,000 ₪"), "start": round(thousand["end"] - 1.0, 3),
            "end": round(thousand["end"] + 0.8, 3), "kind": "text"})
sfx.append({"at": round(thousand["end"] - 1.0, 3), "file": "sfx/register.wav", "gain": -8})
pick = T.first(CAPS, "הסטארט אפ", "P")
ovs.append({"png": T.pill(G, "pick", "בחרו: המרוץ", "#16A34A"), "start": round(t1 + 1.6, 3), "end": round(M["take_end"], 3), "kind": "text"})
music = {"style": "afro", "bpm": 104, "gain": -11, "seed": 20261019,
         "energy": [[0, 2], [t0, 1], [at(5, 33.5), 2], [t1, 3]], "accents": [0.0, t1]}
T.write(RD, "s200-60sec", "תקשיבו לי 60 שניות", shots, T.captions(CAPS), ovs, sfx, music,
        [f"timer: 60 over {t1 - t0:.1f} real seconds ({60 / (t1 - t0):.2f}x)"])
print(f"timer {t0:.2f} -> {t1:.2f}: 60 ticks over {t1 - t0:.1f}s")
