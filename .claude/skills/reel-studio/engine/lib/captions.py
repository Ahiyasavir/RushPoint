# -*- coding: utf-8 -*-
"""Word by word Hebrew captions → one .ass file for ffmpeg/libass.

Input entries (timeline "captions"):
    {"start": 1.0, "end": 2.6, "text": "שתים עשרה קפיצות", "style": "big"}
    {"start": 3.0, "end": 5.0, "words": [["ההוצאה", 3.0, 3.4], ["הבאה", 3.4, 4.1]]}

`words` (e.g. from faster-whisper word timestamps) wins over `text`. Without it, the span
is split across the words in proportion to their length, which is close enough for a
caption that is read, not lip synced.

A group of up to N words is on screen at once; the word being said is #FFB300 and the
rest are white. Each group is one ASS event per word, so the colour moves word to word.

RTL: measured here, libass does NOT run bidi across override tags. Every {\\c} colour tag
starts a new run, each run is laid out on its own, and the runs are then placed left to
right, so a coloured Hebrew line came out with its WORDS in English order and "הבאה:"
drawn as ":הבאה". Wrapping the line in RLE…PDF (gotcha #9) does not survive the tags.
So the engine does the reordering itself, the way a PIL render does: python-bidi gives
each word's visual form, the words are placed in right to left order, and every run is
locked with LRO…PDF so libass draws exactly what it is given. Hebrew has no contextual
shaping, so pre-ordered glyphs are pixel identical to a correct bidi render.
"""
from __future__ import annotations

import re
from pathlib import Path

from .common import CFG, H, W, font_name, hex_to_ass, is_todo

from bidi.algorithm import get_display  # noqa: E402

LRO, PDF = "\u202D", "\u202C"
HEB = re.compile(r"[\u0590-\u05FF]")
LATIN = re.compile(r"[A-Za-z]")
DASHES = "-\u2010\u2011\u2012\u2013\u2014\u2015\u05BE"   # incl. the Hebrew maqaf


def _fmt(t: float) -> str:
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _esc(word: str) -> str:
    return word.replace("\\", "\\\\").replace("{", "(").replace("}", ")")


def split_words(entry: dict) -> list[tuple[str, float, float]]:
    if entry.get("words"):
        return [(w, float(s), float(e)) for w, s, e in entry["words"]]
    words = entry["text"].split()
    s0, s1 = float(entry["start"]), float(entry["end"])
    weights = [len(w) + 2 for w in words]           # +2: short words still get a beat
    total, t, out = sum(weights), s0, []
    for w, k in zip(words, weights):
        d = (s1 - s0) * k / total
        out.append((w, t, t + d))
        t += d
    return out


def visual_order(words: list[str]) -> list[tuple[int, str]]:
    """Logical words → [(logical index, visual text)] from LEFT to RIGHT on screen.

    Paragraph base is RTL, so words run right to left, except a run of consecutive
    Latin words (an English phrase), which keeps its own left to right order inside
    the reversed sequence. A number is a single word, so it never needs this.
    """
    runs, cur = [], []
    for i, w in enumerate(words):
        latin = bool(LATIN.search(w)) and not HEB.search(w)
        if latin and cur and cur[-1][2]:
            cur.append((i, w, True))
        else:
            if cur:
                runs.append(cur)
            cur = [(i, w, latin)]
    if cur:
        runs.append(cur)
    out = []
    for run in reversed(runs):
        for i, w, _ in run:
            out.append((i, get_display(w, base_dir="R")))
    return out


_MEASURE = {}
EM_RATIO = 0.86


def _measure_font(size: int):
    """PIL font matching the caption face, to decide line breaks ourselves.

    libass must never wrap: the words reach it in VISUAL (left to right) order, so its
    wrap puts the END of a Hebrew sentence on the TOP line (seen on the first render).
    """
    from PIL import ImageFont
    key = size
    if key not in _MEASURE:
        cap = CFG["captions"].get("font")
        cands = {"Arial": ["C:/Windows/Fonts/arialbd.ttf",
                           "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"]}.get(cap or "", [])
        path = next((p for p in cands if Path(p).exists()), None)
        if path is None:
            from .common import font_file
            f = CFG["fonts"]
            path = str(font_file(f["display"], f["display_weight"]))
        # ASS s is not a pixel em; ~0.72 matches the libass render (test_captions.py)
        _MEASURE[key] = ImageFont.truetype(path, max(int(size * EM_RATIO), 8))
    return _MEASURE[key]


