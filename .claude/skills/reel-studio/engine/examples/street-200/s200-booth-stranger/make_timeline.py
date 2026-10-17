# -*- coding: utf-8 -*-
"""The booth: a stranger sells the race for us. Run cuts.py first, then this from engine/, then build.py."""
import sys
from pathlib import Path

RD = Path(__file__).resolve().parent
sys.path.insert(0, str(RD.parent / "street-200"))
import tl_common as T  # noqa: E402

G = RD / "graphics"
M, CAPS = T.load(RD)
shots = T.shots_over_take(M)
hook_end = T.cut_t(M, 1)
heart = T.first(CAPS, "בשביל החוויה")
end = T.cut_t(M, 6)
ovs = [
    {"png": T.question(G, "q", "הוא לא עובד אצלנו.", "הכרנו אותו לפני דקה."), "start": 0.0, "end": hook_end, "kind": "text"},
    {"png": T.pill(G, "hired", "התקבל לעבודה", "#16A34A"), "start": round(end + 0.6, 3), "end": round(M["take_end"], 3), "kind": "text"},
]
sfx = [{"at": heart["start"], "file": "sfx/ding.wav", "gain": -8}, {"at": round(end + 0.6, 3), "file": "sfx/register.wav", "gain": -6}]
music = {"style": "dembow", "bpm": 96, "gain": -11, "seed": 20261020,
         "energy": [[0, 2], [hook_end, 1], [heart["start"], 2], [end, 2]], "accents": [0.0, round(end + 0.6, 3)]}
T.write(RD, "s200-booth-stranger", "הוא לא עובד אצלנו · העמדה בשוק", shots, T.captions(CAPS), ovs, sfx, music,
        ["the 13..25 s stretch is unintelligible and left out"])
