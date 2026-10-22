"""Mechanical checks for RushPoint mission text (mission-studio, step 5).

Usage:
    PYTHONUTF8=1 python -I lint_mission.py drafts.json

drafts.json is a UTF-8 JSON list of {"title": ..., "description": ...} objects (extra keys are
ignored). Prints FAIL / WARN lines per mission and exits 1 if any FAIL.

This catches what a machine can decide from the text alone. It does NOT judge whether a mission
is good; the gates and the adversarial readers do that. Every check names the lesson or rule it
comes from, so a WARN can be weighed rather than obeyed blindly.
"""
import json
import re
import sys
import unicodedata

# Sentence and size limits (writing.md "The template": action, constraint, proof).
MAX_SENTENCES = 3
# Lessons L8: every approved mission is 32 words or fewer; "חופרות" came back at 37 and 40.
WARN_DESCRIPTION_WORDS = 30
MAX_DESCRIPTION_WORDS = 45
# He approved four-word titles ("הדבר הכי ותיק כאן"), so three is the aim, not the law.
WARN_TITLE_WORDS = 3
MAX_TITLE_WORDS = 5

# Banned outright (writing.md "Banned"): slang, empty encouragement, controlling or app voice.
BANNED = [
    "תהיו יצירתיים", "תהיו מצחיקים", "מטורף", "יאללה", "בהצלחה", "כל הכבוד", "חבר'ה", "חברה'",
    # "עליכם" alone is NOT banned: "מה שיש עליכם" (what you are wearing) is ordinary Hebrew.
    # Only the controlling "עליכם ל..." (you must...) is, and CONTROLLING below catches it.
    "אחי", "וואלה", "סחתיין", "מגניב", "שימו לב", "חובה", "יש להקפיד", "אסור בהחלט",
    "כמובן", "לבחירתכם", "הזינו", "הביטו", "בצעו", "סקיבידי", "קרינג'",
]

# Written-register imperatives that should be spoken (taskBank.ts rule 84): צלמו -> תצלמו.
WRITTEN_IMPERATIVES = {
    "צלמו": "תצלמו", "מצאו": "תמצאו", "כתבו": "תכתבו", "בחרו": "תבחרו", "שלחו": "תשלחו",
    "הקליטו": "תקליטו", "המציאו": "תמציאו", "בנו": "תבנו", "לכו": "תלכו", "השיגו": "תשיגו",
    "הביאו": "תביאו", "ספרו": "תספרו", "אספו": "תאספו", "חפשו": "תחפשו", "עמדו": "תעמדו",
    "שאלו": "תשאלו", "הגיעו": "תגיעו", "צרו": "תיצרו", "רשמו": "תרשמו", "פתרו": "תפתרו",
}

# Vague place words (lessons L3). Fine at world scale ("הכי רחוק מכאן בעולם"), so WARN only.
# Bare "כאן" is NOT here: "the place you are standing" is literal, and warning on it buried
# the real signal under noise (found running the first bank batch, 2026-10-21).
VAGUE_PLACE = ["מכאן", "בסביבה", "פה בסביבה", "באזור"]
VAGUE_OBJECT = ["משהו"]
BARE_DISTANCE = re.compile(r"\d+\s*מטר(?:ים)?\s*(?:מכאן|מפה|מהמקום)")
# Honour rules (lessons L1): one player restricted in looking, pointing or talking.
HONOUR = re.compile(r"(רק אחד מכם|אף אחד אחר לא|בלי להסתכל|לא מצביע|אסור לו|אסור לה|אסור להם)")
# Hints at strategy inside instructions (lessons L3b/L4).
STRATEGY_HINT = re.compile(r"(ביחד לא תספיקו|לבד לא תספיקו|כדאי לכם להתפצל|הטריק הוא)")
CONTROLLING = re.compile(r"עליכם\s+ל")
# Self-evident sentences he cuts (lessons L17, L5 refined).
CONSENT = re.compile(r"(אם (?:הוא|היא|הם) (?:מסכים|מסכימה|מסכימים)|תספרו (?:לו|לה|להם) שזה (?:חלק מ)?משחק|תבקשו (?:ממנו |ממנה )?רשות|רשות לצלם)")
FORBIDS_MONEY = re.compile(r"(בלי לקנות|בלי שזה יעלה כסף|בלי להוציא (?:שקל|כסף))")
# Participation machinery he removes from his own edits (lessons L16).
PARTICIPATION = re.compile(r"(כל אחד (?:מכם )?בתורו|תחליטו יחד מי|כל חילוף נעשה|כל אחד מכם (?:מוסיף|תורם))")
# Lessons L29: words that describe the game to the player instead of telling them what to do.
META_NARRATION = ["קיבלתם", "שמצורפת", "המצורפת", "שסומן לכם", "אין סיכה", "כצוות", "מחכה לכם", "מחכות לכם"]
# Money (lessons L5 refined, gate G9): never REQUIRED, never forbidden. WARN on any money word,
# because looking at a price is fine and an optional coin is fine too.
MONEY = re.compile(r"(מטבע|שקל|כסף|לקנות|תקנו|לשלם|תשלמו|לתרום|תתרמו|קונים|משלמים)")
# Any hyphen or dash, maqaf included: the product bans them in all user copy, and
# scripts/test-no-dashes.ts PART G fails the bank on one. Only U+2212 (minus) is allowed.
LONG_DASH = re.compile(r"[-‐‑‒–—―־]")
EMOJI = re.compile(r"[\U0001F300-\U0001FAFF☀-➿⭐⭕]")
SENTENCE_END = re.compile(r"[.?!]+(?=\s|$)")


