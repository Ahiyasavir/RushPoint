# The anti AI checklist. Run it on every draft, line by line.

The research is blunt about this: deleting flagged words does not fix AI sounding writing,
because the tell lives in the **structure and the rhythm**, not the vocabulary. The named
failures are: it states the lesson, it names nothing real, it ties every bow, and it leaves
no lived detail. Sentence rhythm is the biggest single giveaway, specifically disconnected
sentences with no logic between them, forced groups of three, and every sentence the same
length.

So the checklist runs structure first, and only then words.

---

## Tier 1 · Structure. Fix these or throw the draft out.

**1. Is there a lesson sentence?** Any line that generalises the meaning of what happened.
`למדתי ש...` · `זה מלמד אותנו ש...` · `בסוף, מה שחשוב זה...` · `ההתמדה היא המפתח`.
**Delete it. Do not replace it.** Show the fact and let the viewer draw it. His own writing
does exactly this: he never once says what a day taught him, he tells you the hour he woke up.

**2. Is every bow tied?** If the last beat resolves everything, break it. Real weeks end
unresolved and his do: `זו הבעיה שאני הולך לתקוף בימים הקרובים` · `מה עדיין לא עובד`.
At least one thing must still be open at the end.

**3. Count the proper nouns and the numbers.** A 30 second script needs a minimum of
**three** between them: an hour, a count, a place, a person's real name. Zero means the
script is about a topic, not an incident, and no rewrite of the words will save it.

**4. Read the sentence lengths out as a list.** `7, 8, 7, 9` is a machine. Aim for something
like `4, 12, 2, 9, 3`. A two word fragment somewhere in the body is worth more than any word
substitution. He does this naturally: `רק החלום.` · `בלי פשרות.`

**5. Count the triads.** Any `X, Y ו־Z` list of exactly three parallel items. One per script,
maximum, and only if all three are concrete. `פשוט, מהיר ויעיל` is the canonical AI triad.
`הרצתי סימולציות, סגרתי את הבאגים ודחפתי עדכון` is fine, because they are three real actions
in chronological order, not three adjectives.

**6. Is there one detail only he could know?** The fast, the bus to Jerusalem, the grandmother,
the corner of the room he rebuilt, the three hours before the message came. **If a competent
stranger could have written this script from the product page, it is not his.**

**7. Does anything explain instead of narrate?** He stacks verbs. If a beat describes a state
or a benefit rather than an action he performed, rewrite it as a thing he did.

---

## Tier 2 · Hebrew words and constructions to strike

**Banned outright, no exceptions:**
- **Any hyphen or dash.** Including the maqaf: `ל-4`, `מ-א'`, `בן-17`. Absolute rule.
- `בעולם של היום` · `בעידן הדיגיטלי` · `בשנים האחרונות`
- `לא רק ... אלא גם`
- `חשוב לזכור ש` · `יש לציין ש` · `ראוי להדגיש`
- `המסע שלי לימד אותי` (`המסע שלי` on its own is fine, he uses it)
- `פשוט, מהיר ויעיל` and every adjective triad like it
- `פתרון חדשני` · `מהפכני` · `פורץ דרך` · `הופך את X לחוויה`
- `בסופו של דבר` as a closing move
- emoji clusters. One emoji maximum in a caption, zero in the spoken script.

**Register slips that read as a machine or as a press release:**
| Machine | Him |
|---|---|
| `בכדי` | `כדי` |
| `אנו` · `אנוכי` | `אני` · `אנחנו` |
| `על מנת ש` | `כדי ש` |
| `מהווה` | `זה` |
| `אשר` | `ש` |
| `רב ביותר` | `הכי` |
| `ביצעתי` · `יישמתי` | `עשיתי` · `בניתי` |
| `חוויה מרגשת` | `התרגשתי` |
| `אתגרים רבים` | name the actual problem |

**One allowed once per script, never twice:** `זה לא X, זו Y`. It is genuinely his
(`זה לא מרוץ, זו היסטוריה`), and it is also a construction AI reaches for reflexively.

---

## Tier 3 · The delivery test

Read the script aloud. Mark every place you would naturally breathe, stumble or repeat a
word. **A script with no place to breathe was written for the eye, not the mouth.** His real
recordings have long gaps in them: in the tape, `הצום` ends at 10.62 seconds and `כבר`
does not start until 13.86. Over three seconds of silence, kept, in a sixty second video.
Write the pause in.

---

## The mechanical pass

```bash
python .claude/skills/video-script/scripts/check_script.py <draft.md>
```

It catches dashes, the banned phrase list, the register slips, triads and flat sentence
rhythm, and prints the proper noun and number count. **It is a floor, not a verdict.** A
draft can pass it clean and still be a topic instead of an incident, which is the failure
that actually matters. Tier 1 is judgement and stays yours.
