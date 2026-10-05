# -*- coding: utf-8 -*-
"""Every on screen graphic, as HTML rendered to a 1080x1920 PNG.

Each function returns a PNG path inside <reel>/graphics/. A page is re-rendered only
when its HTML changed (a .hash file sits beside each PNG), so a build after editing one
receipt line re-renders one image, not forty.

`expand(tl, rdir)` turns a timeline's data sections (receipt, proofs, collage, punchline,
lower_third, riddles) into concrete overlays and SFX, and resolves "@name" references
in shots/overlays to rendered PNGs. build.py only ever sees plain overlays.
"""
from __future__ import annotations

import hashlib
import html as h
from pathlib import Path

from .common import CFG, H, ROOT, W, is_todo
from .html_render import page, render

C = CFG["colors"]
F = CFG["fonts"]
SAFE_T, SAFE_B = CFG["safe_zone"]["top"], CFG["safe_zone"]["bottom"]
HEB = F.get("hebrew_fallback", "Arial")
LOGO = (ROOT / CFG["paths"].get("logo", "../../../../apps/play-web/public/icon.svg")).resolve()

BASE_CSS = f"""
:root{{--fire:{C['fire']};--amber:{C['amber']};--plasma:{C['plasma']};--green:{C['green']};
--dark:{C['dark']};--bone:{C['bone']};}}
body{{font-family:'{F['body']}','{HEB}';font-weight:700;color:#fff;}}
.disp{{font-family:'{F['display']}','{HEB}';font-weight:{F['display_weight']};}}
.mono{{font-family:'{F['mono']}','{HEB}';font-weight:{F['mono_weight']};direction:ltr;unicode-bidi:isolate;}}
.todo{{color:var(--fire)!important;outline:4px dashed var(--fire);outline-offset:6px;}}
"""


def esc(s) -> str:
    return h.escape(str(s))


def t(s, cls: str = "") -> str:
    """Text span that shouts when it is still a TODO."""
    c = f"{cls} todo" if is_todo(s) else cls
    return f'<span class="{c.strip()}">{esc(s)}</span>'


def _out(rdir: Path, name: str, html: str, w: int = W, hh: int = H) -> Path:
    out = rdir / "graphics" / f"{name}.png"
    sig = hashlib.sha1(html.encode("utf-8")).hexdigest()
    stamp = out.with_suffix(".hash")
    if out.exists() and stamp.exists() and stamp.read_text() == sig:
        return out
    render(html, out, w, hh)
    stamp.write_text(sig)
    return out


def _img_src(rdir: Path, rel: str) -> str | None:
    p = rdir / rel
    return p.resolve().as_uri() if p.exists() else None


# ── reel 2 · the receipt ─────────────────────────────────────────────────────
def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _is_heb(v) -> bool:
    return any("֐" <= ch <= "׿" for ch in str(v))


def receipt(rdir: Path, rc: dict, upto: int, mode: str = "rows", slide: float = 1.0, stamp: float = 0.0) -> Path:
    """The reel 2 receipt, as a real thermal paper slip (Ahiya: the plain card was too
    easy to ignore): store header, dashed rules, a torn bottom edge, a slight tilt.

    upto  = how many ROWS are printed (approved, kind "row" only)
    mode  = rows · blank (empty slip, the flashing beat) · total (+ the total block)
    slide = 0..1 entry of the newest row; stamp = 0 none, else the red total stamp at
            that scale (1.6 → 1.0 over three frames = it slams down)
    """
    rows_all = [ln for ln in rc["lines"] if ln.get("kind", "row") == "row" and ln.get("approved", True)]
    rows = [] if mode == "blank" else rows_all[:upto]
    html_rows = []
    for i, ln in enumerate(rows):
        newest = mode == "rows" and i == len(rows) - 1
        st = ""
        if newest and slide < 1:
            st = f' style="opacity:{slide:.2f};transform:translateY({-26 * (1 - slide):.1f}px)"'
        acc = " fire" if ln.get("accent") == "fire" else ""
        vcls = "val" if _is_heb(ln["value"]) else "val mono"
        html_rows.append(f'''<div class="row{acc}{' new' if newest else ''}"{st}>
          <span class="lbl">{t(ln['label'])}</span><span class="{vcls}">{t(ln['value'])}</span></div>''')
    if mode == "blank":
        html_rows = ['<div class="row ghost"></div>'] * 4
    foot = ""
    tot = next((ln for ln in rc["lines"] if ln.get("kind") == "total"), None)
    if mode == "total" and tot:
        foot = f'''<div class="tot"><span class="lbl">{t(tot['label'])}</span>
          <span class="val">{t(tot['value'])}</span></div>'''
    stamp_html = ""
    if stamp and tot:
        stamp_html = (f'<div class="stamp" style="transform:translate(-50%,-50%) rotate(-12deg) scale({stamp:.2f});'
                      f'opacity:{min(1.0, 2.2 - stamp):.2f}"><div class="s1">סה״כ</div>'
                      + "".join(f'<div class="s2">{t(part.strip())}</div>' for part in str(tot["value"]).split("+"))
                      + '</div>')
    b = rc["box"]
    zig = ",".join(f"{100 - i * 4}% {'100%' if i % 2 == 0 else 'calc(100% - 16px)'}" for i in range(26))
    css = BASE_CSS + f"""
    .wrap{{position:absolute;left:{b['x']}px;top:{b['y']}px;width:{b['w']}px;transform:rotate(-1.6deg);
      filter:drop-shadow(0 22px 34px rgba(0,0,0,.45));}}
    .card{{background:#FBF7EE;color:#1C1917;padding:22px 26px 44px;clip-path:polygon(0 0,100% 0,{zig});
      background-image:repeating-linear-gradient(0deg,#00000006 0 2px,transparent 2px 5px);}}
    .hd{{text-align:center;border-bottom:3px dashed #1C191766;padding-bottom:12px;margin-bottom:8px;}}
    .hd .brand{{font-family:'{F['latin_display']}';font-weight:700;font-size:{int(rc.get('font', 31) * 1.35)}px;direction:ltr;letter-spacing:2px;}}
    .hd .sub{{font-family:'{F['mono']}','{HEB}';font-size:22px;opacity:.65;margin-top:2px;}}
    .row{{display:flex;justify-content:space-between;align-items:baseline;gap:14px;font-size:{rc.get('font', 31)}px;line-height:1.2;
      padding:7px 6px;border-bottom:2px dashed #1C191722;}}
    .row.new{{background:#FFB30055;}}
    .row.fire{{color:#C2410C;}}
    .row.ghost{{height:46px;}}
    .val{{white-space:nowrap;}} .val.mono{{font-family:'{F['mono']}','{HEB}';font-size:{rc.get('font', 31) - 1}px;}}
    .tot{{margin-top:12px;border-top:4px double #1C1917;padding-top:12px;display:flex;flex-direction:column;gap:4px;
      font-size:{rc.get('font', 31)}px;}} .tot .val{{font-size:{int(rc.get('font', 31) * 1.35)}px;color:#C2410C;}}
    .stamp{{position:absolute;left:{min(b['x'] + b['w'] // 2, W - 250)}px;top:{b['y'] + 560}px;border:9px solid #E11D48;color:#E11D48;
      border-radius:18px;padding:10px 30px 16px;text-align:center;background:rgba(251,247,238,.55);}}
    .stamp .s1{{font-size:40px;}} .stamp .s2{{font-size:54px;white-space:nowrap;line-height:1.05;}}
    """
    body = f'''<div class="wrap"><div class="card"><div class="hd"><div class="brand">RUSHPOINT</div>
      <div class="sub">קבלה 0001 · 01.10.26</div></div>{''.join(html_rows)}{foot}</div></div>{stamp_html}'''
    name = f"receipt_{mode}_{upto:02d}_{int(round(slide * 100)):03d}" + (f"_st{int(stamp * 100)}" if stamp else "")
    return _out(rdir, name, page(body, css, W, H))


