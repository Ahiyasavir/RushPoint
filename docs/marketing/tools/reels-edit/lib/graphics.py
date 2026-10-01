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
LOGO = (ROOT / CFG["paths"].get("logo", "../../../../apps/play-web/public/icon.svg")).resolve()

BASE_CSS = f"""
:root{{--fire:{C['fire']};--amber:{C['amber']};--plasma:{C['plasma']};--green:{C['green']};
--dark:{C['dark']};--bone:{C['bone']};}}
body{{font-family:'{F['body']}';color:#fff;}}
.disp{{font-family:'{F['display']}';font-weight:{F['display_weight']};}}
.mono{{font-family:'{F['mono']}','{F['body']}';font-weight:{F['mono_weight']};direction:ltr;unicode-bidi:isolate;}}
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


def receipt(rdir: Path, rc: dict, upto: int, mode: str = "line") -> Path:
    """mode: line (after landing `upto`) · total · final (the blank next expense) · blank."""
    lines = [ln for ln in rc["lines"] if ln.get("approved", True)][: upto if mode == "line" else None]
    shown = lines[-9:]
    cur = rc.get("currency", "₪")
    rows = []
    for i, ln in enumerate(shown):
        newest = mode == "line" and i == len(shown) - 1
        rows.append(f"""<div class="row{' new' if newest else ''}">
          <span class="mono n">{ln['jump']:02d}</span><span class="lbl">{t(ln['label'])}</span>
          <span class="amt">{t(ln['ils'], 'mono')}<span class="cur">{cur}</span></span>
          <span class="hrs">{t(ln['hours'], 'mono')}</span></div>""")
    ils = [_num(ln["ils"]) for ln in lines]
    hrs = [_num(ln["hours"]) for ln in lines]
    tot_ils = "TODO" if (None in ils or not lines) else f"{sum(ils):,.0f}"
    tot_hrs = "TODO" if (None in hrs or not lines) else f"{sum(hrs):g}"
    rate = _num(CFG["money"]["usd_ils_rate"])
    usd = "TODO" if (rate is None or tot_ils == "TODO") else f"{sum(ils) / rate:,.0f}"
    foot = ""
    if mode in ("total", "final"):
        foot = f"""<div class="tot"><span class="disp">סה״כ</span>
          <span>{t(tot_ils, 'mono big')}<span class="cur">{cur}</span></span>
          <span>{t(tot_hrs, 'mono')} {esc(rc.get('hours_label', 'שעות'))}</span>
          <span class="usd">≈ ${t(usd, 'mono')}</span></div>"""
    if mode in ("final", "blank"):
        foot += f'<div class="next disp">{esc(rc["final_line"])}</div>'
    b = rc["box"]
    # torn paper bottom edge
    zig = ",".join(f"{100 - i * 4}% {'100%' if i % 2 == 0 else 'calc(100% - 18px)'}" for i in range(26))
    ZIG = f"0 0,100% 0,{zig}"
    css = BASE_CSS + f"""
    .card{{position:absolute;left:{b['x']}px;top:{b['y']}px;width:{b['w']}px;background:var(--bone);color:var(--dark);
      border-radius:22px 22px 0 0;padding:34px 40px 46px;box-shadow:0 30px 80px rgba(0,0,0,.45);
      clip-path:polygon({ZIG});}}
    .hd{{display:flex;justify-content:space-between;align-items:baseline;border-bottom:3px dashed #1C191755;padding-bottom:14px;margin-bottom:10px;}}
    .hd .disp{{font-size:56px;}} .hd .brand{{font-family:'{F['latin_display']}';font-weight:700;font-size:30px;direction:ltr;}}
    .row{{display:grid;grid-template-columns:70px 1fr 200px 110px;align-items:center;gap:12px;font-size:36px;padding:8px 10px;border-radius:10px;}}
    .row.new{{background:var(--amber);}}
    .n{{font-size:30px;opacity:.6;}} .amt{{text-align:left;}} .hrs{{text-align:left;opacity:.75;}}
    .cur{{font-family:'{F['body']}';font-weight:800;margin-inline-start:6px;}}
    .tot{{margin-top:16px;border-top:4px solid var(--dark);padding-top:16px;display:flex;flex-wrap:wrap;gap:10px 28px;align-items:baseline;font-size:40px;}}
    .tot .big{{font-size:64px;color:var(--fire);}} .usd{{opacity:.8;}}
    .next{{margin-top:26px;font-size:66px;color:var(--fire);}}
    """
    body = f"""<div class="card"><div class="hd"><span class="disp">קבלה</span><span class="brand">RushPoint</span></div>
      {''.join(rows)}{foot}</div>"""
    name = f"receipt_{mode}_{upto:02d}"
    return _out(rdir, name, page(body, css, W, H))


# ── reel 3 · proofs ──────────────────────────────────────────────────────────
def proof(rdir: Path, p: dict) -> Path:
    src = _img_src(rdir, p["image"])
    shot = (f'<img src="{src}">' if src else
            f'<div class="ph"><span class="mono">{esc(p["id"])}</span><br>{esc(p["image"])} חסר</div>')
    css = BASE_CSS + f"""
    .card{{position:absolute;left:70px;right:70px;top:{SAFE_T + 90}px;height:980px;border-radius:36px;
      background:var(--dark);border:6px solid var(--amber);overflow:hidden;box-shadow:0 30px 90px rgba(0,0,0,.55);}}
    .card img{{width:100%;height:100%;object-fit:contain;background:#000;}}
    .ph{{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
      font-size:44px;color:#ffffffaa;border:6px dashed #ffffff44;}} .ph .mono{{font-size:120px;color:var(--amber);}}
    .badge{{position:absolute;top:{SAFE_T + 50}px;right:110px;background:var(--plasma);color:var(--dark);font-size:46px;
      padding:6px 22px;border-radius:999px;}}
    .lbl{{position:absolute;top:{SAFE_T + 1100}px;left:70px;right:70px;text-align:center;font-size:64px;line-height:1.15;
      text-shadow:0 4px 24px rgba(0,0,0,.8);}}
    """
    body = f'<div class="card">{shot}</div><div class="badge mono">{esc(p["id"])}</div><div class="lbl disp">{t(p["label"])}</div>'
    return _out(rdir, f"proof_{p['id']}", page(body, css, W, H))


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
        approved = [ln for ln in rc["lines"] if ln.get("approved", True)]
        k = 0
        lands = rc["landings"]
        for j, ln in enumerate(rc["lines"]):
            at = float(lands[j])
            nxt = float(lands[j + 1]) if j + 1 < len(lands) else float(rc["total_at"])
            sfx.append({"at": at, "file": "sfx/land.wav"})
            if not ln.get("approved", True):
                # unapproved line: the jump still happens, the receipt does not grow
                if k:
                    ov.append({"png": str(receipt(rdir, rc, k)), "start": at, "end": nxt, "kind": "text"})
                continue
            k += 1
            sfx.append({"at": at + 0.06, "file": "sfx/ding.wav", "gain": -3})
            ov.append({"png": str(receipt(rdir, rc, k)), "start": at, "end": nxt, "kind": "text", "fade": 0.08})
        ov.append({"png": str(receipt(rdir, rc, len(approved), "total")), "start": float(rc["total_at"]),
                   "end": float(rc["final_at"]), "kind": "text", "fade": 0.1})
        end = max(float(s["end"]) for s in tl["shots"])
        ov.append({"png": str(receipt(rdir, rc, len(approved), "final")), "start": float(rc["final_at"]),
                   "end": end, "kind": "text", "fade": 0.1})
        refs["@receipt_full"] = receipt(rdir, rc, len(approved), "final")
        refs["@receipt_blank"] = receipt(rdir, rc, 0, "blank")

    if "proofs" in tl:
        for p in tl["proofs"]:
            ov.append({"png": str(proof(rdir, p)), "start": p["start"], "end": p["end"], "kind": "text", "fade": 0.06})
        refs["@collage"] = collage(rdir, tl)
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
