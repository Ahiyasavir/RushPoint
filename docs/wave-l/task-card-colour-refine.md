# Task-card colour refinement — calm, premium Builder grid

Change scope: creator-web Builder task grid only. Keep the *meaning* colour carries
(which exclusive group a task is in, and its interaction type) but make the grid look
refined and calm instead of busy/garish. Colourblind-safety and RTL preserved.

User: "I understand the logic in the colours but it doesn't look good at all."

## What currently produces the heavy look

`apps/creator-web/src/components/TaskCard.tsx` (before this change):

1. **Full-height saturated TYPE edge — the biggest offender.**
   `TaskCard.tsx:108` `style={{ borderInlineStartColor: color }}` combined with
   `TaskCard.tsx:109` `border-s-[4px]`. `color = TYPE_FAMILY_COLOR[task.type]` is a
   fully-saturated hex (e.g. `#7F77DD`, `#D85A30`). Every card — grouped or not —
   carries a 4px full-height saturated slab on its leading edge. In a 6-card grid that
   is six saturated vertical bars in six different hues: the single loudest thing on
   screen.

2. **Full-card saturated GROUP ring.**
   `TaskCard.tsx:113` `ring-1 ring-inset ${style.ring}` where `style.ring` is e.g.
   `ring-cyan-400/70`. Every grouped card gets a saturated ring around its whole
   perimeter, which also visually competes with the brand `ring-rp-fire/60` selection
   ring (two ring systems fighting).

3. **Full-saturation TYPE pill.**
   `TaskCard.tsx:124` `style={{ background: `${color}22`, color }}` — the type label is
   drawn in the full-saturation hue on a tinted block.

4. **Saturated GROUP badge square.**
   `TaskCard.tsx:129-135` `${style.badge}` = `bg-cyan-500/20 text-cyan-200 border-cyan-400`
   (from `GROUP_STYLES`, `TaskCard.tsx:25-32`). This is the colourblind-safe letter cue
   (letter + border + colour) — worth keeping, but at this saturation it adds to the din.

So each grouped card stacked **four** saturated colour treatments; each ungrouped card
still had the loud full-height type slab. Nothing read as "clean/neutral".

## New treatment (keep meaning, calm the grid)

Design principle: **one small saturated anchor per encoding, everything else neutral.**
Cards become a uniform, quiet rhythm of neutral panels; colour appears only in tiny,
deliberate marks.

- **TYPE → a small filled dot + neutral pill.** Drop the 4px full-height type slab
  entirely. The type is shown by a compact chip: a 6px filled dot in the type colour +
  the type label in neutral `--ink-2` on a faint `--surface-2` chip. The dot is the only
  saturated pixel; the label stays perfectly legible. Type colour is still present and
  scannable (and the Stage-Rail `PacingBar` continues to show the bold type-colour arc),
  just no longer a slab. `TYPE_FAMILY_COLOR` values are unchanged (shared with PacingBar
  + its test), only how the card *presents* them.

- **GROUP → a slim leading accent (grouped only) + the letter badge.** Remove the loud
  full-card ring. A task in **no** group renders as a fully clean neutral card (no group
  colour at all). A **grouped** task gets a slim ~3px inline-start accent in the group
  colour (`GROUP_STYLES[i].accent`, a static `border-s-<hue>/NN` class) **plus** the
  letter badge. Two coherent, low-key cues; colourblind-safe because the group **letter**
  (א/ב/…) is always shown in the badge and named in text in the strip + modal.

- **Softened GROUP badge.** `GROUP_STYLES[i].badge` desaturated: fill `/15`, border
  `/45`, text kept legible. Still letter + border + colour, still colourblind-safe. The
  same literal is read by the Stage-settings group chips (`BuilderPage`) and the
  Exclusive-groups modal radios, so all three surfaces calm together — no extra code
  touched, only the shared literal.

- **Selection/active** keeps the brand `ring-2 ring-rp-fire/60`. With the group ring
  gone there is now exactly one ring system, so an active card reads unambiguously.

`GROUP_STYLES` moves from `TaskCard.tsx` to a small pure lib `apps/creator-web/src/lib/groupStyles.ts`
(so it is unit-testable without pulling in React/JSX). `TaskCard.tsx` re-exports it, so
`BuilderPage` and `ExclusiveGroupsModal` import paths are unchanged. The old `.ring`
field (only ever read by TaskCard's now-deleted ring) is replaced by `.accent`.

### Before / after (rendered grid of 6, dark theme)

- **Before:** six full-height saturated hue bars + saturated rings on grouped cards +
  saturated pill text. Reads as a colour-swatch strip; "busy and garish".
- **After:** six neutral panels in a calm rhythm; each shows a tiny type dot + neutral
  pill; the two grouped cards carry a slim soft leading accent + a soft lettered badge;
  the ungrouped cards are perfectly clean. Colour now *points* rather than *shouts*.

## RTL / colourblind

- Logical props throughout: `border-s-*`, `ms-`/`me-`, `ps-`/`pe-`, `text-start`. The
  accent lands on the leading (inline-start) edge, so it is on the right in Hebrew.
- Group hue is never the sole carrier: letter badge + border + text label in the strip
  and modal. Type hue is paired with the type label text and trigger icon.
- All colour classes stay complete literal strings (no `bg-${x}`); the group palette is a
  fixed literal map indexed by group number.

## Tests

Mostly a **visual** change. The one pure-logic surface is the `GROUP_STYLES` palette
shape (each entry must expose a non-empty static `badge` **and** `accent` class string,
and there must be a full 6-entry palette). Covered RED-first in
`scripts/test-builder-redesign.ts` (imports the new `lib/groupStyles.ts`). Card rendering
itself is verified visually via a throwaway Playwright harness screenshot (deleted after).
