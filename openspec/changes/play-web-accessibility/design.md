## Context

`apps/play-web` has no component test runner (CLAUDE.md: "UI → verify via the preview tools"), and a
live playtest stack owns this machine, so **no browser and no device verification was possible for
this change**. Everything here is therefore either (a) provable from the source text, or (b) a
mechanical guard that keeps it proven.

What is already sound and must not be re-litigated:

- `components/dialog.tsx` is a correct modal: `role="alertdialog"`, `aria-modal`, focus moved to the
  confirm control on open, focus restored when the queue drains, Escape resolving exactly as Cancel.
- `lib/confetti.ts:13` and `lib/haptics.ts:16` both check `prefers-reduced-motion`; `index.css:64`
  has the global reduced-motion block; the eight `animate-*` call sites all carry
  `motion-reduce:animate-none`.
- `lib/interaction.ts` already exports `TAP_TARGET`/`TAP_PAD`, and `TaskRunner`'s hint, navigate and
  ordering controls, `Collapsible` in `ui.tsx`, the `Header` leave button and `JoinScreen`'s
  remove-member button are all at or above 44px with `aria-label`s.
- RTL is in good shape: a repo-wide scan for physical direction utilities in `apps/play-web/src`
  returns exactly two hits, and one of them (`JoinScreen.tsx:176` `left-1/2 -translate-x-1/2`) is a
  symmetric centring idiom that is correct in both directions.
- Colour is not the only state signal: `Progress` (`ui.tsx:83`) adds a numeric readout and a dashed
  border under `colorblind`.

## Goals / Non-Goals

**Goals.** Make every glyph a participant must read outdoors meet WCAG AA; give every input an
accessible name; keep fixed chrome and the page shell out from under the notch and home indicator;
bring the last sub-44px controls up; keep pinch zoom; and leave behind a guard so the three
mechanically detectable regressions cannot come back.

**Non-Goals.** No component restructuring. No new user-facing copy (and therefore no dictionary
edit — `apps/play-web/src/i18n.ts` is being edited by other lanes). No change to `apps/creator-web`,
`functions/`, `packages/shared` or any rules file. No attempt to *measure* rendered pixels or verify
in a browser — the estimates in the proposal are derived from Tailwind's own type scale
(`text-xs` = 12px/16px line, `text-[11px]` at the default 1.5 ratio, `py-1` = 4px, `py-1.5` = 6px,
`py-2` = 8px) and are stated as such.

## Decisions

**1. New `ink-*` text tokens instead of retuning `accent`/`rp-fire`.**
`accent` and `rp-fire` are the same `#FF5722` and are used as `bg-`, `border-`, gradient stop and
ring colour as well as `text-`. Darkening the token itself would repaint every fill and every glow
in the app. Tailwind generates `text-x` and `bg-x` from one token, so the only way to darken text
without touching fills is a **second token used only for text**. Five are added, one per failing
brand colour, each verified ≥ 4.5:1 against all three surfaces:

| token | hex | vs `#FFFFFF` | vs `#FFFCF7` | vs `#FFF0E6` | replaces |
|---|---|---|---|---|---|
| `ink-fire` | `#B03A0B` | 6.08 | 5.95 | 5.46 | `text-accent`, `text-rp-fire` (3.16) |
| `ink-warm` | `#8A4B00` | 6.80 | 6.66 | 6.11 | `text-accent-warm` (2.36) |
| `ink-amber` | `#7A5200` | 6.92 | 6.78 | 6.21 | `text-rp-amber` (1.79) |
| `ink-alert` | `#C21414` | 6.17 | 6.04 | 5.54 | `text-rp-alert` (3.76) |
| `ink-go` | `#067A55` | 5.35 | 5.24 | 4.81 | `text-rp-go` (2.54) |

The two `bg-accent text-white` surfaces (`MapModeToggle`'s active pill, `PlayScreen`'s power-up
toast) are white-on-`#FF5722` = 3.16:1 and become `bg-ink-fire text-white` = 6.08:1. `bg-accent
text-black` (`StaffConsole.tsx:409`) is already 6.60:1 and is left alone.

**2. Replacement is by `text-`-anchored token swap, not by rewriting components.**
The swap is `text-accent(?![-\w]) → text-ink-fire` and friends, restricted to `apps/play-web/src`.
It cannot touch `bg-`, `border-`, `ring-`, `from-`, `to-` or the `accent` JS variable used in
`style={{ color: accent }}` (creator-chosen branding, which is out of our control and out of scope).

