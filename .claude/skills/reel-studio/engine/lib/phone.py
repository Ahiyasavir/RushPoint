# -*- coding: utf-8 -*-
"""Phone screens for reel 3's proofs, rebuilt in the style of Ahiya's own phone
(Android, dark mode, English UI with Hebrew content; references in reel3-ai/assets/).

Built rather than screenshotted on his call (2026-10-01): "create it yourself". Every
name of another person is drawn and then BLURRED (class "who"); the content comes from
his real messages and calendar where we have them.
"""
from __future__ import annotations

import html as h
from pathlib import Path

from .html_render import page, render

PW, PH = 1080, 2340
DARK = {"bg": "#0B141A", "bar": "#0B141A", "out": "#144D37", "in": "#1F2C34", "text": "#E9EDEF",
        "meta": "#8696A0", "tick": "#53BDEB", "input": "#1F2C34"}
FONT = "'Segoe UI','Arial',sans-serif"


def esc(s) -> str:
    return h.escape(str(s))


def status_bar(time: str, battery: int = 84, light: bool = True) -> str:
    c = "#fff" if light else "#111"
    return f"""<div class="sb" style="color:{c}"><span class="tm">{esc(time)}</span>
      <span class="ic"><svg width="44" height="36" viewBox="0 0 24 20"><path d="M12 18l3-3.5a4.5 4.5 0 0 0-6 0zM5 11a10 10 0 0 1 14 0l-2 2a7 7 0 0 0-10 0zM1 7a15.5 15.5 0 0 1 22 0l-2 2A12.5 12.5 0 0 0 3 9z" fill="{c}"/></svg>
      <svg width="40" height="36" viewBox="0 0 20 20"><rect x="1" y="13" width="3" height="5" fill="{c}"/><rect x="6" y="10" width="3" height="8" fill="{c}"/><rect x="11" y="6" width="3" height="12" fill="{c}" opacity=".5"/><rect x="16" y="2" width="3" height="16" fill="{c}" opacity=".5"/></svg>
      <span class="bat">{battery}</span></span></div>"""


BASE = f"""
*{{box-sizing:border-box;}} body{{font-family:{FONT};}}
.sb{{position:absolute;top:0;left:0;right:0;height:110px;display:flex;justify-content:space-between;align-items:center;
  padding:0 60px;font-size:40px;font-weight:600;direction:ltr;}}
.sb .ic{{display:flex;gap:16px;align-items:center;}}
.sb .bat{{background:#fff;color:#111;border-radius:22px;padding:2px 16px;font-size:32px;font-weight:700;}}
.who{{filter:blur(11px);}}
"""


def _wa_bubble(m: dict) -> str:
    side = "out" if m.get("out", True) else "in"
    # [[name]] marks another person's name: drawn, then blurred
    body = "<br>".join(esc(x).replace("[[", '<span class="who">').replace("]]", "</span>")
                       for x in m["text"].splitlines())
    tick = '<span class="tk">✓✓</span>' if side == "out" else ""
    sender = f'<div class="sn who">{esc(m["sender"])}</div>' if m.get("sender") else ""
    return (f'<div class="row {side}"><div class="b {side}">{sender}<div class="tx" dir="rtl">{body}</div>'
            f'<div class="mt">{esc(m.get("time", ""))} {tick}</div></div></div>')


