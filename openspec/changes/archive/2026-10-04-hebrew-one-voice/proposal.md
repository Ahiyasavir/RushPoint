## Why

The Hebrew copy speaks in two voices. Newer copy addresses the creator in the plural ("לחצו",
"סמנו", "שלכם"); older copy addresses one man ("התחל לבנות", "הקלד את שם המשחק כדי לאשר",
"בדוק את תיבת הדואר שלך", "הנתונים שאנו מחזיקים עליך", "משחקים שמחקת"). Beside each other they
read as two products, and the masculine singular excludes half of the people reading it. Found in
the overnight pass of 2026-10-03 (`docs/OVERNIGHT-2026-10-03.md`, proposal 2), approved by Ahiya
on 2026-10-04.

## What Changes

- Every Hebrew SENTENCE (four words or more) in both apps addresses the reader in the plural, or
  impersonally where that reads better ("הזינו", "שלכם", "בדקו", or "נדרשת הסיסמה הנוכחית").
- Short labels (under four words, such as button verbs "שמור", "מחק") are untouched: a short
  singular imperative on a button is ordinary Hebrew UI and changing them is churn.
- A gate fails on a new sentence in the masculine singular, with a declared exception list for
  the words that only look like singular address ("כתוב" as "is written", a past-tense "שלח",
  "מלא" as "full").

## Capabilities

### New Capabilities
- `hebrew-one-voice`: how the Hebrew copy of both apps addresses its reader.

## Impact

- `apps/creator-web/src/i18n.ts`, `apps/play-web/src/i18n.ts` (Hebrew only; English untouched).
- New gate: `scripts/test-hebrew-voice.ts`.
- No logic change.