**3. Safe area as named CSS utilities, not arbitrary Tailwind values.**
`env()` inside a Tailwind arbitrary value needs underscore escaping and is easy to typo into
nothing. Four rules in `index.css`, declared after `@tailwind utilities` so they win at equal
specificity, are legible and greppable:

```css
.rp-safe-b     { padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px)); }
.rp-safe-top-0 { top: env(safe-area-inset-top, 0px); }
.rp-safe-top-3 { top: calc(0.75rem + env(safe-area-inset-top, 0px)); }
.rp-safe-top-8 { top: calc(2rem + env(safe-area-inset-top, 0px)); }
```

`Screen` keeps `pt-6` and takes `rp-safe-b`; the offline banner, power-up toast and reconnect pill
take the matching `rp-safe-top-*`. `JoinScreen`'s step-1 shell (which does not use `Screen`) takes
`rp-safe-b` too — it is the only screen a player reaches before the run.

**4. Accessible names come from copy that already exists.**
`aria-label={t.task.yourAnswer}`, `{t.task.enterNumber}`, `{label}` (the station-code prompt the
creator authored), `{t.task.surveyPlaceholder}`, `{t.join.codePlaceholder}` — each is the string the
field already renders as its placeholder, so the name and the visible text agree (WCAG 2.5.3) and
**zero dictionary keys are added**. `FieldInput` gets `useId()` + `htmlFor`/`id` so its existing
visible `<label>` becomes both a programmatic name and a second tap target.

**5. The guard detects three things, and only three.**
Tap-target size and contrast-in-context cannot be decided from a class string without a layout
engine (`min-h-[44px]` on a `hidden` element, a padded parent, a `Button` wrapper), so trying would
produce noise. The guard restricts itself to what is decidable from the token text:

- **physical direction utilities** — `ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right` appearing as a Tailwind class, with an explicit allowlist for the symmetric
  centring idiom (`left-1/2` paired with `-translate-x-1/2`) and for non-class occurrences
  (`overflow-x`, `rounded-lg`, prose in comments);
- **icon-only buttons** — a `<button>` whose text content is only emoji/symbols/whitespace and which
  has no `aria-label`, `aria-labelledby` or `title`;
- **`onClick` on a non-interactive element** — `div|span|li|p|img|section|article` carrying
  `onClick` without `role="button"` + `tabIndex` + a key handler.

Plus a fourth, arithmetic assertion: the `ink-*` tokens parsed out of `tailwind.config.js` are
recomputed against the three surfaces and must clear 4.5:1. That one is a real oracle, not a
heuristic — it stops a future "brand refresh" from quietly re-breaking sunlight legibility.

**6. Scanners live in `scripts/lib/playA11yScan.ts`, not in the test file.**
Same shape as `scripts/lib/emulatorBackup.mjs`: pure, total functions taking `(source, filename)`
and returning findings, so the fixtures in the test are synthetic strings and the test never depends
on the current state of the app. It is a `.ts` file under `scripts/lib/`, which
`run-unit-tests.mjs` does not enumerate (it globs `scripts/test-*.ts` at the top level only).

## Risks / Trade-offs

- **The app looks slightly darker.** `#B03A0B` is a burnt orange where `#FF5722` was a bright one.
  Mitigated by leaving every fill, border, ring and gradient on the original brand colour — only
  glyphs change — and by the fact that unreadable is worse than duller.
- **The guard could fire on legitimate code.** Mitigated by testing every scanner against
  must-not-flag fixtures, by the `left-1/2` allowlist, and by keeping the rules narrow enough that a
  true positive is always an actual defect.
- **`maximum-scale=1` was presumably there to stop double-tap zoom on iOS.** Modern iOS honours
  `touch-action` and the app already sets `-webkit-tap-highlight-color: transparent`; blocking zoom
  outright is a WCAG failure and the wrong trade for the older-relative audience.
- **Safe-area padding is invisible on a device without insets** (`env()` resolves to `0px`), so the
  desktop and Android-without-cutout rendering is byte-identical to today.

## Test Strategy

Lane: **pure logic** (`scripts/test-play-a11y-scan.ts`, run by `scripts/run-unit-tests.mjs` under
`npm test`). No emulator. House style: `ok(cond, msg)`, `passed`/`failed` counters, `process.exit`.

**A. `findPhysicalDirectionClasses(source, file)` — synthetic fixtures**
- flags: `className="ml-2"`, `"pr-3"`, `"text-left"`, `"absolute left-2"`, `"border-l"`,
  `"sm:pl-4"`, `"hover:mr-1"`.
