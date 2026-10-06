## Why

Ahiya, 2026-10-06, on the Quick Setup step card beside the mission editor: "המסכים האלה בהקמה
מהירה קצת מפוזרים לי מידי ונראים מאוד מבלבלים ולא נוחים... הטקסט הערוך בצד הוא מאוד מתיש וגורם לי
לא לרצות לקרוא". Measured against the code and his screenshot:

1. Four sources of prose are glued into ONE paragraph: "המשימה: X.", the mission's description, the
   step's instruction, then the template author's note, so the same request can appear twice.
2. The thing to DO sits at the END of that paragraph. Readers take in the first two words of a line
   (NN/g, "First 2 Words"); here those were "המשימה: הליכה לנקודה", never the action.
3. Three progress signals on one card ("2 מתוך 2", a bar, dots).
4. Five controls in the action row, one of them a sentence that wraps ("חזור לזה מאוחר יותר", which
   also addresses one man, against the house voice).
5. The note is small grey text behind a side rule: the "edited text at the side".

Research (NN/g on instructional overlays and wizards): one task per step, a short instruction that
starts with the action, one progress indicator, background material behind a disclosure.

Ahiya chose, from two directions, "כרטיס, בסידור חדש": keep the card, rebuild its order.

## What Changes

- **Header row:** ONE progress indicator, "2 מתוך 2 · חובה", and the close ✕ in the corner.
- **Title = the action**, bold and larger: the first sentence of the step's copy. Every copy line is
  rewritten so its first sentence IS the action (or the question being asked), verb first.
- **One supporting line:** the template's short note when there is one, otherwise the rest of the
  copy line. Never both, never a side-ruled quote.
- **Context row:** "משימה: X" small, with a "פרטים" disclosure that holds the mission's own
  description and a long template note. Collapsed on every step. Absent when there is nothing behind
  it.
- **Actions:** primary "הבא", secondary "הקודם", and a short text link "אחר כך" (EN "Later") in
  place of "חזור לזה מאוחר יותר".
- Same component for the floating and the inline card; the floating card no longer switches to a
  row layout and is narrower.

## Impact

- `apps/creator-web/src/components/QuickSetup.tsx` (`QuickSetupBar`, progress trail).
- `apps/creator-web/src/lib/quickSetupAsk.ts` (new, pure: split a copy line into title + rest).
- `apps/creator-web/src/i18n.ts` (`quickSetup.copy` rewritten verb first, `defer`, new keys).
- No server change, no data change.