def receipt_callout(rdir: Path, ln: dict, y: int = 1120) -> Path:
    """The landing's line, BIG and centred for under a second (Ahiya: the receipt alone
    was too easy to miss). The amount is the hero; the label sits under it."""
    fire = ln.get("accent") == "fire"
    val = ln["value"]
    vcls = "v" if _is_heb(val) else "v mono"
    css = BASE_CSS + f"""
    .c{{position:absolute;left:60px;right:60px;top:{y}px;text-align:center;}}
    .v{{font-size:{150 if len(str(val)) <= 8 else 104}px;line-height:1;color:{C['fire'] if fire else C['amber']};
      font-family:'{F['display']}','{HEB}';font-weight:700;
      text-shadow:0 0 4px #000,0 0 4px #000,0 8px 30px rgba(0,0,0,.85);}}
    .v.mono{{font-family:'{F['mono']}','{HEB}';font-weight:800;}}
    .l{{font-size:64px;margin-top:14px;text-shadow:0 0 4px #000,0 0 4px #000,0 6px 24px rgba(0,0,0,.9);}}
    """
    body = f'<div class="c"><div class="{vcls}">{t(val)}</div><div class="l disp">{t(ln["label"])}</div></div>'
    return _out(rdir, f"callout_{ln['jump']:02d}", page(body, css, W, H))


def stair_labels(rdir: Path, sl: dict, upto: int, fresh: float = 1.0) -> Path:
    """Reel 2 v7 'the staircase IS the receipt' (Ahiya, 2026-10-02): each expense is
    written on the step he lands on, right of his feet, and stays. Steps far up the
    stairs are small in frame, so a label's size follows its y (perspective)."""
    items = sl["items"][:upto]
    y0, y1 = float(sl.get("y_top", 550)), float(sl.get("y_bottom", 1200))
    s0, s1 = float(sl.get("size_top", 34)), float(sl.get("size_bottom", 62))
    html = []
    for i, it in enumerate(items):
        if it.get("kind") == "total":
            continue
        y = float(it["y"])
        k = min(max((y - y0) / max(y1 - y0, 1), 0), 1)
        size = s0 + (s1 - s0) * k
        left = int(it.get("x", 560)) + int(sl.get("gap", 80))
        avail = W - 30 - left
        est = (len(str(it["text"])) + len(str(it.get("amount", ""))) + 2) * 0.56 * size
        if est > avail:                       # a long line shrinks instead of leaving the frame
            size = size * avail / est
        newest = i == len(items) - 1
        cls = "lb new" if newest else "lb"
        fire = " fire" if it.get("accent") == "fire" else ""
        op = "" if not newest or fresh >= 1 else f"opacity:{fresh:.2f};transform:translateX({int(40 * (1 - fresh))}px);"
        amt = f'<span class="am{fire}">{t(it["amount"])}</span>' if it.get("amount") else ""
        html.append(f'<div class="{cls}" style="top:{y - size * 1.25:.0f}px;font-size:{size:.0f}px;'
                    f'left:{left}px;{op}">'
                    f'<span class="in"><span class="tx">{t(it["text"])}</span>{amt}</span></div>')
    tot = next((it for it in sl["items"][:upto] if it.get("kind") == "total"), None)
    if tot and sl.get("_total_only"):
        html = []
    if tot and (sl.get("_total_only") or not sl.get("total_separate")):
        html.append(f'<div class="tot"><div class="t1">{t(tot["text"])}</div><div class="t2">{t(tot["amount"])}</div></div>')
    css = BASE_CSS + f"""
    .lb{{position:absolute;right:30px;display:flex;justify-content:flex-end;align-items:baseline;}}
    .lb .in{{display:inline-flex;align-items:baseline;gap:.4em;padding:.04em .35em .1em;border-radius:10px;
      background:rgba(20,17,15,.42);color:#fff;white-space:nowrap;font-family:'{F['display']}','{HEB}';font-weight:700;
      text-shadow:0 0 3px #000,0 2px 8px rgba(0,0,0,.9);}}
    .lb .am{{color:var(--amber);font-family:'{F['mono']}','{HEB}';font-weight:800;}} .lb .am.fire{{color:#FFB38A;}}
    .lb.new .in{{background:rgba(28,25,23,.85);box-shadow:inset -8px 0 0 var(--amber);}}
    .tot{{position:absolute;left:60px;right:60px;top:{int(sl.get("total_y", 1480))}px;text-align:center;
      background:rgba(28,25,23,.86);border-radius:28px;padding:18px 20px 24px;border:5px solid #E11D48;}}
    .tot .t1{{font-size:52px;color:#fff;}} .tot .t2{{font-size:76px;color:var(--amber);}}
    """
    name = f"stairs_{upto:02d}_{int(fresh * 100):03d}" + ("_tot" if sl.get("_total_only") else "")
    return _out(rdir, name, page("".join(html), css, W, H))


