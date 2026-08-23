## Context

The term "field game"/"משחק שדה" is a deliberate rebrand (memorialized in prior project decisions,
away from "adventure race" language) and appears throughout the product as the name for what a
creator builds. Feedback from real-user testing is that a brand-new visitor doesn't decode the
term fast enough on the surfaces that matter most: the logged-out landing hero
(`AuthGate.tsx:366,370-372`, `i18n.ts:80-90` HE / `:1798` EN) and the dashboard/gallery subtitles
a first-run creator sees right after signing up (`i18n.ts:159,182,211` HE and their EN
counterparts around `:1834,1844,1890,1907,2009`).

## Goals / Non-Goals

**Goals:**
- A first-time visitor understands the concept within the hero section, without scrolling.
- The brand term stays intact — this fixes a missing explanation, not a naming problem.
- Zero new i18n leaks: every new string flows through `t.*`, both dictionaries get the new key.

**Non-Goals:**
- Deciding the final copy wording — that's a product/marketing call, not an engineering one. This
  design fixes the *mechanism* (a gloss key wired to both dictionaries, rendered next to the
  brand term); the literal sentence is placeholder pending sign-off.
- Renaming the brand term. That reverses a prior explicit decision and needs its own proposal if
  the product still wants it after seeing how a plain-language gloss performs.

## Decisions

- **Add a gloss, don't replace the term.** A/B testing a full rename is expensive (touches store
  listings, marketing video, existing user mental model) and reversible copy addition is not — so
  the low-risk experiment (add an explanatory clause) ships first, and full rename stays a
  separate, explicitly-scoped change if the product decides the gloss isn't enough.
- **New keys, not edits to existing ones**, e.g. `landing.badgeSub`, `dashboard.subtitleSub` (or
  fold the gloss directly into the existing string as a second sentence — implementer's call
  during `tasks.md` execution, whichever reads more naturally per surface) — either way the
  i18n:check gates catch a missing HE/EN pair automatically, so no key is left dangling in only
  one dictionary.

## Risks / Trade-offs

- [Risk] Adding a clause lengthens the hero on mobile, risking layout overflow. → Mitigation:
  verify via `resize_window` (mobile preset) in the preview tools before calling this done; keep
  the added clause to one short phrase, not a sentence.
- [Risk] Stakeholder expectation (per the directive that triggered this) was a full terminology
  *replacement*, not an addition. → Mitigation: this is called out explicitly as an Open Question
  below so it doesn't get silently resolved by implementation choice.

## Open Questions

- Does the product want a full brand-term rename (reversing the earlier "field game" rebrand), or
  is a plain-language gloss next to the existing term sufficient? This design assumes the latter
  because a rename reverses a recorded decision and deserves explicit re-confirmation, not an
  implementation-time judgment call.
- Final copy wording for each gloss (HE and EN) — needs a product/marketing pass before `tasks.md`
  execution finalizes the literal strings.
