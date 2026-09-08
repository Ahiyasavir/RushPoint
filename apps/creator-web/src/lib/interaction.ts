// Touch-interaction primitives for the creator console.
//
// WHY THIS EXISTS: the creator console is authored on a phone now (change:
// creator-mobile-overhaul), and CLAUDE.md already records the failure mode this
// closes — "a 44px tap-target fix applied to one control does not travel to its
// siblings". A UI/UX audit of this app found the same shape here: TWO glyph
// buttons had been grown to a real 44x44 box (the mission editor's ✕ and the
// stage-settings ✕, each with a comment explaining why), while fourteen of their
// siblings were still bare glyphs — a text-styled <button> with no size class is
// only line-height tall, i.e. ~16-20px, which is under the WCAG 2.2 AA floor of
// 24x24 CSS px and less than half the platform comfort target. Among them: the
// button that DELETES A STAGE, every modal's close ✕, and the toast dismiss.
//
// So the sizes are declared ONCE, here, and every glyph control names its intent
// instead of restating arithmetic. That is the same trick apps/play-web/src/lib/
// interaction.ts plays for the participant app; the two are deliberately
// duplicated rather than shared, because packages/shared is framework-free and
// these are this app's own Tailwind tokens.
//
// These are plain STATIC literals, not a helper that builds a class string:
// Tailwind only sees static class strings (CLAUDE.md), so an interpolated class
// compiles to no CSS at all and a "44px" target silently renders at its old size.
// `content` in tailwind.config.js covers './src/**/*.{ts,tsx}', so the literals
// below are what Tailwind actually emits from.
//
// Enforced by scripts/test-creator-tap-targets.ts.

/**
 * A control that owns its box — a modal close ✕, a dismiss, a standalone
 * destructive glyph. 44x44 is the platform comfort target (Apple HIG 44pt,
 * Material 48dp) and is what every glyph control should reach when the layout
 * has room for it.
 */
export const TAP_TARGET = 'inline-flex items-center justify-center w-11 h-11';

/**
 * A LONE glyph inside a dense row that must not grow — a remove ✕ at the end of
 * a settings row, a per-item delete beside an input. Same real 44x44 hit area,
 * but `-m-2` lets the box overflow its slot by 8px on every side, so it
 * contributes only 28px of layout: less than the padded text row it sits in
 * already is. Use it only where the glyph has no adjacent glyph sibling — two of
 * these side by side would OVERLAP their hit areas, which trades a small target
 * for a mis-tap.
 */
export const TAP_INLINE = 'inline-flex items-center justify-center w-11 h-11 -m-2';

/**
 * A glyph in a row (or column) of ADJACENT glyph controls — the ↑ ↓ ✕ trio on an
 * ordering row or a media item. A documented exception to the 44px target, taken
 * deliberately: three 44px boxes plus their gaps is 148px, which on a 375px phone
 * would leave the row's own text input under 150px and push the thing being
 * edited off the useful part of the screen. 36x36 still clears the WCAG 2.2 AA
 * floor (24x24 CSS px) with half again to spare, and the siblings are separated
 * by the 8px minimum spacing (`gap-2`) so the enlarged areas cannot merge into
 * one ambiguous strip.
 *
 * Pair it with `gap-2` on the container — the spacing is half the rule.
 */
export const TAP_CLUSTER = 'inline-flex items-center justify-center w-9 h-9';