def landing_counter(rdir: Path, n: int, total: int, box: dict) -> Path:
    """'3/12' top left, opposite the receipt."""
    css = BASE_CSS + f"""
    .c{{position:absolute;left:{box.get('counter_x', 44)}px;top:{box['y']}px;background:rgba(28,25,23,.82);color:#fff;
      font-size:56px;padding:8px 26px;border-radius:999px;}} .c b{{color:var(--amber);}}
    """
    body = f'<div class="c mono"><b>{n}</b>/{total}</div>'
    return _out(rdir, f"counter_{n:02d}", page(body, css, W, H))


# ── reel 3 · proofs ──────────────────────────────────────────────────────────
def proof(rdir: Path, p: dict, slide: float = 1.0) -> Path:
    """Reel 3 v2: a big capability number, the sentence, and the proof screenshot as a
    card floating over the shot (the footage stays visible around it)."""
    src = _img_src(rdir, p["image"])
    shot = (f'<img src="{src}">' if src else
            f'<div class="ph"><span class="mono">{esc(p["id"])}</span><br>{esc(p["image"])} חסר</div>')
    css = BASE_CSS + f"""
    .card{{position:absolute;left:{505 - 231}px;width:462px;top:{SAFE_T + 30}px;height:1000px;border-radius:40px;
      background:#000;border:6px solid #2a2a2a;overflow:hidden;box-shadow:0 30px 90px rgba(0,0,0,.6);}}
    .card img{{width:100%;height:100%;object-fit:cover;object-position:top;}}
    .ph{{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
      font-size:40px;color:#78716C;background:#F5F5F4;}} .ph .mono{{font-size:110px;color:var(--fire);}}
    .num{{position:absolute;top:{SAFE_T + 10}px;right:40px;font-size:170px;line-height:1;color:var(--amber);
      text-shadow:0 8px 30px rgba(0,0,0,.6);}}
    .lbl{{position:absolute;top:{SAFE_T + 1030}px;left:40px;right:110px;text-align:center;}}
    .lbl .nb{{display:inline-flex;align-items:center;justify-content:center;width:1.25em;height:1.25em;border-radius:50%;
      background:var(--amber);color:#1C1917;margin-inline-end:.35em;font-family:'{F['mono']}';font-weight:800;
      vertical-align:middle;padding:0;border:none;font-size:1em;}}
    .lbl > span{{display:inline-block;font-size:{80 if len(str(p["label"])) <= 16 else 64 if len(str(p["label"])) <= 24 else 56}px;line-height:1.1;background:rgba(28,25,23,.88);color:#fff;
      padding:14px 34px 20px;border-radius:26px;border-bottom:8px solid var(--amber);}}
    """
    # the capability number lives IN the label, as a big amber disc (Ahiya: a corner
    # number was never noticed)
    num = ""
    badge = f'<span class="nb">{esc(p.get("n", ""))}</span>' if p.get("n") else ""
    # slide < 1: the card rises into place (drawn as a few frames, overlays cannot tween)
    mv = "" if slide >= 1 else (f' style="transform:translateY({int(140 * (1 - slide) ** 2)}px) scale({0.94 + 0.06 * slide:.3f});'
                                f'opacity:{0.25 + 0.75 * slide:.2f}"')
    body = f'{num}<div class="card"{mv}>{shot}</div><div class="lbl disp"><span>{badge}{t(p["label"])}</span></div>'
    name = f"proof_{p['id']}" + ("" if slide >= 1 else f"_s{int(slide * 100):03d}")
    return _out(rdir, name, page(body, css, W, H))