- must NOT flag: `"ms-2 me-3 ps-1 pe-1 start-2 end-4 text-start text-end"`, `"rounded-lg"`,
  `"overflow-x-auto"`, `"grid-rows-2"`, the word "left" in a comment or in a string of prose,
  `dir="rtl"`, and the symmetric `"left-1/2 -translate-x-1/2"` idiom.
- reports the offending class and a 1-based line number.

**B. `findUnlabelledIconButtons(source, file)`**
- flags: `<button onClick={x}>✕</button>`, `<button className="…">▾</button>`,
  a button whose only child is an emoji plus whitespace.
- must NOT flag: a button with `aria-label`, with `aria-labelledby`, with `title`, one whose text is
  `📖 {t.play.howToPlay}` (has an expression child), one with plain word text, one with
  `{children}`, or a self-closing `<Button …/>` component (capitalised — not a DOM button).

**C. `findClickableNonInteractive(source, file)`**
- flags: `<div onClick={go}>`, `<span onClick={go} className="x">`, `<li onClick={go}>`.
- must NOT flag: `<button onClick>`, `<a onClick>`, `<Card onClick>` (capitalised component),
  `<div role="button" tabIndex={0} onClick={go} onKeyDown={k}>`, `<input onChange>`.

**D. `contrastRatio(fg, bg)` + the ink-token oracle**
- known values: `#000000`/`#FFFFFF` = 21, identical colours = 1, and the five ink tokens ≥ 4.5
  against `#FFFFFF`, `#FFFCF7` and `#FFF0E6`, both argument orders (the ratio is symmetric).
- regression pins: `#FF5722` on `#FFFFFF` computes to 3.16 and `#FFB300` on `#FFF0E6` to 1.61 — the
  two numbers this change exists because of. If those ever change, the formula changed.

**D2. `findLowContrastWhiteOnFill(source, tokens, file, min)` — the mirror of D**

D fixed *coloured text on a light surface*. Re-reading the primary participant paths surfaced the
case the guard had no rule for: *white text on a saturated brand fill*. It is decidable for exactly
the same reason D is: both colours are named in one class string and both resolve through
`tailwind.config.js`. To stay a guard rather than a nag it is narrow by construction.
- flags: `"bg-rp-alert text-white"` (3.76:1), `"bg-accent … text-white"` (3.16:1),
  `"bg-rp-amber text-white"`, `"bg-rp-go text-white"`.
- must NOT flag: the darkened `"bg-ink-alert text-white"` / `"bg-ink-fire text-white"`; the tint
  idiom `"bg-accent/15 text-ink-fire"` and `"bg-rp-alert/10 text-ink-alert"` (a translucent tint is
  never a white-text surface, and its effective colour is not decidable from the token); the primary
  `Button`'s `"bg-gradient-to-r from-[#C2410C] to-[#B45309] text-white"` (the real colours live in
  `from-`/`to-`, and both already clear AA at 5.18 / 5.02); `"bg-accent text-zinc-100"` (no white
  text); an unresolvable token; an empty token map (skip, never guess).
- regression pins: `#EF4444` on white = 3.76 (below AA), `#C21414` on white = 6.17 (clears).

**D3. `TAP_INLINE`** (`scripts/test-touch-a11y.ts`) — `TAP_PAD`'s `p-2 -m-2` only reaches ~32px
around a `text-xs` glyph, still under the minimum. `TAP_INLINE` is asserted to be static, to carry
`min-w-[44px]`/`min-h-[44px]`, to centre its glyph, to keep `-m-2` so the surrounding row does not
grow, and to contain no physical-direction class.

**E. Whole-app assertions** (the guard doing its actual job)
- running all four scanners over every `apps/play-web/src/**/*.tsx` yields zero findings;
- `tailwind.config.js` defines all five `ink-*` tokens;
- `index.css` contains `env(safe-area-inset-bottom)` and `env(safe-area-inset-top)`;
- `index.html`'s viewport meta contains `viewport-fit=cover` and **not** `maximum-scale`.

**RED expectation.** Before any fix, E must fail on `MapModeToggle.tsx` (`left-2`),
`CeremonyScreen.tsx` (`<div onClick>`), on the missing ink tokens, on the missing safe-area rules
and on `maximum-scale=1`.

**Gates.** `npm run typecheck`, `npm run lint`, `npm test`, `npm run play:build`,
`npm run creator:build`, `npm run bundle:budget`, `npm run i18n:check:strict`. `npm run e2e` and the
emulator gauntlets are deliberately not run: this change touches no callable and the emulator is
owned by a live stack.
