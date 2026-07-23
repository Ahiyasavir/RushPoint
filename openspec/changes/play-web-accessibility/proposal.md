## Why

`apps/play-web` is used **outdoors, walking, one handed, in bright sunlight**, frequently in Hebrew,
often by children or older relatives at a family event. A previous pass
(`play-touch-rtl-a11y`, commit `fefebaf`) fixed the dialog semantics, the ordering controls and the
biggest touch targets. A fresh static sweep of `apps/play-web/src/**` found a second, different
class of defect that pass did not cover: **colour**, **the viewport/safe area**, and a handful of
controls that were added after it.

Every number below was computed from the resolved hex values in `apps/play-web/tailwind.config.js`
against the surfaces those glyphs actually sit on (`app-surface`/`app-card` `#FFFFFF`, `app-bg`
`#FFFCF7`, `app-raised` `#FFF0E6`), using the WCAG 2.1 relative-luminance formula.

1. **The brand ink fails AA everywhere it is used as text.** `accent`/`rp-fire` `#FF5722` is
   **3.16:1** on white; `accent-warm` `#FF8A00` is **2.36:1**; `rp-amber` `#FFB300` is **1.79:1** on
   white and **1.61:1** on `app-raised`; `rp-alert` `#EF4444` is **3.76:1**; `rp-go` `#10B981` is
   **2.54:1**. AA wants 4.5:1 for body text. These are not decorative: they are the **live score**
   (`PlayScreen.tsx:978` `text-xs … text-accent font-mono`), the **paid-hint affordance** for a
   stuck player (`TaskRunner.tsx:692,813` `text-xs text-accent-warm`), the **test-run banner**
   (`PlayScreen.tsx:458` `text-sm font-semibold text-rp-amber` on `app-raised` = **1.61:1**), and
   the **GPS-failure message** (`TaskRunner.tsx:1192` `text-sm text-rp-alert`). In direct sun a
   2:1 glyph is not "low contrast", it is invisible.
2. **`text-zinc-600` is 2.52:1 and is the placeholder colour of every input.**
   `ui.tsx:57` and `TaskRunner.tsx:1032` set `placeholder:text-zinc-600` (`#a8a29e` on `#FFFFFF` =
   **2.52:1**); `JoinScreen.tsx:248` is worse still (`placeholder:text-zinc-700/40`, `#d6d3d1` at
   40% alpha). Since **no input in the app has a label or an `aria-label`**, that unreadable
   placeholder is the *only* thing telling the player what to type, and it disappears on first
   keystroke.
3. **`viewport-fit=cover` is set with no `env(safe-area-inset-*)` anywhere in the app.**
   `apps/play-web/index.html:5` opts the PWA into the display cutout, and a repo-wide search for
   `env(safe-area-inset` returns **zero** hits. The offline banner (`ConnectionBanner.tsx:25`
   `fixed top-0`), the power-up toast (`PlayScreen.tsx:1011` `fixed … top-3`) and the reconnect pill
   (`PlayScreen.tsx:543` `fixed top-8`) render under the notch/status bar, and `Screen`
   (`ui.tsx:113` `py-6`) ends 24px from the physical bottom, putting the **SOS button**
   (`PlayScreen.tsx:528`) under the home indicator on an installed iOS PWA.
4. **`maximum-scale=1` blocks pinch zoom** (`index.html:5`). An older relative cannot magnify the
   clue text. This is a WCAG 1.4.4 failure and a one-token fix.
5. **Controls added after the last pass are under 44px.** The map topo/satellite switch
   (`MapModeToggle.tsx:23` `px-2.5 py-1 text-[11px]` ⇒ ~24px tall), the geofence **"request help"**
   escape hatch that is a stuck player's only way out (`TaskRunner.tsx:1182` `text-xs … px-3 py-1.5`
   ⇒ ~28px), the in-run **"How to play"** re-read chip (`PlayScreen.tsx:653` `px-3 py-1 text-xs`
   ⇒ ~26px), **"add member"** at join (`JoinScreen.tsx:439` `text-sm mt-1`, no padding ⇒ ~20px), the
   language switch (`JoinScreen.tsx:228` `px-3 py-1`, sitting between two correct 44px siblings) and
   the create/attach tabs (`JoinScreen.tsx:350` `py-2 text-sm` ⇒ 36px).