def notification(rdir: Path, nt: dict, slide: float = 1.0) -> Path:
    """A phone notification banner dropping in (reel 3 hook: '04:04 בוקר טוב')."""
    y = SAFE_T + int(20 * slide)        # drops in INSIDE the safe zone (QA measures the pixels)
    css = BASE_CSS + f"""
    .n{{position:absolute;left:46px;right:46px;top:{y}px;background:rgba(245,245,244,.94);color:#1C1917;border-radius:44px;
      padding:30px 36px;display:flex;gap:26px;align-items:center;box-shadow:0 20px 60px rgba(0,0,0,.5);opacity:{min(1, .35 + slide):.2f};}}
    .ic{{width:96px;height:96px;border-radius:24px;background:var(--plasma);display:flex;align-items:center;justify-content:center;flex:none;}}
    .tx{{flex:1;}} .row{{display:flex;justify-content:space-between;align-items:baseline;}}
    .ttl{{font-size:44px;}} .tm{{font-size:36px;color:#78716C;}} .body{{font-size:40px;color:#44403C;margin-top:4px;}}
    """
    icon = ('<svg viewBox="0 0 24 24" width="58" height="58" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" '
            'stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.9A8 8 0 1 1 21 12z"/></svg>')
    body = (f'<div class="n"><div class="ic">{icon}</div><div class="tx"><div class="row"><span class="ttl">{esc(nt.get("title", ""))}</span>'
            f'<span class="tm mono">{esc(nt.get("time", ""))}</span></div><div class="body">{esc(nt.get("body", ""))}</div></div></div>')
    return _out(rdir, f"notify_{int(slide * 100):03d}", page(body, css, W, H))


def collage(rdir: Path, tl: dict) -> Path:
    ids = tl["collage"]["from"]
    by = {p["id"]: p for p in tl["proofs"]}
    tiles = []
    for i, pid in enumerate(ids):
        src = _img_src(rdir, by[pid]["image"])
        inner = f'<img src="{src}">' if src else f'<div class="ph mono">{esc(pid)}</div>'
        rot = [-3, 2, -1.5, 2.5, -2, 1, -2.5, 3, -1][i % 9]
        tiles.append(f'<div class="tile" style="transform:rotate({rot}deg)">{inner}<span class="b mono">{esc(pid)}</span></div>')
    css = BASE_CSS + f"""
    body{{background:radial-gradient(circle at 50% 40%,#2a2522,var(--dark));}}
    .grid{{position:absolute;left:50px;right:50px;top:{SAFE_T + 40}px;bottom:{SAFE_B + 40}px;display:grid;
      grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:26px;}}
    .tile{{position:relative;border-radius:22px;overflow:hidden;border:5px solid var(--amber);background:#000;}}
    .tile img{{width:100%;height:100%;object-fit:cover;}}
    .ph{{height:100%;display:flex;align-items:center;justify-content:center;font-size:80px;color:var(--amber);background:#2b2623;}}
    .b{{position:absolute;bottom:10px;right:10px;background:var(--plasma);color:var(--dark);font-size:30px;padding:2px 14px;border-radius:999px;}}
    """
    return _out(rdir, "collage", page(f'<div class="grid">{"".join(tiles)}</div>', css, W, H, "var(--dark)"))


def punchline(rdir: Path, tl: dict) -> Path:
    pl = tl["punchline"]
    sub = "" if not pl.get("sub") else f'<div class="sub">{t(pl["sub"])}</div>'
    css = BASE_CSS + f"""
    body{{background:var(--dark);}}
    .wrap{{position:absolute;inset:{SAFE_T}px 60px {SAFE_B}px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;}}
    .main{{font-size:150px;line-height:1.05;}} .main::after{{content:'';display:block;height:16px;background:var(--fire);margin:30px auto 0;width:60%;border-radius:8px;}}
    .sub{{margin-top:40px;font-size:52px;color:#ffffffcc;}}
    """
    body = f'<div class="wrap"><div class="main disp">{t(pl["text"])}</div>{sub}</div>'
    return _out(rdir, "punchline", page(body, css, W, H, "var(--dark)"))


# ── grandma · lower third ────────────────────────────────────────────────────
def lower_third(rdir: Path, lt: dict) -> Path:
    css = BASE_CSS + f"""
    .lt{{position:absolute;right:60px;left:160px;bottom:{SAFE_B + 120}px;background:rgba(28,25,23,.86);border-radius:26px;
      padding:26px 34px;border-inline-start:14px solid var(--fire);}}
    .n{{font-size:68px;}} .w{{font-size:42px;color:var(--amber);margin-top:6px;}}
    """
    body = f'<div class="lt"><div class="n disp">{t(lt["name"])}</div><div class="w">{t(lt["why"])}</div></div>'
    return _out(rdir, "lower_third", page(body, css, W, H))


# ── reel 1 · riddles ─────────────────────────────────────────────────────────
def riddle(rdir: Path, i: int, n: int, r: dict, answer: bool) -> Path:
    pct = r["pct_wrong"]
    ans = f"""<div class="ans disp">{t(r['a'])}</div>
      <div class="pct">{t(pct if is_todo(pct) else f'{pct}%', 'mono')} <span>טעו</span></div>""" if answer else ""
    css = BASE_CSS + f"""
    .card{{position:absolute;left:70px;right:70px;top:{SAFE_T + 60}px;background:rgba(28,25,23,.9);border-radius:34px;padding:40px 46px;
      border:5px solid var(--amber);}}
    .k{{font-size:36px;color:var(--plasma);}} .q{{font-size:76px;line-height:1.15;margin-top:12px;}}
    .ans{{margin-top:28px;font-size:110px;color:var(--green);}} .pct{{font-size:56px;color:var(--amber);margin-top:6px;}}
    .pct span{{font-family:'{F['body']}';}}
    """
    body = f'<div class="card"><div class="k mono">{i}/{n}</div><div class="q disp">{t(r["q"])}</div>{ans}</div>'
    return _out(rdir, f"riddle_{i}_{'a' if answer else 'q'}", page(body, css, W, H))


