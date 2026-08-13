## Why

Real-user testing found that "משחק שדה" / "field game" doesn't tell a first-time visitor what the
app actually does. It's the first thing anyone sees: the logged-out landing hero
(`AuthGate.tsx:366` badge, `:370-372` two-line headline) and the dashboard subtitle/CTA
(`i18n.ts:159`, `:182`) all lead with the bare term, with no plain-language gloss anywhere near
first use. A visitor has to keep reading past the hero to learn this means "build a real-world
team scavenger hunt with automatic GPS scoring."

Note: "field game" is not an accidental word choice — it's the product's deliberate rebrand term
(moved away from "adventure race" earlier this year, per the recorded rebrand decision). This
proposal does not silently reverse that branding; it adds the plain-language explanation the
brand term is currently missing, and treats a full rename as a separate, explicitly-flagged
product decision (see Open Questions in design.md).

## What Changes

- Keep the "field game" / "משחק שדה" brand term as the product's name for what it builds, but pair
  its **first appearance on each first-run surface** with a short plain-language gloss so a new
  visitor understands the concept in one glance, not several lines down:
  - Landing hero badge (`AuthGate.tsx:366`, `landing.badge`): append a short descriptor — e.g. HE
    "משחקי שדה בעולם האמיתי — ציד אוצר קבוצתי עם ניקוד אוטומטי" / EN "Real-world team field games —
    like a scavenger hunt, scored automatically". Exact final copy is a product/marketing call;
    this proposal establishes the key (`landing.badgeSub` or similar) and wires it through both
    dictionaries, not the literal words.
  - Dashboard subtitle (`i18n.ts:159`) and Gallery subtitle (`:2009` EN equivalent, its HE pair):
    same treatment — one clause added, not a term replacement.
- No component currently hardcodes the term outside `t.*` lookups (confirmed: every instance found
  is dictionary-driven), so this is a pure copy addition, not a refactor.
- **Does not** touch `creator-onboarding-and-plain-language` (an existing, separately-proposed
  change) which handles engine-jargon-to-plain-language elsewhere in the console (task wizard
  copy, error messages) — that change's scope stops short of the brand term itself.

### Non-goals
- No rename of the brand term itself ("field game" / "משחק שדה" stays the product's name). A full
  rename is flagged as an open product decision, not decided here.
- No change to `docs/marketing/` video assets or external marketing copy — app-only.
- No change to any i18n key structure beyond adding the new gloss keys.

## Capabilities

### New Capabilities
- `creator-value-prop-clarity`: The landing hero, dashboard subtitle, and gallery subtitle each
  pair the "field game" brand term with a one-clause plain-language explanation on first use.

## Impact

- **Surfaces touched:** `apps/creator-web` only (`i18n.ts` both dictionaries, `AuthGate.tsx`,
  possibly `DashboardPage.tsx`/`GalleryPage.tsx` for the new key wiring).
- **Files:** `apps/creator-web/src/i18n.ts`, `apps/creator-web/src/components/AuthGate.tsx`.
- **Risk:** low technically; the open product question (full brand rename) is called out rather
  than decided, so this change can't accidentally undo the earlier rebrand decision.
- **Testing:** `npm run i18n:check:strict` (new keys must exist correctly in both dictionaries,
  purity-checked); render smoke via preview tools on the logged-out landing page in both
  languages.
