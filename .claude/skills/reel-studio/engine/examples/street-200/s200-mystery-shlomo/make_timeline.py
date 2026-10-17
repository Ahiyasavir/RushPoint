# -*- coding: utf-8 -*-
"""Mystery 1 (Shlomo, Aharon, Yeshaya). Run cuts.py first, then this from engine/, then build.py."""
import sys
from pathlib import Path

RD = Path(__file__).resolve().parent
sys.path.insert(0, str(RD.parent / "street-200"))
import tl_common as T  # noqa: E402

G = RD / "graphics"
M, CAPS = T.load(RD)
shots = T.shots_over_take(M)
choice = T.first(CAPS, "הפתעה סודית", "P")
pitch_start = T.cut_t(M, 2)
thousand = T.first(CAPS, "1,000", "A")
pick = T.first(CAPS, "1,000", "P")
ovs = [
    {"png": T.question(G, "q", "200 שקל עכשיו", "או הפתעה סודית?"), "start": 0.0, "end": choice["start"], "kind": "text"},
    {"png": T.pill(G, "chose", "בחרו: הפתעה סודית"), "start": choice["start"], "end": round(pitch_start, 3), "kind": "text"},
    {"png": T.big(G, "k1000", "1,000 ₪"), "start": round(thousand["end"] - 1.0, 3), "end": round(thousand["end"] + 0.9, 3), "kind": "text"},
    {"png": T.pill(G, "pick", "בחרו: 1,000 ₪", "#16A34A"), "start": pick["start"], "end": round(M["take_end"], 3), "kind": "text"},
]
sfx = [{"at": choice["start"], "file": "sfx/ding.wav", "gain": -6},
       {"at": round(thousand["end"] - 1.0, 3), "file": "sfx/register.wav", "gain": -8},
       {"at": pick["start"], "file": "sfx/ding.wav", "gain": -6}]
music = {"style": "detective", "bpm": 112, "gain": -11, "seed": 20261017,
         "energy": [[0, 2], [pitch_start, 1], [pick["start"] - 1.0, 3]], "accents": [0.0, choice["start"]]}
T.write(RD, "s200-mystery-shlomo", "הפתעה סודית · שלמה, אהרן וישעיה", shots, T.captions(CAPS), ovs, sfx, music,
        ["the date was cut out of the pitch (rule 36)"])
