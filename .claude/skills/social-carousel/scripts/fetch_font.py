# -*- coding: utf-8 -*-
"""Fetch a Google Font's TTF by family name, straight from the google/fonts repo.

    python fetch_font.py "Secular One" "Karantina" --out ./assets

Why: the Google Fonts CSS endpoint needs a browser UA and returns woff2 URLs that
PIL cannot load, so during the carousel build fonts were fetched by hand-guessing
GitHub raw paths. This does the guess properly: it lists the family's directory
in google/fonts (ofl/, apache/, ufl/) and downloads every .ttf in it, variable
fonts included.
"""
import sys, os, json, re, urllib.request, argparse

API = "https://api.github.com/repos/google/fonts/contents/{lic}/{slug}"
RAW = "https://raw.githubusercontent.com/google/fonts/main/{lic}/{slug}/{name}"

def slugify(family):
    return re.sub(r"[^a-z0-9]", "", family.lower())

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "fetch_font/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("families", nargs="+")
    ap.add_argument("--out", default=".")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for fam in a.families:
        slug = slugify(fam)
        got = False
        for lic in ("ofl", "apache", "ufl"):
            try:
                listing = json.loads(fetch(API.format(lic=lic, slug=slug)))
            except Exception:
                continue
            ttfs = [e["name"] for e in listing if e["name"].lower().endswith(".ttf")]
            if not ttfs:
                continue
            for name in ttfs:
                data = fetch(RAW.format(lic=lic, slug=slug, name=name))
                path = os.path.join(a.out, name)
                open(path, "wb").write(data)
                print("OK  %-40s %7d bytes" % (name, len(data)))
            got = True
            break
        if not got:
            print("MISSING  %s  (not found under ofl/apache/ufl as '%s')" % (fam, slug))
            sys.exit(1)

if __name__ == "__main__":
    main()