6. **The station-code field is the only answer input with no Enter handler.** `CodeEntry`
   (`TaskRunner.tsx:939`) has no `onKeyDown`, while quiz text (`:1001`), numeric (`:1084`) and
   sequence (`:1241`) all submit on Enter. With the on-screen keyboard open, the "verify" button is
   the part of the page most likely to be covered.
7. **The ceremony confetti ignores `prefers-reduced-motion`** (`CeremonyScreen.tsx:255-299`), unlike
   `lib/confetti.ts:13` which checks it.
8. **`CeremonyScreen.tsx:123` puts `onClick` on a `<div>`** (`cursor-pointer select-none`), so
   advancing the ceremony is mouse/touch only.
9. **`MapModeToggle.tsx:13` uses the physical `left-2`** where the rest of the app has already moved
   to logical `start-`/`end-` classes.

## What Changes

**Colour: a set of AA-safe "ink" tokens for text, leaving every fill and border alone.**
Add `ink-fire #B03A0B` (6.08:1 on white), `ink-warm #8A4B00` (6.80:1), `ink-amber #7A5200`
(6.92:1), `ink-alert #C21414` (6.17:1) and `ink-go #067A55` (5.35:1) to
`apps/play-web/tailwind.config.js`, and swap only the `text-*` / `hover:text-*` utilities that used
the failing brand colours. `bg-accent`, `border-accent`, `bg-rp-fire/15` and the gradients are
untouched, so the app looks like itself; only the glyphs get dark enough to read in sun.
`text-zinc-600` (2.52:1) is replaced by `text-zinc-500` (4.80:1) wherever it carries text, including
every placeholder.

**Inputs get a real accessible name.** Every answer/entry field carries an `aria-label` built from
the copy it already shows, and `JoinScreen`'s `FieldInput` associates its `<label>` with its control
via `htmlFor`/`id`. **No new user-facing copy is introduced** — the existing `t.*` strings are
reused, so the Hebrew and English dictionaries are unchanged.

**Safe area.** Three CSS utilities in `index.css` (`.rp-safe-b`, `.rp-safe-top-0`,
`.rp-safe-top-3`, `.rp-safe-top-8`) fold `env(safe-area-inset-*)` into the padding/offset of the
page shell and the three fixed overlays. `maximum-scale=1` is dropped from the viewport meta.

**Touch targets.** The controls listed above reach a 44px minimum height, using the existing
`min-h-[44px]` idiom already used across `TaskRunner`.

**Keyboard and motion.** `CodeEntry` submits on Enter (and asks for an uppercase, uncorrected
keyboard); the ceremony confetti bails under `prefers-reduced-motion`; the ceremony advance surface
becomes a real `<button>`; `left-2` becomes `start-2`.

**A durable static guard.** `scripts/lib/playA11yScan.ts` holds pure scanners and
`scripts/test-play-a11y-scan.ts` (picked up by `scripts/run-unit-tests.mjs`, so it runs in
`npm test`) fails the build on three mechanically detectable regressions in `apps/play-web/src/**` —
a physical-direction Tailwind class, an icon-only button with no accessible name, and an `onClick`
on a non-interactive element — plus a contrast assertion on the ink tokens themselves. The scanners
are unit-tested against synthetic fixtures **including cases that must not flag**, so the guard
cannot become a false-positive machine.

## Impact

- Affected specs: `play-web-accessibility` (new).
- Affected code: `apps/play-web/tailwind.config.js`, `apps/play-web/index.html`,
  `apps/play-web/src/index.css`, `apps/play-web/src/components/{ui,TaskRunner,MapModeToggle}.tsx`,
  `apps/play-web/src/screens/{JoinScreen,PlayScreen,FinalScreen,CeremonyScreen}.tsx` plus the
  mechanical colour-token swap across `apps/play-web/src/**`,
  `scripts/lib/playA11yScan.ts` (new), `scripts/test-play-a11y-scan.ts` (new).
- No backend, no Firestore, no callable, no emulator. No i18n dictionary change.
- Out of scope: anything requiring a device or a browser to verify (rendered pixel measurement,
  real VoiceOver/TalkBack passes, actual sunlight legibility). This change is bounded to what is
  provable from the source.
