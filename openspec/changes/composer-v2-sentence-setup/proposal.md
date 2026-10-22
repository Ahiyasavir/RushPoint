# Composer v2, phase 4: setup as "complete the sentence"

## Why
Plan, phase 4. "שזה ישאל אותו ממש תשלים את המשפט". Missions that need the creator's words carried them as
"[הוראות ליוצר: ...]" inside the player text, and the creator had to edit around the bracket.

## What changes
- `lib/sentenceForm.ts` (pure): parse a description into text and blanks (the same creator/organizer
  bracket Quick Setup already counts as unfinished), fill it, read the values back out of an edited
  text, and generate a four-digit code nobody guesses.
- `components/SentenceFill.tsx` in the mission editor: the sentence players will read with an
  underlined blank per bracket, the bracket's words as the example. Typing writes the description; an
  empty blank keeps its bracket, so Quick Setup still knows the step is open. A hand rewrite that no
  longer matches the template hands back to the plain text box.
- The station code field gains "תמציאו לי קוד".
- Bank: two missions used a bracket outside the grammar ("[להכניס את המקום]", "[נקודה ראשונה]"); they now
  use "[הוראות ליוצר: ...]", and a test keeps every bank bracket inside the grammar.
