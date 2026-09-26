# -*- coding: utf-8 -*-
"""Fetch a brand mark as SVG, trying sources in order of reliability.

    python fetch_logo.py claude googlegemini perplexity gamma:https://gamma.app --out ./assets

Chain per name:
  1. simple-icons (single-path monochrome SVG, ideal for recolouring)
  2. if a URL is given after ':' - the site's HTML, scanning <link rel=icon> and
     ANY quoted string that ends in .svg and smells like a brand asset. Sites keep
     these in JSON blobs and JS bundles as often as in href attributes; Luma's
     mark lived in one.
Prints WHICH source answered, because the two are not equivalent: simple-icons
gives one recolourable path; a site's own SVG is usually multi-path with fills
and gradients and needs a faithful renderer (skia) or path-skipping
(svgpath.render_multi).

Why: 3 of the 5 marks needed for the carousel were in simple-icons and 2 were
not, and the fallback was worked out by hand each time.
"""
import sys, os, re, urllib.request, urllib.parse, argparse

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36"}
DQ, SQ = chr(34), chr(39)
QUOTE = "[" + DQ + SQ + "]"
NOTQ = "[^" + DQ + SQ + r"\s<>]*"
SVG_PAT = re.compile(QUOTE + "(" + NOTQ + r"(?:logo|favicon|brand|icon)" + NOTQ + r"\.svg)" + QUOTE, re.I)
ICON_LINK = re.compile(r"<link[^>]+rel=" + DQ + "[^" + DQ + "]*icon[^" + DQ + "]*" + DQ + "[^>]*href=" + DQ + "([^" + DQ + "]+)" + DQ, re.I)

def get(url, timeout=25):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read(), r.headers.get("Content-Type", "")

def looks_svg(data):
    head = data[:400].lstrip().lower()
    return head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in data[:2000].lower())

def from_simple_icons(slug):
    try:
        data, _ = get("https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/%s.svg" % slug)
        return data if looks_svg(data) else None
    except Exception:
        return None

def from_site(url):
    try:
        html, _ = get(url)
    except Exception:
        return None, None
    text = html.decode("utf-8", "ignore")
    cands = [m.group(1) for m in ICON_LINK.finditer(text)]
    cands += [m.group(1) for m in SVG_PAT.finditer(text)]
    seen = set()
    for c in cands:
        full = urllib.parse.urljoin(url, c)
        if full in seen:
            continue
        seen.add(full)
        try:
            data, _ = get(full)
        except Exception:
            continue
        if looks_svg(data):
            return data, full
    return None, None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="+", help="slug or slug:https://site")
    ap.add_argument("--out", default=".")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    bad = 0
    for item in a.names:
        slug, _, site = item.partition(":")
        data, src = from_simple_icons(slug), "simple-icons"
        if data is None and site:
            data, src = from_site(site if site.startswith("http") else "https:" + site)
        if data is None:
            print("MISSING  %-14s  (not in simple-icons%s)" % (slug, ", site scan found nothing" if site else ""))
            bad += 1
            continue
        path = os.path.join(a.out, slug + ".svg")
        open(path, "wb").write(data)
        paths = len(re.findall(rb"<path\b", data))
        where = "[simple-icons]" if src == "simple-icons" else "[" + src.split("//")[-1][:44] + "]"
        print("OK  %-14s  %2d path%s  %s" % (slug, paths, "" if paths == 1 else "s", where))
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()