def words(text):
    return [w for w in re.split(r"\s+", text.strip()) if w]


def control_chars(text):
    return [hex(ord(c)) for c in text if unicodedata.category(c) == "Cc" and c not in "\n\t"]


def contains_word(text, word):
    # Hebrew prefixes (ו, ה, ש, ב, ל, מ, כ) can attach to a word; match the bare word or one prefix.
    return re.search(r"(?:^|[\s\"'(\[])[והשבלמכ]?" + re.escape(word) + r"(?=$|[\s.,:;?!\"')\]])", text) is not None


def lint(mission):
    fails, warns = [], []
    title = (mission.get("title") or "").strip()
    desc = (mission.get("description") or "").strip()
    both = title + "\n" + desc

    if not title:
        fails.append("missing title")
    if not desc:
        fails.append("missing description")

    if len(words(title)) > MAX_TITLE_WORDS:
        fails.append(f"title has {len(words(title))} words (max {MAX_TITLE_WORDS}) [writing.md Titles]")
    elif len(words(title)) > WARN_TITLE_WORDS:
        warns.append(f"title has {len(words(title))} words, aim for 3 [writing.md Titles]")

    sentences = [s for s in SENTENCE_END.split(desc) if s.strip()]
    # He added a sentence to one of his own (one colour: "חסר חפץ? אפשר לבקש בהשאלה"), so the
    # count is a warning; only a text that has stopped being a mission fails.
    if len(sentences) > MAX_SENTENCES + 3:
        fails.append(f"{len(sentences)} sentences: this is no longer a mission brief [template]")
    elif len(sentences) > MAX_SENTENCES:
        warns.append(f"{len(sentences)} sentences, aim for {MAX_SENTENCES} [template]")
    n_words = len(words(desc))
    if n_words > MAX_DESCRIPTION_WORDS:
        fails.append(f"{n_words} words (max {MAX_DESCRIPTION_WORDS}) [template, lessons L8]")
    elif n_words > WARN_DESCRIPTION_WORDS:
        warns.append(f"long: {n_words} words, budget 30. Cut example lists, proof explanations, edge-case rules [lessons L8]")
    # An example list after a colon with three or more items (lessons L8: two at most).
    for m in re.finditer(r":\s*([^.:]+)", desc):
        items = [x for x in re.split(r",|\sאו\s", m.group(1)) if x.strip()]
        if len(items) >= 3:
            warns.append(f"example-list of {len(items)} items: keep two at most [lessons L8]")
            break
    # Measured from the player instead of from the pin (lessons L10, gate G12).
    if re.search(r"(?:מטר(?:ים)?|צעד(?:ים)?)\s+מכם|לידכם\s+במרחק", desc):
        warns.append("relative-to-player distance: must be a located mission, phrased from the pin [lessons L10]")
    # A distance the team must reach or judge (lessons L14): measurable with what they carry?
    if re.search(r"למרחק\s+(?:של\s+)?\d+|\d+\s*(?:מטר|צעדים)\s+(?:קדימה|משם|מהקו)", desc):
        warns.append("distance target: can they measure it on the spot, and what makes it hard? [lessons L14, gate G15]")

    for phrase in BANNED:
        if phrase in both:
            fails.append(f"banned phrase '{phrase}' [writing.md Banned]")
    if CONTROLLING.search(both):
        fails.append("controlling 'עליכם ל...': write it as a rule of the game [writing.md Register]")
    # Written imperatives share their spelling with the past tense ("קבוצות קודמות בנו" = "previous
    # teams BUILT"), so only flag one that OPENS a clause: start of text, or after . : , ; with an
    # optional ו. An instruction opens its clause; a past-tense verb follows its subject.
    # Both forms are his (lessons L16): he writes "צלמו" in his own edits and approved "תצלמו".
    # What reads badly is MIXING them in one mission, so that is the warning.
    written_hits = [w for w in WRITTEN_IMPERATIVES
                    if re.search(r"(?:^|[.:,;!?]\s*)ו?" + re.escape(w) + r"(?=$|[\s.,:;?!])", desc)]
    spoken_hits = [sp for sp in WRITTEN_IMPERATIVES.values() if contains_word(desc, sp)]
    if written_hits and spoken_hits:
        warns.append(f"mixed imperative forms: written {written_hits} and spoken {spoken_hits}; pick one [lessons L16]")
    if PARTICIPATION.search(desc):
        warns.append("participation clause: is it the mechanic itself, or machinery he would cut? [lessons L16]")
    # Narrating the game instead of giving the order (lessons L29): "קיבלתם רמז", "התמונה שמצורפת",
    # "מה שסומן לכם", "אין סיכה על המפה". Open with the action; the content goes inline.
    meta = [m for m in META_NARRATION if m in desc]
    if meta:
        warns.append(f"narrates the game instead of the action {meta}: open with the verb, content inline [lessons L29]")

    # Quoted text is CONTENT the players read out or write down (the petition's own slogan),
    # not the app speaking, so it may shout. Only the instruction around it may not.
    if re.sub(r'"[^"]*"', '', desc).count("!") > 0:
        fails.append("exclamation mark in mission text [writing.md Register]")
    if EMOJI.search(both):
        fails.append("emoji [no-stock-emoji rule]")
    if LONG_DASH.search(both):
        fails.append("hyphen or dash (any kind, maqaf included) [writing.md Register, test-no-dashes]")
    cc = control_chars(both)
    if cc:
        fails.append(f"control characters {cc} [CLAUDE.md control-char gotcha]")

    if BARE_DISTANCE.search(desc):
        fails.append("bare distance from 'here': name the place instead [lessons L3]")
    for w in VAGUE_PLACE:
        if contains_word(desc, w):
            warns.append(f"vague place '{w}': fine at world scale, not for a walking target [lessons L3]")
            break
    for w in VAGUE_OBJECT:
        if contains_word(desc, w):
            warns.append(f"vague object '{w}': is there a concrete noun? [writing.md Specific]")
    if MONEY.search(desc):
        warns.append("money word: is spending REQUIRED (fails) or only possible (fine)? [lessons L5 refined, gate G9]")
    if FORBIDS_MONEY.search(desc):
        warns.append("forbids spending: he wants money allowed, just never the only way. Cut it [lessons L5 refined]")
    if CONSENT.search(desc):
        warns.append("consent boilerplate: players know this. Cut it [lessons L17]")
    if HONOUR.search(desc):
        warns.append("possible honour rule: who wants to break it, and what notices? [lessons L1, gate G1]")
    if STRATEGY_HINT.search(desc):
        fails.append("strategy hinted inside the instructions: state facts, grant permission [lessons L3b, L4]")
    if re.search(r"[A-Za-z]{3,}", desc) and not re.search(r"(Freeze|Humans|Apple|GPS|QR)", desc):
        warns.append("English word in the text: is it a name? [writing.md Register]")

    return fails, warns