def _wrap_logical(group, size: int, max_w: int):
    """Split a word group into lines in LOGICAL order → [(first index, words), ...]."""
    font = _measure_font(size)
    space = font.getlength(" ")
    pad = 2 * int(CFG["captions"].get("outline_px", 8))
    rows, cur, cur_w, start = [], [], float(pad), 0
    for k, item in enumerate(group):
        w = font.getlength(item[0])
        add = w if not cur else space + w
        if cur and cur_w + add > max_w:
            rows.append((start, cur))
            cur, cur_w, start = [item], w + pad, k
        else:
            cur.append(item)
            cur_w += add
    if cur:
        rows.append((start, cur))
    return rows


def groups(words, n: int):
    for i in range(0, len(words), n):
        yield words[i:i + n]


def dash_problems(entries: list[dict]) -> list[str]:
    """Ahiya's absolute rule: no hyphens or dashes anywhere, the maqaf included."""
    bad = []
    for e in entries:
        text = e.get("text") or " ".join(w for w, *_ in e.get("words", []))
        if any(c in text for c in DASHES):
            bad.append(f"{e.get('start')}s: «{text}»")
    return bad


def build_ass(entries: list[dict], out: Path) -> Path:
    c = CFG["captions"]
    f = CFG["fonts"]
    active = hex_to_ass(c["active_color"])
    idle = hex_to_ass(c["idle_color"])
    todo = hex_to_ass(CFG["colors"]["fire"])
    outline = hex_to_ass(c["outline_color"])
    # Hebrew captions: the brand fonts carry no Hebrew glyphs, so name the fallback
    # outright (config captions.font) instead of letting fontconfig pick one.
    disp = c.get("font") or font_name(f["display"], f["display_weight"])
    body = c.get("font") or font_name(f["body"], f["body_weight"])
    bold = -1 if c.get("bold") else 0
    olw = int(c.get("outline_px", 8))

    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: sub,{body},{c['sub_size']},{idle},{idle},{outline},&H80000000,{bold},0,0,0,100,100,0,0,1,{max(olw - 3, 4)},0,5,90,90,0,177
Style: big,{disp},{c['big_size']},{idle},{idle},{outline},&H80000000,{bold},0,0,0,100,100,0,0,1,{olw},0,5,70,70,0,177
Style: box,{disp},{c['big_size']},{idle},{idle},&H261C1917,&H00000000,{bold},0,0,0,100,100,0,0,3,22,0,5,70,70,0,177

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    for e in entries:
        style = e.get("style", "sub")
        y = e.get("y", c["big_center_y"] if style == "big" else c["sub_center_y"])
        fs = f"\\fs{int(e['size'])}" if e.get("size") else ""
        n = int(e.get("max_words", c["max_words_per_group"]))
        size = int(e.get("size") or (c["big_size"] if style in ("big", "box") else c["sub_size"]))
        # centred in the platform safe column (x 60..960), never under the like/comment column
        max_w = int(e.get("max_width", c.get("max_width", W - 140)))
        placeholder = is_todo(e.get("text", ""))
        words = split_words(e)
        for g in groups(words, n):
            for i, (_, ws, we) in enumerate(g):
                end = g[i + 1][1] if i + 1 < len(g) else we   # no flicker between words
                rows = []
                for chunk in _wrap_logical(g, size, max_w):
                    parts = []
                    for jj, vis in visual_order([w for w, *_r in chunk[1]]):
                        j = chunk[0] + jj               # index inside the group
                        if e.get("color"):      # on screen title, one colour, no word highlight
                            col = hex_to_ass(e["color"])
                        elif e.get("accent_words"):  # only the named words wear amber
                            col = active if g[j][0] in e["accent_words"] else idle
                        else:
                            col = idle if placeholder else (active if j == i else idle)
                        # a TODO caption keeps the right timing but wears a fire outline, so it
                        # can never be mistaken for finished copy on any placeholder colour
                        ol = f"\\3c{todo}" if placeholder else ""
                        parts.append(f"{{\\c{col}{ol}}}{LRO}{_esc(vis)}{PDF}")
                    rows.append(" ".join(parts))
                text = f"{{\\an5\\pos({int(e.get('x', c.get('center_x', W // 2)))},{y}){fs}}}" + "\\N".join(rows)
                lines.append(f"Dialogue: 0,{_fmt(ws)},{_fmt(end)},{style},,0,0,0,,{text}")
    out.write_text(head + "\n".join(lines) + "\n", encoding="utf-8-sig")
    return out


def caption_boxes(entries: list[dict]) -> list[tuple[str, int, int]]:
    """Approximate vertical extent of every caption line, for the safe zone check."""
    c = CFG["captions"]
    boxes = []
    for e in entries:
        style = e.get("style", "sub")
        size = int(e.get("size") or (c["big_size"] if style == "big" else c["sub_size"]))
        y = e.get("y", c["big_center_y"] if style == "big" else c["sub_center_y"])
        # a group can wrap to two lines on a long word run
        boxes.append((f"{e.get('start')}s {style}", int(y - size * 1.2), int(y + size * 1.2)))
    return boxes
