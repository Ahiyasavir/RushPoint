#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mechanical check for a Hebrew RushPoint video script.

A FLOOR, not a verdict. It catches the things a regex can decide. The failures that
actually decide whether a script sounds like Ahiya are in Tier 1 of
references/anti-ai.md and are judgement calls no checker sees.

    python check_script.py draft.md
    python check_script.py draft.md --json

Exit 1 if any BLOCK level finding fires.
"""
import sys, re, json, io, unicodedata

# Dashes of every flavour, plus the Hebrew maqaf. Banned outright.
DASHES = {
    "-": "hyphen", "‐": "hyphen", "‑": "non breaking hyphen",
    "‒": "figure dash", "–": "en dash", "—": "em dash",
    "―": "horizontal bar", "־": "maqaf", "－": "fullwidth hyphen",
}

BANNED = [
    ("בעולם של היום", "cut it"), ("בעידן הדיגיטלי", "cut it"),
    ("בשנים האחרונות", "name the year"), ("לא רק", "the 'לא רק ... אלא גם' frame"),
    ("חשוב לזכור", "just say the thing"), ("יש לציין", "just say the thing"),
    ("ראוי להדגיש", "just say the thing"), ("בסופו של דבר", "cut it"),
    ("פורץ דרך", "say what is new"), ("מהפכני", "cut it"),
    ("פתרון חדשני", "cut it"), ("חוויה בלתי נשכחת", "say what happened"),
    ("רגע מכונן", "say what changed"), ("המסע שלי לימד אותי", "no lesson sentences"),
    ("למדתי ש", "no lesson sentences"), ("זה מלמד אותנו", "no lesson sentences"),
    ("המפתח להצלחה", "cut it"), ("אל תפספסו", "not his voice"),
    ("הירשמו עכשיו", "not his voice"), ("תעזרו לי", "use בואו נ instead"),
    ("היי חברים", "banned opener"), ("אני רוצה לספר לכם", "banned opener"),
    ("האם אי פעם", "banned opener"), ("תכירו את", "banned opener"),
]

# Tails that editorialise the clause they hang off. Rule 3, highest yield in Hebrew.
TAILS = ["מה שמדגיש", "מה שמראה על", "מה שמוכיח", "דבר שהוביל", "דבר המעיד",
         "תוך כדי חיזוק", "תוך שמירה על", "ובכך למעשה", "וכך למעשה", "מה שהופך את"]

REGISTER = [("בכדי", "כדי"), ("אנו ", "אני / אנחנו"), ("אנוכי", "אני"),
            ("על מנת", "כדי"), ("מהווה", "הוא / זה"), ("ביצעתי", "עשיתי"),
            ("יישמתי", "בניתי"), ("מאחר ו", "כי"), ("בשל העובדה", "כי"),
            ("לאור כך ש", "כי"), ("הנכם", "אתם"), ("אנו מאמינים", "אני חושב"),
            ("משמש כ", "הוא"), ("מתאפיין ב", "יש לו")]

DECOR = ["ייחודי", "חדשני", "מתקדם", "איכותי", "מרתק", "עוצמתי", "משמעותי", "מכונן"]

# Elegant variation: he must pick ONE word for the thing and repeat it.
SYNONYMS = ["האפליקציה", "הפלטפורמה", "המערכת", "הכלי", "האפליקציה שלי"]

HEB = re.compile(r"[֐-׿]")


def spoken_lines(text):
    """Only the spoken Hebrew. Skips fences, shot directions and our own headers."""
    out = []
    fence = False
    for i, raw in enumerate(text.splitlines(), 1):
        s = raw.strip()
        if s.startswith("```"):
            fence = not fence
            continue
        if fence or not s or s.startswith("#") or s.startswith(">"):
            continue
        if re.match(r"^(מסך|SHOT|ROLL|STRUCTURE|SLOT|THE ONE TRUE THING|CAPTION|THE RISK)", s):
            continue
        s = re.sub(r"^(קול|כתובית)\s*:\s*", "", s)
        if HEB.search(s):
            out.append((i, s))
    return out


def sentences(lines):
    joined = " ".join(s for _, s in lines)
    parts = [p.strip() for p in re.split(r"[.!?]+", joined) if p.strip()]
    return parts


def check(text):
    f = []          # (level, line, what, fix)
    lines = spoken_lines(text)

    for ln, s in lines:
        for ch, name in DASHES.items():
            if ch in s:
                f.append(("BLOCK", ln, f"{name} in '{s[:48]}'",
                          "no dashes anywhere, rewrite the phrase"))
                break
        for bad, fix in BANNED:
            if bad in s:
                f.append(("BLOCK", ln, f"banned: {bad}", fix))
        for t in TAILS:
            if t in s:
                f.append(("BLOCK", ln, f"editorialising tail: {t}",
                          "end the sentence at the fact"))
        for bad, fix in REGISTER:
            if bad in s:
                f.append(("WARN", ln, f"register: {bad}", f"use {fix}"))
        for d in DECOR:
            if d in s:
                f.append(("WARN", ln, f"decorative adjective: {d}",
                          "delete it or replace with a fact"))
        if len(re.findall(r"\bש[֐-׿]", s)) >= 3 and len(s.split()) > 14:
            f.append(("WARN", ln, "three or more ש clauses in one sentence",
                      "break it into two sentences"))

    body = " ".join(s for _, s in lines)

    # adjective triads: three comma separated words then ו
    for m in re.finditer(r"([֐-׿]{3,})\s*,\s*([֐-׿]{3,})\s+ו([֐-׿]{3,})", body):
        f.append(("WARN", 0, f"triad: {m.group(0)}",
                  "one per script, and only if all three are actions in order"))

    used = [w for w in SYNONYMS if w in body]
    if len(used) >= 3:
        f.append(("WARN", 0, "elegant variation: " + ", ".join(used),
                  "pick ONE word for the thing and repeat it"))

    sents = sentences(lines)
    lens = [len(s.split()) for s in sents]
    words = sum(lens)

    if len(lens) >= 4:
        spread = max(lens) - min(lens)
        if spread <= 3:
            f.append(("BLOCK", 0, f"flat rhythm, sentence lengths {lens}",
                      "vary hard, put a two word fragment in the body"))
        elif not any(l <= 3 for l in lens):
            f.append(("WARN", 0, f"no short fragment, lengths {lens}",
                      "add one two or three word sentence"))

    # The incident test. An anchor is anything pinning the script to a real moment:
    # a count, a clock, a weekday, a place, a person. His own tape scores 5 here
    # (עשרות, 4, בחמישי, בבוקר, הצום) and must never fail this check.
    nums = len(re.findall(r"\d", body)) + len(re.findall(
        r"(אחד|שתי|שני|שלוש|ארבע|חמש|שש|שבע|שמונה|תשע|עשר|מאות|עשרות|אלפי|חצי)", body))
    times = len(re.findall(
        r"(בבוקר|בערב|בלילה|בצהריים|אתמול|מחר|היום|השבוע|בראשון|בשני|בשלישי|ברביעי"
        r"|בחמישי|בשישי|בשבת|הצום|השמש|לפנות בוקר|שעבר)", body))
    names = len(re.findall(
        r"(ירושלים|סבתא|סבא|דרימז|דרימס|יובל|אדידס|הימלפרב|סנסנה|בוסטון|רשפוינט"
        r"|בני עקיבא|גוגל|ישראל|תנועה|אוטובוס)", body))
    anchors = nums + times + names
    need = 2 if words < 70 else 3
    if anchors < need:
        f.append(("BLOCK", 0,
                  f"only {anchors} concrete anchors "
                  f"(numbers {nums}, times {times}, names {names}), need {need}",
                  "pin it to a real moment: an hour, a count, a weekday, a place, a name"))

    return f, words, lens


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    path = sys.argv[1]
    text = io.open(path, encoding="utf-8").read()
    f, words, lens = check(text)

    est = round(words / 2.5, 1)
    if "--json" in sys.argv:
        print(json.dumps({"findings": [dict(zip(("level", "line", "what", "fix"), x)) for x in f],
                          "words": words, "est_seconds": est, "lengths": lens},
                         ensure_ascii=False, indent=2))
    else:
        blocks = [x for x in f if x[0] == "BLOCK"]
        warns = [x for x in f if x[0] == "WARN"]
        print(f"{words} spoken words  ~{est}s at 2.5 w/s   sentence lengths {lens}\n")
        for lvl, ln, what, fix in blocks + warns:
            where = f"line {ln}" if ln else "whole script"
            print(f"  [{lvl}] {where}: {what}\n         fix: {fix}")
        print(f"\n{len(blocks)} blocking, {len(warns)} warnings")
        if not blocks:
            print("\nMechanical floor passed. Tier 1 of anti-ai.md is still yours to judge:")
            print("  is there a lesson sentence, is every bow tied, is there a detail")
            print("  only he could know, does it narrate or explain.")
    return 1 if any(x[0] == "BLOCK" for x in f) else 0


if __name__ == "__main__":
    sys.exit(main())