def whatsapp(out: Path, title: str, messages: list, time: str, subtitle: str = "", blur_title: bool = False,
             day_chip: str = "") -> Path:
    D = DARK
    css = BASE + f"""
    body{{background:{D['bg']};color:{D['text']};}}
    .hd{{position:absolute;top:110px;left:0;right:0;height:150px;background:{D['bar']};display:flex;align-items:center;
      gap:26px;padding:0 34px;direction:ltr;border-bottom:1px solid #222D34;}}
    .av{{width:96px;height:96px;border-radius:50%;background:#3B2F23;display:flex;align-items:center;justify-content:center;}}
    .nm{{font-size:50px;font-weight:600;}} .st{{font-size:34px;color:{D['meta']};}}
    .hd .sp{{flex:1;}}
    .chat{{position:absolute;top:262px;left:0;right:0;bottom:200px;padding:30px 30px 0;display:flex;flex-direction:column;
      gap:18px;overflow:hidden;justify-content:flex-end;direction:ltr;
      background-image:radial-gradient(circle at 20px 20px,#ffffff08 2px,transparent 3px);background-size:70px 70px;}}
    .row{{display:flex;}} .row.out{{justify-content:flex-end;}} .row.in{{justify-content:flex-start;}}
    .b{{max-width:82%;border-radius:22px;padding:20px 26px 14px;font-size:44px;line-height:1.38;}}
    .b.out{{background:{D['out']};border-top-right-radius:6px;}} .b.in{{background:{D['in']};border-top-left-radius:6px;}}
    .sn{{font-size:36px;color:#53BDEB;margin-bottom:6px;}}
    .mt{{font-size:30px;color:#ffffff99;text-align:right;direction:ltr;margin-top:8px;}} .tk{{color:{D['tick']};}}
    .chip{{align-self:center;background:#182229;color:{D['meta']};font-size:34px;padding:8px 26px;border-radius:14px;}}
    .ib{{position:absolute;left:24px;right:24px;bottom:52px;height:130px;display:flex;gap:20px;align-items:center;direction:ltr;}}
    .in2{{flex:1;height:130px;border-radius:65px;background:{D['input']};display:flex;align-items:center;padding:0 40px;
      font-size:44px;color:{D['meta']};}}
    .mic{{width:130px;height:130px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;}}
    """
    who = f'<span class="who">{esc(title)}</span>' if blur_title else esc(title)
    avatar = ('<svg width="56" height="56" viewBox="0 0 24 24" fill="#F5C26B"><circle cx="9" cy="8" r="4"/><circle cx="17" cy="9" r="3"/>'
              '<path d="M1 20c0-4 3.6-7 8-7s8 3 8 7z"/><path d="M15 20c0-2-.6-3.6-1.6-5 3.6-.6 9.6.6 9.6 5z"/></svg>')
    chip = f'<div class="chip">{esc(day_chip)}</div>' if day_chip else ""
    body = f"""{status_bar(time)}
    <div class="hd"><svg width="56" height="56" viewBox="0 0 24 24"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z" fill="#fff"/></svg>
      <div class="av">{avatar}</div><div><div class="nm" dir="auto">{who}</div><div class="st">{esc(subtitle)}</div></div>
      <div class="sp"></div><svg width="64" height="48" viewBox="0 0 24 18"><rect x="1" y="3" width="15" height="12" rx="2" fill="none" stroke="#fff" stroke-width="2"/><path d="M17 8l6-4v10l-6-4z" fill="#fff"/></svg>
      <svg width="20" height="60" viewBox="0 0 6 24"><circle cx="3" cy="4" r="2.4" fill="#fff"/><circle cx="3" cy="12" r="2.4" fill="#fff"/><circle cx="3" cy="20" r="2.4" fill="#fff"/></svg></div>
    <div class="chat">{chip}{''.join(_wa_bubble(m) for m in messages)}</div>
    <div class="ib"><div class="in2">Message</div><div class="mic"><svg width="56" height="56" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3" fill="#111"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4" stroke="#111" stroke-width="2" fill="none"/></svg></div></div>"""
    render(page(body, css, PW, PH, D["bg"]), out, PW, PH)
    return out


def gcal_day(out: Path, time: str, day_name: str, day_num: str, month: str, allday: list, events: list,
             start_hour: int = 5, end_hour: int = 20) -> Path:
    """events = [(start_hour_float, end_hour_float, title, highlight)]"""
    HH = 118
    top0 = 560
    css = BASE + f"""
    body{{background:#1C1B1F;color:#E6E1E5;}}
    .tb{{position:absolute;top:110px;left:0;right:0;height:150px;display:flex;align-items:center;gap:40px;padding:0 40px;direction:ltr;}}
    .tb .m{{font-size:62px;flex:1;}} .tb .av{{width:96px;height:96px;border-radius:50%;background:#F57C00;}}
    .dh{{position:absolute;top:300px;left:40px;width:150px;text-align:center;direction:ltr;}}
    .dh .d{{font-size:36px;color:#F5A35C;}} .dh .n{{margin:10px auto 0;width:100px;height:100px;border-radius:50%;background:#F5A35C;
      color:#1C1B1F;font-size:54px;display:flex;align-items:center;justify-content:center;font-weight:600;}}
    .ad{{position:absolute;left:210px;right:40px;top:300px;display:flex;flex-direction:column;gap:12px;}}
    .ad div{{border-radius:16px;padding:12px 24px;font-size:40px;color:#fff;}}
    .grid{{position:absolute;left:0;right:0;top:{top0}px;}}
    .hr{{position:absolute;left:40px;width:120px;font-size:34px;color:#CAC4D0;direction:ltr;}}
    .ln{{position:absolute;left:190px;right:0;height:2px;background:#2E2D33;}}
    .ev{{position:absolute;left:210px;right:40px;border-radius:16px;background:#4F86C6;color:#fff;font-size:40px;padding:14px 24px;
      overflow:hidden;}} .ev.hot{{background:#E46962;box-shadow:0 0 0 5px #FFB30088;}}
    .now{{position:absolute;left:190px;right:0;height:4px;background:#fff;}}
    """
    rows, evs = [], []
    for hr in range(start_hour, end_hour + 1):
        y = (hr - start_hour) * HH
        rows.append(f'<div class="hr" style="top:{y - 22}px">{hr:02d}:00</div><div class="ln" style="top:{y}px"></div>')
    for a, b, title, hot in events:
        y = (a - start_hour) * HH
        hgt = max((b - a) * HH - 8, 70)
        evs.append(f'<div class="ev{" hot" if hot else ""}" style="top:{y + 4:.0f}px;height:{hgt:.0f}px" dir="rtl">{esc(title)}</div>')
    ad = "".join(f'<div style="background:{c}" dir="rtl">{esc(x)}</div>' for x, c in allday)
    body = f"""{status_bar(time)}
    <div class="tb"><svg width="60" height="50" viewBox="0 0 24 20"><rect y="2" width="24" height="2.6" fill="#E6E1E5"/><rect y="9" width="24" height="2.6" fill="#E6E1E5"/><rect y="16" width="24" height="2.6" fill="#E6E1E5"/></svg>
      <div class="m">{esc(month)} ▾</div><div class="av"></div></div>
    <div class="dh"><div class="d">{esc(day_name)}</div><div class="n">{esc(day_num)}</div></div>
    <div class="ad">{ad}</div>
    <div class="grid">{''.join(rows)}{''.join(evs)}</div>"""
    render(page(body, css, PW, PH, "#1C1B1F"), out, PW, PH)
    return out