# ── reel 1 · the mock RushPoint quiz (EDIT-SPEC, final version 2026-10-01) ──────
# A built screen, not a recording: there is no real game behind it. The answer is
# NEVER drawn (spec: no answer anywhere in the video). The timer bar is NOT in the PNG;
# build.py slides it per frame (shot "timer") so it needs no image per frame.
APP = {"bg": "#FFFCF7", "card": "#FFFFFF", "raised": "#FFF0E6", "ink": "#1C1917", "mute": "#78716C",
       "alert": "#EF4444", "line": "#E7E5E4"}
QUIZ_TIMER = {"x": 70, "y": 640, "w": 940, "h": 26}


def quiz_screen(rdir: Path, sc: dict) -> Path:
    logo = f'<img class="logo" src="{LOGO.as_uri()}">' if LOGO.exists() else ""
    qcls = "q mono" if sc.get("ltr") else "q"
    tm = QUIZ_TIMER
    css = BASE_CSS + f"""
    body{{background:{APP['bg']};color:{APP['ink']};}}
    .top{{position:absolute;top:{SAFE_T + 10}px;left:70px;right:70px;display:flex;justify-content:space-between;align-items:center;}}
    .brand{{display:flex;align-items:center;gap:16px;direction:ltr;font-family:'{F['latin_display']}';font-weight:700;font-size:44px;}}
    .logo{{width:64px;height:64px;}}
    .chip{{background:{APP['ink']};color:#fff;font-size:44px;padding:6px 26px;border-radius:999px;}}
    .pct{{position:absolute;top:{SAFE_T + 120}px;left:60px;right:60px;text-align:center;line-height:1;}}
    .pct .n{{font-size:190px;color:var(--fire);font-family:'{F['display']}','{HEB}';font-weight:700;direction:ltr;unicode-bidi:isolate;}}
    .pct .w{{font-size:84px;margin-inline-start:20px;}}
    .track{{position:absolute;left:{tm['x']}px;top:{tm['y']}px;width:{tm['w']}px;height:{tm['h']}px;border-radius:13px;background:{APP['line']};}}
    .card{{position:absolute;left:70px;right:130px;top:720px;background:{APP['card']};border-radius:40px;padding:50px 54px 60px;
      box-shadow:0 20px 60px rgba(28,25,23,.12);border:3px solid {APP['raised']};}}
    .k{{font-size:38px;color:{APP['mute']};}}
    .q{{font-size:{sc.get('q_size', 80)}px;line-height:1.18;margin-top:18px;}}
    .q.mono{{text-align:center;font-size:{sc.get('q_size', 92)}px;margin-top:30px;}}
    .ans{{position:absolute;left:70px;right:130px;top:{sc.get('ans_y', 1130)}px;height:130px;border-radius:28px;background:#fff;
      border:4px solid {APP['line']};display:flex;align-items:center;padding:0 40px;font-size:48px;color:#A8A29E;}}
    .ans.ok{{background:var(--green);border-color:var(--green);color:#fff;font-size:72px;gap:26px;justify-content:center;}}
    .ans.ok .a{{font-family:'{F['display']}','{HEB}';font-weight:700;}} .ans.ok .tick{{font-size:70px;}}
    .go.ok{{background:#E7F8F1;color:#047857;}}
    .dots{{position:absolute;top:590px;left:0;right:0;display:flex;justify-content:center;gap:18px;direction:ltr;}}
    .dots .d{{width:26px;height:26px;border-radius:50%;background:{APP['line']};}}
    .dots .d.done{{background:var(--green);}} .dots .d.cur{{background:var(--amber);box-shadow:0 0 0 6px #FFB30044;}}
    .plus{{position:absolute;top:{sc.get('ans_y', 1130) + 152}px;left:70px;right:130px;text-align:center;font-size:60px;color:#047857;
      font-family:'{F['display']}','{HEB}';font-weight:700;}}
    .go{{position:absolute;left:70px;right:130px;top:{sc.get('ans_y', 1130) + 150}px;height:120px;border-radius:28px;background:var(--fire);
      color:#fff;display:flex;align-items:center;justify-content:center;font-size:52px;}}
    """
    if sc.get("reveal"):
        # the answer, revealed (riddles 1 to 4 only; riddle 5's answer is never drawn)
        ans_html = (f'<div class="ans ok"><span class="tick">✓</span><span class="a">{esc(sc["answer"])}</span></div>'
                    f'<div class="go ok">{esc(sc.get("ok_word", "נכון · פתרת? +1"))}</div>')
    else:
        ans_html = f'<div class="ans">{esc(sc.get("placeholder", "התשובה שלך"))}</div><div class="go">שליחה</div>'
    pct = sc.get("pct")
    pct_html = (f'<div class="pct"><span class="n">{esc(pct)}</span><span class="w disp">{esc(sc.get("pct_word", "פותרים"))}</span></div>'
                if pct else "")
    dots = "".join(
        f'<span class="d {"done" if k < sc["n"] or (k == sc["n"] and sc.get("reveal")) else "cur" if k == sc["n"] else ""}"></span>'
        for k in range(1, sc["of"] + 1))
    plus = ""    # "+1" now rides inside the green button (it sat under the IG description)
    body = f"""<div class="top"><div class="chip mono">{sc['n']}/{sc['of']}</div><div class="brand">{logo}RushPoint</div></div>
      <div class="dots">{dots}</div>{plus}
      {pct_html}<div class="track"></div>
      <div class="card"><div class="k">חידה {sc['n']}</div><div class="{qcls}">{esc(sc['q'])}</div></div>
      {ans_html}"""
    return _out(rdir, f"quiz_{sc['n']}{'_ans' if sc.get('reveal') else ''}", page(body, css, W, H, APP["bg"]))


