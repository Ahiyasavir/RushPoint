# Writing missions in Hebrew

## Contents
- The template
- Literal instructions and permissions
- Register: spoken, plural, no slang
- Banned and suspicious phrases
- Titles
- Humour comes from the frame
- Before and after

## The template
Three sentences at most. Teens read about a fifth of the words on a screen (Nielsen Norman: 20
to 28%), so the first sentence is the only one you can be sure is read.

1. **Action**: what to do, with concrete nouns.
2. **Constraint**: the one rule that makes it hard (often with a number).
3. **Proof**: what to send.

A permission sentence ("ומותר לכם להתפצל") can ride on the constraint sentence.

**Word budget: 30 words, aim for 25.** Every approved mission is 32 or fewer; two good missions
came back as "חופרות" at 37 and 40 (lessons L8). When over, cut in this order: example lists
beyond two items, explanations of the proof format, a second constraint that only guards an edge
case.

## Puzzles sound like puzzles
Logistics are literal (where, how long, what to send). The puzzle itself is not: present it as a
found message, a code, a riddle, and do NOT explain the method in the text. The method goes in
the paid `hint`. "הראשון הוא מספר המילה והשני מספר האות" turns a cipher into a worksheet; "מישהו
השאיר הודעה בשלט: 3.1 7.4 2.2" leaves the "aha" to them (lessons L12). Every piece needed to solve
it must still be in the field (L11).

## Literal instructions and permissions
- Name places, never point at them: "ליד [השעון בכיכר]", not "כאן", "מכאן", "בסביבה". A bare
  distance ("200 מטר") is meaningless without a place to measure from. Creator-filled places go
  in square brackets and get a setup step.
- Give order and counts explicitly: "הראשונה... השנייה... השלישית...".
- No riddles in the instructions, no oblique hints ("ביחד לא תספיקו"). If there is something to
  figure out, it lives in the content (the code, the photo, the clue).
- Do not describe the winning strategy. Grant any permission it needs that a team would assume
  is forbidden.

## Register: spoken, plural, no slang
- **Imperative, plural, one form per mission.** The bank's default is the spoken `תצלמו`,
  `תמצאו` (taskBank.ts rule 84), but his own edits use the written `צלמו`, `מצאו` too, and he
  approved both (lessons L16). Do not mix them inside one mission. Never the app voice
  (`הזינו`, `הביטו`, `בצעו`, `לבחירתכם`).
- **No participation machinery** ("כל אחד בתורו", "תחליטו יחד מי", "כל אחד מוסיף אחד") as an
  extra sentence. He cuts it every time (L16). If participation matters, build it into the
  structure of the act itself, in the same sentence.
- Address the group as `אתם`. A Hebrew sentence of four words or more never addresses one man
  (`test-hebrew-voice.ts`).
