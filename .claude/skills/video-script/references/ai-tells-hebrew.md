# The AI tells, ported to Hebrew

The English catalogs we vendored (`.claude/skills/writing-prose-like-a-human/`,
`.claude/skills/avoid-ai-writing/`) are the best available, and **they do not work on Hebrew**.
Their detector is regex over English vocabulary; their rules are stated in English idiom. This
file is the port. It is the part that did not exist anywhere and had to be written.

The framing worth keeping from them, because it is the correct one:

> AI writing has a statistical signature: **regression to the mean**. Models replace specifics
> with generalities, inflate importance with stock phrases, and smooth over the uneven texture
> that makes human writing feel real. The result reads like a press release about everything.

---

## Rule 1 · Specific, not significant  →  ספציפי, לא "משמעותי"

Cut every word whose only job is to announce that something mattered.

| Inflation | Instead |
|---|---|
| `משמעותי` · `מכונן` · `פורץ דרך` · `היסטורי` (as praise) | state what changed |
| `רגע מכונן בדרך שלי` | `ב4 בבוקר ישבתי לנתח` |
| `זה מעיד על` · `זה מסמל` | cut |
| `תרם רבות ל` | say what it did |
| `חוויה בלתי נשכחת` | say what happened |
| `מהפכה בעולם ה` | cut |

His own line is the model: not `המרוץ היה רגע מכונן`, but `עשרות אנשים רצו אצלנו בחמישי האחרון`.

## Rule 2 · Plain verbs  →  פעלים פשוטים

Hebrew has its own inflated-verb family. It is the single clearest marker of press release
Hebrew, and it is what a model reaches for by default.

| Inflated | Plain |
|---|---|
| `מהווה` | `הוא` · `זה` |
| `ביצעתי` · `יישמתי` | `עשיתי` · `בניתי` |
| `מאפשר לך ל` | `אתה יכול` · or just the verb |
| `משמש כ` | `הוא` |
| `מעניק` · `מספק` | `נותן` · `יש` |
| `מתאפיין ב` | `יש לו` |
| `נוכח בקרב` | `יש` |
| `עובר תהליך של` | the verb itself |

And the deeper version of the rule: find the verb hiding in the noun. `ביצעתי תהליך של ניתוח`
→ `ניתחתי`. His speech is already there, which is why it sounds like him:
`הרצתי, סגרתי, דחפתי`.

## Rule 3 · End the sentence at the fact  →  לעצור על העובדה

This is the rule with the highest yield in Hebrew and the one most often missed, because the
Hebrew form looks like natural connective tissue rather than like filler.

**Kill every tail that comments on the clause it is attached to:**

- `... , מה שמדגיש את` · `... , מה שמראה על` · `... , מה שמוכיח ש`
- `... , דבר שהוביל ל` · `... , דבר המעיד על`
- `תוך כדי חיזוק ה` · `תוך שמירה על`
- `ובכך למעשה` · `וכך למעשה`
- `... , בדרך ל`

> `מאות בני נוער רצו בירושלים, מה שמראה על הפוטנציאל האדיר של הפלטפורמה`
> → `מאות בני נוער רצו בירושלים.`

The second is more informative and it is the only one he would say out loud.

## Rule 4 · Vary the rhythm  →  קצב לא אחיד

Hebrew AI text is even more uniform than English AI text, because the model leans on `ש` and
`אשר` to chain clauses. Two mechanical checks, both in the checker script:

- **Sentence lengths must not be flat.** `8, 9, 8, 9` is a machine. Aim for something like
  `3, 11, 2, 8`. Put one two word fragment in the body. He does it without trying: `רק החלום.`
- **No triads of adjectives.** `פשוט, מהיר ויעיל`. One list of three per script, and only if
  all three are actions in chronological order.

Also: **do not vary the noun for elegance.** Hebrew AI text swaps `האפליקציה` → `הפלטפורמה` →
`המערכת` → `הכלי` across four sentences to avoid repeating. Humans repeat. Pick one word for
the thing and keep saying it.

## Rule 5 · Earn every adjective  →  כל שם תואר צריך להרוויח את מקומו

Test: if deleting it changes nothing, delete it.
Habitual offenders: `ייחודי` · `חדשני` · `מתקדם` · `איכותי` · `מרתק` · `עוצמתי` ·
`חלק` (as in `חוויה חלקה`) · `אמיתי` used as decoration rather than as contrast.

`אמיתי` is a special case. He uses it **as a contrast** and that is legitimate:
`לוח משימות אמיתי` (as opposed to the scraps he had), `משחק שדה אמיתי` (as opposed to a quiz).
Decorative `אמיתי` with nothing to contrast against is a tell.

---

## Hebrew only tells, not present in the English lists

**1. The `ש` chain.** Three or more clauses strung on `ש` or `אשר` in one sentence. Humans
break. Models chain.

**2. `אנו` and the institutional register.** `אנו מאמינים` · `הנכם מוזמנים` · `אנו שמחים
לבשר`. This is Hebrew press release voice and it is instantly recognisable. He says `אני`.

**3. The over correct `כי` avoidance.** Models write `מאחר ו` · `בשל העובדה ש` · `לאור כך ש`.
He says `כי`.

**4. `בכדי`.** Hypercorrection, and a strong marker. Always `כדי`.

**5. Symmetrical bilingual phrasing.** A sentence built so it would translate cleanly to
English, with English word order and no Hebrew idiom in it, reads as translated even when it
is grammatical. Ask: would he say this walking down the street?

**6. The redemptive arc.** `למרות הקשיים, העתיד נראה מבטיח`. The English lists call this the
most recognizable AI paragraph shape, and Hebrew has it too. **He never does this.** Every one
of his devlogs ends on something still broken or still unknown.

**7. Curly quotes and the geresh.** Models emit `״` and `׳` inconsistently. Pick one and hold
it. And the maqaf `ל־` is a dash, which is banned outright here anyway.

---

## Running the English tools anyway

They are still worth running on **English** scripts, and the vendored detector is a real
deterministic engine with 53 issue types:

```bash
node .claude/skills/avoid-ai-writing/bin/avoid-ai-writing.js draft-en.md
```

**Calibration, measured here:** fed a paragraph deliberately built out of `In today's
fast-paced world`, `innovative solution`, `transforms the way`, `simple, fast, and efficient`
and `the journey taught me that persistence is the key to success`, it scored **7, "Minimal AI
signals"**, and flagged only `dive into` and `In today's`. It is a floor, not a verdict. The
structural failures in Tier 1 of `anti-ai.md` are the ones that decide whether a script sounds
like him, and no regex sees them.