def intro_screen(rdir: Path, sc: dict) -> Path:
    """Reel 1 hook screen: the quiz app's start card with a giant 30 (the voice says it)."""
    logo = f'<img class="logo" src="{LOGO.as_uri()}">' if LOGO.exists() else ""
    css = BASE_CSS + f"""
    body{{background:{APP['bg']};color:{APP['ink']};}}
    .top{{position:absolute;top:{SAFE_T + 10}px;left:70px;right:70px;display:flex;justify-content:space-between;align-items:center;}}
    .brand{{display:flex;align-items:center;gap:16px;direction:ltr;font-family:'{F['latin_display']}';font-weight:700;font-size:44px;}}
    .logo{{width:64px;height:64px;}}
    .chip{{background:var(--fire);color:#fff;font-size:42px;padding:8px 28px;border-radius:999px;}}
    .big{{position:absolute;top:{SAFE_T + 170}px;left:0;right:0;text-align:center;line-height:.9;}}
    .big .n{{font-family:'{F['display']}';font-weight:700;font-size:520px;color:var(--fire);letter-spacing:-20px;direction:ltr;display:block;}}
    .big .u{{font-size:96px;display:block;margin-top:10px;}}
    .ring{{position:absolute;top:{SAFE_T + 130}px;left:50%;width:640px;height:640px;margin-left:-320px;border-radius:50%;
      border:22px solid {APP['raised']};border-top-color:var(--fire);}}
    .hint{{position:absolute;left:70px;right:130px;top:1205px;text-align:center;font-size:52px;color:{APP['mute']};}}
    .go{{position:absolute;left:70px;right:130px;top:1280px;height:126px;border-radius:30px;background:{APP['ink']};
      color:#fff;display:flex;align-items:center;justify-content:center;font-size:56px;}}
    """
    body = f"""<div class="top"><div class="chip">{esc(sc.get('chip', '5 חידות'))}</div><div class="brand">{logo}RushPoint</div></div>
      <div class="ring"></div><div class="big"><span class="n">{esc(sc.get('n', '30'))}</span><span class="u disp">{esc(sc.get('unit', 'שניות'))}</span></div>
      <div class="hint disp">{esc(sc.get('hint', ''))}</div><div class="go">{esc(sc.get('cta', 'התחל'))}</div>"""
    return _out(rdir, "quiz_intro", page(body, css, W, H, APP["bg"]))


def follow_pill(rdir: Path, sc: dict) -> Path:
    """Transparent overlay: a small 'follow' badge (reel 1 CTA), above the bottom safe line."""
    css = BASE_CSS + f"""
    .fol{{position:absolute;left:50%;transform:translateX(-50%);top:{sc.get('y', 1540)}px;display:flex;align-items:center;gap:16px;
      background:rgba(28,25,23,.85);border:4px solid {C['amber']};border-radius:999px;padding:10px 38px 10px 28px;
      color:{C['amber']};font-size:50px;white-space:nowrap;}}
    """
    svg = (f'<svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="{C["amber"]}" stroke-width="2.4" '
           f'stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/>'
           f'<path d="M19 8v6M16 11h6"/></svg>')
    return _out(rdir, "follow_pill", page(f'<div class="fol">{svg}<span>{esc(sc.get("label", "עקוב"))}</span></div>', css, W, H))


def countdown_card(rdir: Path, n: int, label: str = "השאלה האחרונה בעוד", sub: str = "") -> Path:
    """Reel 1: a window counting down to the last riddle WHILE Ahiya talks, so the
    viewer is braced for it (his note, 2026-10-01). n <= 3 grows and turns amber."""
    hot = n <= 3
    css = BASE_CSS + f"""
    .w{{position:absolute;top:{SAFE_T + 60}px;left:90px;right:130px;background:rgba(28,25,23,.9);border-radius:36px;
      border:5px solid {'var(--amber)' if hot else 'rgba(255,255,255,.25)'};padding:26px 40px;display:flex;align-items:center;
      justify-content:space-between;box-shadow:0 20px 60px rgba(0,0,0,.45);}}
    .l{{font-size:58px;line-height:1.1;}} .s{{font-size:40px;color:#D6D3D1;margin-top:8px;}}
    .n{{font-family:'{F['mono']}';font-weight:800;font-size:{190 if hot else 130}px;line-height:1;color:{C['amber'] if hot else '#fff'};
      min-width:150px;text-align:center;}}
    """
    sub_html = f'<div class="s">{esc(sub)}</div>' if sub else ""
    body = f'<div class="w"><div><div class="l disp">{esc(label)}</div>{sub_html}</div><div class="n">{n}</div></div>'
    return _out(rdir, f"countdown_{n:02d}", page(body, css, W, H))


