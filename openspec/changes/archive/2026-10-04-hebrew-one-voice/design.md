## Decisions

### D1. Sentences, not buttons
The line is drawn at four words. A button ("שמור", "מחק את חשבוני") keeps its short form; a
sentence that tells the reader something or asks them to act is plural. Button labels that are
themselves sentences ("צור את המשחק הראשון שלך") become a noun form ("יצירת המשחק הראשון").

### D2. Detection is rendered, not regexed over source
The gate walks both Hebrew dictionaries and CALLS function entries with sample arguments, then
checks the rendered sentence for a masculine-singular imperative at a word start, or a singular
second-person suffix ("שלך", "עליך", "אותך", "חשבונך") or second-person past ("שמחקת",
"התחברת"). That is the text a person reads, including function bodies.

### D3. Declared exceptions with reasons, and no stale ones
A few hits are other grammar that looks the same ("כתוב" = "is written", "הצוות שלח" = past
tense, "מלא" = "full"). Each is declared by dictionary path with a reason; an exception that no
longer matches fails the gate, so the list cannot rot.

### D4. Hebrew only
English has no gendered second person; nothing to do there.