def calibrate(missions):
    """Check the lint against his real verdicts (evals/calibration.json).

    expect "pass": he approved it, so the lint must not FAIL it (a WARN is allowed: warnings are
    questions, not verdicts). expect "flag"/"fail": he rejected it, so the lint must at least WARN.
    A lint that fails an approved mission is the thing that is wrong.
    """
    bad = 0
    human = 0
    for m in missions:
        fails, warns = lint(m)
        expect = m.get("expect", "pass")
        if expect == "human":
            # His note was about something no text check can see (childishness, a missing
            # challenge, bad anchors). Counted, never faked: the gates and readers own these.
            human += 1
            continue
        ok = (not fails) if expect == "pass" else bool(fails or warns)
        if not ok:
            bad += 1
            print(f"MISCALIBRATED: {m.get('title')} expected {expect}, got fails={fails} warns={warns}")
    checked = len(missions) - human
    print(f"calibration: {checked - bad}/{checked} text verdicts matched ({human} judgement-only notes skipped)")
    return 1 if bad else 0


def main():
    # `python -I` ignores PYTHONUTF8, and a Windows console defaults to cp1252, which cannot
    # print Hebrew. Force UTF-8 here so the script works however it is launched.
    sys.stdout.reconfigure(encoding="utf-8")
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        print(__doc__)
        return 2
    with open(args[0], encoding="utf-8") as f:
        missions = json.load(f)
    if "--calibrate" in sys.argv:
        return calibrate(missions)
    if isinstance(missions, dict):
        missions = [missions]
    any_fail = False
    for i, m in enumerate(missions, 1):
        fails, warns = lint(m)
        status = "FAIL" if fails else ("WARN" if warns else "PASS")
        any_fail = any_fail or bool(fails)
        print(f"[{status}] {i}. {m.get('title', '')}")
        for x in fails:
            print(f"    FAIL  {x}")
        for x in warns:
            print(f"    warn  {x}")
    print(f"\nchecked {len(missions)} mission(s)")
    return 1 if any_fail else 0


if __name__ == "__main__":
    sys.exit(main())