- **No slang.** Slang is an in-group marker for young people; an adult or an app using it is the
  definition of cringe (MIT Sloan; a 13 year old in TheMarker: "אל תשתמשו במילים האלה, זה
  קרינג'"). Plain, clean spoken Hebrew, the way an adult who respects them talks: not trying to
  be one of them, not a teacher.
- A rule is a rule of the game, not discipline: "הטלפון חייב להיות שלושה מטרים מעל הרצפה. איך
  תגיעו לשם, זאת הבעיה שלכם." Not "יש להקפיד", "חובה", "עליכם", "אסור בהחלט". Controlling
  language produces defiance in teens (Van Petegem et al. 2015); a game rule is accepted because
  playing is choosing obstacles (Suits).
- No exclamation marks in mission text, no emoji, no English unless it is a name.
- **No hyphen or dash of any kind**, including the short one before a number ("מ-100") and the
  Hebrew maqaf. It is a product standard, enforced on the bank by `scripts/test-no-dashes.ts`
  PART G. Write "פחות מ 100 מטר", "מאה מטר", or rephrase.

## Banned and suspicious phrases
Banned: תהיו יצירתיים · תהיו מצחיקים · תעשו את זה מטורף · יאללה · בהצלחה · כל הכבוד · חבר'ה ·
אחי · וואלה · סחתיין · מגניב · שימו לב · חובה · עליכם · יש להקפיד · אסור בהחלט · כמובן ·
לבחירתכם · הזינו · הביטו · בצעו · and any moral ("ככה לומדים...").
Suspicious (the lint warns): כאן / מכאן / בסביבה / משהו (vague place or object), a bare distance,
"רק אחד מכם" + a rule about looking, pointing or speaking (honour rule), more than 3 sentences.

## Name things the way teens do
If the activity has a name they use (פליפ לבקבוק), use the name instead of describing the motion
from outside. That is not slang (slang decorates; a name identifies). Pair it with a countable
target and a clock: "3 פליפים מוצלחים בפחות מדקה". (lessons L19)

## Cut what every player already knows
"אם הוא מסכים", "תספרו לו שזה משחק", "תבקשו רשות לצלם", "בלי לקנות", "בזהירות": every player does
or knows these without being told. They are padding. (L17, L5 refined)

## Give the order, not a tour of the game (lessons L29)
Open with the verb and put the content inside the sentence. Never tell players what they received,
what is attached or how the app works ("קיבלתם רמז", "התמונה שמצורפת למשימה", "מה שסומן לכם",
"אין סיכה על המפה"): they can see it. "תנווטו למקום ש[רמז]", "תלכו למקום שבתמונה", "מה השתנה כאן
מאז שצולמה התמונה?". A creator's content goes in a bracket inside that sentence.

## Titles
Aim for three words (he approved four: "הדבר הכי ותיק כאן"), and they open a question rather than describe a category (curiosity is an
information gap: Loewenstein). Good: "הכי רחוק בעולם", "ביצה בצוות", "מי מלכלך ידיים". Bad:
"משימת צילום", "אתגר קבוצתי", "תחנה 3".

## Humour comes from the frame
- **Benign violation** (McGraw & Warren): funny = something wrong and harmless at the same
  moment. Break a norm of a public place in a way that hurts nobody.
- **Contrast** (GISH): something serious next to something silly. A Hollywood trailer for a
  street corner, an Apple ad for a bin, a national team photo of five kids.
- **Deadpan is the cover**: "אין צורך לשחק, רק להיראות רציניים מאוד" solves embarrassment and
  produces the joke at once. Taskmaster's comedy is people trying seriously.
- **The mission is the setup, the players write the punchline** (Alex Horne). Never ask for the
  punchline ("be funny").
- Teens' irony matures between 12 and 15; slapstick and put-down humour fade. Aim at absurd and
  deadpan, not falling over.
- Specific beats general (Jackbox): "7.77" not "a weird amount", "a raw egg" not "an object".

## Before and after
| Before | After | Why |
|---|---|---|
| ראפ מנצח: תקליטו ראפ על הקבוצה, כל אחד שר שורה | תמצאו שלט או תפריט ותקריאו אותו כאילו הוא שיר, במנגינה של שיר שכולם מכירים. כל אחד שר שורה אחת מהשלט. | no talent needed, the text already exists, the contrast is the joke |
| נקודת הסיום: ...תסתכלו אחד על השני. עשיתם את זה. | נקודת הסיום מחכה. הזמן נעצר רק כשהאחרון מכם נכנס. | same value (together), as a game rule, not a moral |
| העצומה האבסורדית (strangers sign a fake petition) | הנשק שלכם הוא מחמאה אמיתית. תגידו לשלושה אנשים שעובדים פה משהו אמיתי שאהבתם, כל אחד מכם לפחות אחת. תכתבו מה אמרתם ומה ענו. | the stranger receives something instead of being the joke |
| ארבעה חלקים (see gold-examples B) | the fixed "ארבעה מקומות" | literal places, order, permission |
