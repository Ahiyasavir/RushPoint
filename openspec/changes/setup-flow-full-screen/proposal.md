## Why

Ahiya, 22.10, on Quick Setup after "compose one for me": "זה פשוט לא כיף לבנות משחק", "כל הבסיס פשוט
נורא מסורבל ולא נעים", and on the card in his screenshot: why are the mission's details and the
instructions for the creator hidden? Measured on a phone (390x780) against a composed game:

1. The card's title is a generic line chosen by FIELD TYPE ("צרפו תמונה של המקום או של האתגר"), while
   the mission's real instruction ("photograph four details that share something and join them") sat
   behind "פרטים", labelled "מהתבנית", Hebrew and English glued into one paragraph. The 6.10 rule hid
   any "long" note, and every one of the bank's 106 setup prompts is bilingual, so the English half is
   what made most of them "long" (the Hebrew alone is at most 180 characters; 9 exceed 140).
2. What the mission IS (the text players will read) was behind the same disclosure, so a creator
   placed a pin without knowing what happens there.
3. The flow walks FIELDS, not missions: 18 steps for 10 missions, the same mission coming back.
4. After the composer the Builder opened with a tour tip and NO Quick Setup (the `justCreated` rule
   deferred it); on a phone its only entry was the "⋯" menu.

His asks: open automatically after the composer without showing the ordinary builder; never hide
something important because it is long; the creator must know what is in the mission while placing
it; the instruction should pop in a pleasant way nobody can miss; smooth and elegant on a phone; use
proper libraries for the design.

## What Changes

- **A full-screen setup flow** (`components/SetupFlow.tsx`) replaces the card-on-the-builder for
  every Quick Setup entry. One screen per MISSION: the mission as players will see it (title, kind,
  full text, never folded), then "what to do here" as one card per step: a FILL card holds the field's
  own control (the guided mission editor, isolated to that field, so every field kind already works),
  titled with the step's instruction; a PREP card (physical preparation, e.g. build a stone tower) pops
  in with a spring and a soft glow, is never folded, and goes on the "before the game" list.
- **The logic is pure** (`lib/setupFlow.ts`): screens grouped by mission in route order, game-level
  steps first; bilingual prompts split to the interface language; prep vs fill decided by whether the
  field still needs input and by a declared verb list pinned over the whole bank; the before-the-game
  list; per-screen completion from `isWizardStepConfigured`.
- **Motion** with `motion` 12.43.0 (creator-web only, inside the lazy Builder chunk): directional
  slide between missions (RTL aware), 40 ms stagger, the prep pop; all off under reduced motion.
- **The finish screen**: confetti when nothing required is left (the existing burst), otherwise what
  is left with a button to each; the before-the-game checklist (ticks kept per game in this browser).
- **Opens by itself after the composer**: the composer's hop into the Builder asks for the flow, which
  opens before the builder is shown, and the guided tour does not start on that mount.

## Impact

creator-web: new `lib/setupFlow.ts`, `components/SetupFlow.tsx`; `pages/BuilderPage.tsx`,
`pages/DashboardPage.tsx`, `components/TaskWizard.tsx` (a `bare` guided mode without its own context
strip), `i18n.ts`, `index.css`; `scripts/test-setup-flow.ts`. No server change, no data change.
