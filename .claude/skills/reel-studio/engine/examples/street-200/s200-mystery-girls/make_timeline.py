# -*- coding: utf-8 -*-
"""Mystery 2 (the girls from Beit Rimon). Two broken takes as a cold open, then the real one."""
import sys
from pathlib import Path

RD = Path(__file__).resolve().parent
sys.path.insert(0, str(RD.parent / "street-200"))
import tl_common as T  # noqa: E402

G = RD / "graphics"
M, CAPS = T.load(RD)
st = [T.cut_t(M, k) for k in range(8)]
shots = T.shots_over_take(M)
choice = T.first(CAPS, "הפתעה סודית", "P")
thousand = T.first(CAPS, "תקבלו 1,000", "A")
pick = T.first(CAPS, "1,000", "P")
ovs = [
    {"png": T.pill(G, "try1", "ניסיון 1", "#57534E"), "start": 0.0, "end": round(st[1], 3), "kind": "text"},
    {"png": T.pill(G, "try2", "ניסיון 2", "#57534E"), "start": round(st[1], 3), "end": round(st[2], 3), "kind": "text"},
    {"png": T.pill(G, "try3", "ניסיון 3"), "start": round(st[2], 3), "end": round(st[2] + 1.4, 3), "kind": "text"},
    {"png": T.question(G, "q", "200 שקל עכשיו", "או הפתעה סודית?"), "start": round(st[2] + 1.4, 3), "end": choice["start"], "kind": "text"},
    {"png": T.pill(G, "chose", "בחרו: הפתעה סודית"), "start": choice["start"], "end": round(st[4], 3), "kind": "text"},
    {"png": T.big(G, "k1000", "1,000 ₪"), "start": round(thousand["end"] - 1.0, 3), "end": round(thousand["end"] + 0.9, 3), "kind": "text"},
    {"png": T.pill(G, "pick", "בחרו: 1,000 ₪", "#16A34A"), "start": pick["start"], "end": round(M["take_end"], 3), "kind": "text"},
]
sfx = [{"at": round(st[1], 3), "file": "sfx/whoosh.wav", "gain": -9}, {"at": round(st[2], 3), "file": "sfx/whoosh.wav", "gain": -9},
       {"at": choice["start"], "file": "sfx/ding.wav", "gain": -6},
       {"at": round(thousand["end"] - 1.0, 3), "file": "sfx/register.wav", "gain": -8},
       {"at": pick["start"], "file": "sfx/ding.wav", "gain": -6}]
music = {"style": "marimba", "bpm": 104, "gain": -11, "seed": 20261018,
         "energy": [[0, 1], [st[2], 2], [st[4], 1], [pick["start"] - 1.0, 3]], "accents": [0.0, round(st[2], 3)]}
T.write(RD, "s200-mystery-girls", "הפתעה סודית · הבנות מבית רימון", shots, T.captions(CAPS), ovs, sfx, music, [])