def title_screen(rdir: Path, name: str, sc: dict) -> Path:
    """Dark full screen title. sc = {"lines": [{"text", "size", "color"?, "accent": {"word": "#hex"}}], "icon"?: "follow"}"""
    rows = []
    for ln in sc["lines"]:
        acc = ln.get("accent", {})
        words = []
        for w in str(ln["text"]).split(" "):
            col = next((c for k, c in acc.items() if k in w), None)
            words.append(f'<span style="color:{col}">{esc(w)}</span>' if col else esc(w))
        color = ln.get("color", "#fff")
        rows.append(f'<div class="ln" style="font-size:{ln["size"]}px;color:{color};{ln.get("css", "")}">{" ".join(words)}</div>')
    icon = ""
    if sc.get("icon") == "follow":
        icon = (f'<div class="fol"><svg viewBox="0 0 24 24" width="76" height="76" fill="none" stroke="{C["amber"]}" stroke-width="2.4" '
                f'stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/>'
                f'<path d="M19 8v6M16 11h6"/></svg><span>{esc(sc.get("icon_label", "עקבו"))}</span></div>')
    if sc.get("arrow_to_comments"):
        # points at Instagram's comment button on the right rail (~x 1000, y 1290 on 1080x1920)
        icon += (f'<div class="cm"><span>{esc(sc.get("arrow_label", "כתוב כאן"))}</span>'
                 f'<svg viewBox="0 0 60 40" width="110" height="74"><path d="M2 20h44M34 6l16 14-16 14" fill="none" '
                 f'stroke="{C["amber"]}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg></div>')
    css = BASE_CSS + f"""
    body{{background:{sc.get('bg', C['dark'])};}}
    .cm{{position:fixed;right:150px;top:{int(sc.get('arrow_y', 1250))}px;display:flex;align-items:center;gap:14px;
      direction:ltr;color:{C['amber']};font-size:54px;font-family:'{F['display']}','{HEB}';font-weight:700;}}
    .wrap{{position:absolute;left:70px;right:130px;top:{SAFE_T}px;bottom:{H - 1420}px;display:flex;flex-direction:column;
      justify-content:center;align-items:center;text-align:center;gap:44px;}}
    .ln{{line-height:1.15;font-family:'{F['display']}','{HEB}';font-weight:700;}}
    .fol{{display:flex;align-items:center;gap:18px;border:4px solid {C['amber']};border-radius:999px;padding:12px 40px 12px 30px;
      color:{C['amber']};font-size:52px;}}
    """
    return _out(rdir, f"title_{name}", page(f'<div class="wrap">{"".join(rows)}{icon}</div>', css, W, H, sc.get("bg", C["dark"])))


# ── covers ───────────────────────────────────────────────────────────────────
def cover(rdir: Path, tl: dict, variant: str, frame: Path | None, out: Path) -> Path:
    head = tl.get("cover", {}).get("headline", {}).get(variant, "TODO")
    bg = f"url('{frame.resolve().as_uri()}') center/cover" if frame and frame.exists() else \
        f"radial-gradient(circle at 30% 30%,{C['fire']},{C['dark']} 70%)"
    logo = f'<img class="logo" src="{LOGO.as_uri()}">' if LOGO.exists() else ""
    # Instagram's profile grid crops a 9:16 cover to the centre 4:5 (1080x1350): the
    # headline lives inside y 285..1635 so it survives the crop.
    css = BASE_CSS + f"""
    body{{background:{bg};}}
    .shade{{position:absolute;inset:0;background:linear-gradient(180deg,rgba(28,25,23,.15) 0%,rgba(28,25,23,.25) 40%,rgba(28,25,23,.85) 100%);}}
    .hl{{position:absolute;left:70px;right:70px;top:820px;text-align:center;font-size:132px;line-height:1.02;
      text-shadow:0 6px 30px rgba(0,0,0,.7);}}
    .hl::after{{content:'';display:block;width:180px;height:14px;border-radius:7px;background:var(--amber);margin:34px auto 0;}}
    .logo{{position:absolute;width:110px;height:110px;left:50%;transform:translateX(-50%);top:1480px;}}
    .v{{position:absolute;top:{SAFE_T + 20}px;left:70px;font-size:28px;color:#ffffff88;}}
    """
    body = f'<div class="shade"></div><div class="hl disp">{t(head)}</div>{logo}<div class="v mono">{esc(tl["id"])} · {variant}</div>'
    html = page(body, css, W, H)
    render(html, out, W, H)
    return out