def doc_view(out: Path, time: str, title: str, blocks: list) -> Path:
    """A notes/doc screen (dark). blocks = [(kind, text)] kind in h, p, f (formula)."""
    css = BASE + """
    body{background:#121212;color:#EDEDED;}
    .tb{position:absolute;top:110px;left:0;right:0;height:140px;display:flex;align-items:center;padding:0 40px;gap:30px;direction:ltr;
      border-bottom:1px solid #2A2A2A;}
    .tb .t{font-size:44px;color:#B0B0B0;flex:1;}
    .doc{position:absolute;top:290px;left:60px;right:60px;direction:rtl;}
    h1{font-size:64px;margin:10px 0 30px;color:#fff;} h2{font-size:48px;margin:40px 0 14px;color:#8AB4F8;}
    p{font-size:42px;line-height:1.45;margin:8px 0;}
    .f{font-family:'Cambria Math','Segoe UI',serif;font-size:48px;direction:ltr;text-align:left;background:#1E1E1E;border-radius:14px;
      padding:16px 24px;margin:10px 0;}
    """
    html_blocks = []
    for kind, text in blocks:
        if kind == "h":
            html_blocks.append(f"<h2>{esc(text)}</h2>")
        elif kind == "f":
            html_blocks.append(f'<div class="f">{esc(text)}</div>')
        else:
            html_blocks.append(f"<p>{esc(text)}</p>")
    body = f"""{status_bar(time)}
    <div class="tb"><svg width="56" height="56" viewBox="0 0 24 24"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z" fill="#B0B0B0"/></svg>
      <div class="t">Docs</div></div>
    <div class="doc"><h1>{esc(title)}</h1>{''.join(html_blocks)}</div>"""
    render(page(body, css, PW, PH, "#121212"), out, PW, PH)
    return out


def lock_screen(out: Path, wallpaper: Path, hh: str, mm: str, date: str, notif_title: str, notif_body: str,
                notif_time: str, ph: int = PH, top: int = 250) -> Path:
    """His lock screen layout (big stacked clock, date) over his own wallpaper, with a
    notification card. The wallpaper's baked in clock is covered by a soft patch."""
    css = BASE + f"""
    body{{background:#8a6a4c url('{wallpaper.resolve().as_uri()}') center/cover;color:#fff;}}
    .patch{{position:absolute;left:130px;top:230px;width:520px;height:560px;border-radius:60px;
      background:radial-gradient(closest-side,#a07c5ccc,#a07c5c00);filter:blur(30px);}}
    .clk{{position:absolute;left:200px;top:{top}px;font-size:250px;line-height:.92;font-weight:600;letter-spacing:-6px;direction:ltr;}}
    .dt{{position:absolute;left:210px;top:{top + 490}px;font-size:52px;direction:ltr;}}
    .nt{{position:absolute;left:40px;right:40px;top:{top + 630}px;background:rgba(30,26,22,.78);border-radius:44px;padding:30px 36px;
      display:flex;gap:24px;direction:ltr;backdrop-filter:blur(20px);}}
    .nt .ic{{width:84px;height:84px;border-radius:50%;background:#25D366;flex:none;display:flex;align-items:center;justify-content:center;}}
    .nt .tt{{display:flex;justify-content:space-between;font-size:38px;color:#ddd;}}
    .nt .bd{{font-size:44px;margin-top:6px;direction:rtl;text-align:right;line-height:1.35;}}
    """
    note = "" if not notif_body else f"""<div class="nt"><div class="ic"><svg width="52" height="52" viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-8.7 15l-1.3 5 5.1-1.3A10 10 0 1 0 12 2z" fill="#fff"/></svg></div>
      <div style="flex:1"><div class="tt"><span>WhatsApp · {esc(notif_title)}</span><span>{esc(notif_time)}</span></div>
      <div class="bd">{esc(notif_body)}</div></div></div>"""
    body = f"""{status_bar(hh + ':' + mm)}<div class="patch"></div>
    <div class="clk">{esc(hh)}<br>{esc(mm)}</div><div class="dt">{esc(date)}</div>{note}"""
    render(page(body, css, PW, ph, "#8a6a4c"), out, PW, ph)
    return out