# ── expansion ────────────────────────────────────────────────────────────────
def expand(tl: dict, rdir: Path) -> dict:
    """Return a copy of tl with data sections turned into overlays/sfx and @refs resolved."""
    import copy
    tl = copy.deepcopy(tl)
    refs: dict[str, Path] = {}
    ov, sfx = list(tl.get("overlays", [])), list(tl.get("sfx", []))

    if "receipt" in tl:
        rc = tl["receipt"]
        lands = [float(x) for x in rc["landings"]]
        n_land = len(lands)
        end_all = max(float(s["end"]) for s in tl["shots"])
        printed = 0
        # each landing owns [at, next landing); the last owns up to total_end
        for j, ln in enumerate(rc["lines"]):
            at = lands[j]
            nxt = lands[j + 1] if j + 1 < n_land else float(rc.get("total_end", end_all))
            ov.append({"png": str(landing_counter(rdir, j + 1, n_land, rc["box"])), "start": at, "end": nxt, "kind": "text"})
            if rc.get("land_sfx", True):
                sfx.append({"at": at, "file": "sfx/land.wav"})
            kind = ln.get("kind", "row")
            if kind == "blank":
                # the receipt empties and blinks; the register falls silent
                step, k, t0 = 0.125, 0, at
                while t0 < nxt - 1e-3:
                    if k % 2 == 0:
                        ov.append({"png": str(receipt(rdir, rc, 0, "blank")), "start": t0,
                                   "end": min(t0 + step, nxt), "kind": "text"})
                    t0, k = t0 + step, k + 1
                if rc.get("land_sfx", True):
                    sfx.append({"at": at + 0.02, "file": "sfx/hit.wav", "gain": -4})
                continue
            if kind == "total":
                ov.append({"png": str(receipt(rdir, rc, printed, "total")), "start": at, "end": at + 0.10, "kind": "text"})
                for kk, sc in enumerate((1.6, 1.25, 1.06)):
                    ov.append({"png": str(receipt(rdir, rc, printed, "total", stamp=sc)), "start": at + 0.10 + kk * 0.04,
                               "end": at + 0.14 + kk * 0.04, "kind": "text"})
                ov.append({"png": str(receipt(rdir, rc, printed, "total", stamp=1.0)), "start": at + 0.22, "end": nxt, "kind": "text"})
                refs["@receipt_stamped"] = receipt(rdir, rc, printed, "total", stamp=1.0)
                sfx.append({"at": at + 0.03, "file": "sfx/close.wav", "gain": float(rc.get("close_gain", -2))})
                continue
            if not ln.get("approved", True):
                # unapproved line: the jump happens, the receipt does not grow
                if printed:
                    ov.append({"png": str(receipt(rdir, rc, printed)), "start": at, "end": nxt, "kind": "text"})
                continue
            printed += 1
            sfx.append({"at": at + 0.03, "file": "sfx/register.wav", "gain": float(rc.get("register_gain", -3))})
            sfx.append({"at": at + 0.02, "file": "sfx/print.wav", "gain": -6})
            for f, (a0, a1) in zip((0.33, 0.66), ((0.0, 0.05), (0.05, 0.10))):
                ov.append({"png": str(receipt(rdir, rc, printed, "rows", f)), "start": at + a0, "end": at + a1, "kind": "text"})
            ov.append({"png": str(receipt(rdir, rc, printed)), "start": at + 0.10, "end": nxt, "kind": "text"})
            if rc.get("callouts"):
                ov.append({"png": str(receipt_callout(rdir, ln, int(rc.get("callout_y", 1120)))), "start": at,
                           "end": min(at + float(rc.get("callout_s", 0.95)), nxt), "kind": "text"})
        refs["@receipt_full"] = receipt(rdir, rc, printed, "total")
        refs["@receipt_blank"] = receipt(rdir, rc, 0, "blank")

    if "stair_labels" in tl:
        sl = tl["stair_labels"]
        lands = [float(x) for x in sl["landings"]]
        end_all = max(float(s["end"]) for s in tl["shots"])
        for j, it in enumerate(sl["items"]):
            at = lands[j]
            nxt = lands[j + 1] if j + 1 < len(lands) else end_all
            ov.append({"png": str(landing_counter(rdir, j + 1, len(lands), {"y": 235, "counter_x": 40})),
                       "start": at, "end": nxt, "kind": "text"})
            if it.get("kind") == "blank":
                if j:
                    ov.append({"png": str(stair_labels(rdir, sl, j)), "start": at, "end": nxt, "kind": "text",
                               "occlude": True})
                continue
            for kk, f in enumerate((0.4, 0.75)):
                ov.append({"png": str(stair_labels(rdir, sl, j + 1, f)), "start": at + kk * 0.05,
                           "end": at + (kk + 1) * 0.05, "kind": "text", "occlude": True})
            ov.append({"png": str(stair_labels(rdir, sl, j + 1)), "start": at + 0.10, "end": nxt, "kind": "text",
                       "occlude": True})
            sfx.append({"at": at + 0.02, "file": "sfx/print.wav", "gain": -9})
            if it.get("kind") == "total":
                sfx.append({"at": at + 0.03, "file": "sfx/close.wav", "gain": -8})
                if sl.get("total_separate"):
                    ov.append({"png": str(stair_labels(rdir, dict(sl, _total_only=True), j + 1)), "start": at,
                               "end": end_all, "kind": "text"})
        refs["@stairs_full"] = stair_labels(rdir, sl, len(sl["items"]))

    if "proofs" in tl:
        for p in tl["proofs"]:
            a0 = float(p["start"])
            for k, f in enumerate((0.35, 0.65, 0.88)):
                ov.append({"png": str(proof(rdir, p, f)), "start": a0 + k * 0.045, "end": a0 + (k + 1) * 0.045, "kind": "text"})
            ov.append({"png": str(proof(rdir, p)), "start": a0 + 0.135, "end": p["end"], "kind": "text"})
        if "collage" in tl:
            refs["@collage"] = collage(rdir, tl)
    if "notify" in tl:
        nt = tl["notify"]
        a0 = float(nt["start"])
        for k, f in enumerate((0.35, 0.7)):
            ov.append({"png": str(notification(rdir, nt, f)), "start": a0 + k * 0.05, "end": a0 + (k + 1) * 0.05, "kind": "text"})
        ov.append({"png": str(notification(rdir, nt)), "start": a0 + 0.10, "end": float(nt["end"]), "kind": "text"})
        sfx.append({"at": a0, "file": "sfx/ding.wav", "gain": -4})
    for name, sc in tl.get("screens", {}).items():
        kind = sc.get("type")
        refs[f"@{name}"] = (quiz_screen(rdir, sc) if kind == "quiz" else intro_screen(rdir, sc) if kind == "intro"
                            else follow_pill(rdir, sc) if kind == "pill" else title_screen(rdir, name, sc))
    if "punchline" in tl:
        refs["@punchline"] = punchline(rdir, tl)
    if "lower_third" in tl:
        lt = tl["lower_third"]
        ov.append({"png": str(lower_third(rdir, lt)), "start": lt["start"], "end": lt["end"], "kind": "text", "fade": 0.15})
    if "riddles" in tl:
        n = len(tl["riddles"])
        for i, r in enumerate(tl["riddles"], 1):
            ov.append({"png": str(riddle(rdir, i, n, r, False)), "start": r["q_start"], "end": r["a_start"], "kind": "text", "fade": 0.08})
            ov.append({"png": str(riddle(rdir, i, n, r, True)), "start": r["a_start"], "end": r["end"], "kind": "text"})

    for s in tl["shots"]:
        if str(s.get("graphic", "")).startswith("@"):
            s["graphic"] = str(refs[s["graphic"]])
    for o in ov:
        if str(o.get("png", "")).startswith("@"):
            o["png"] = str(refs[o["png"]])
    tl["overlays"] = sorted(ov, key=lambda o: float(o["start"]))
    tl["sfx"] = sfx
    return tl
