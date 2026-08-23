## 1. RED — the static guard first

- [x] 1.1 Create `scripts/lib/playA11yScan.ts` exporting the pure scanners
      `findPhysicalDirectionClasses`, `findUnlabelledIconButtons`, `findClickableNonInteractive`,
      `contrastRatio` and `playWebTsxFiles` — total functions over `(source, file)`, no filesystem
      access inside the scanners themselves.
- [x] 1.2 Create `scripts/test-play-a11y-scan.ts` in the house style of
      `scripts/test-touch-a11y.ts` (`ok(cond, msg)`, `passed`/`failed`, `process.exit`).
- [x] 1.3 Encode Test Strategy sections A, B and C as synthetic fixtures, each with its
      must-NOT-flag counterpart, so the guard cannot become a false-positive machine.
- [x] 1.4 Encode section D: `contrastRatio` known values, symmetry, the five `ink-*` tokens parsed
      out of `apps/play-web/tailwind.config.js` clearing 4.5:1 on all three surfaces, and the two
      regression pins (`#FF5722` on white = 3.16, `#FFB300` on `#FFF0E6` = 1.61).
- [x] 1.5 Encode section E: all three scanners over every `apps/play-web/src/**/*.tsx` yield zero
      findings; `tailwind.config.js` defines the ink tokens; `index.css` carries the safe-area
      rules; the viewport meta keeps `viewport-fit=cover` and drops `maximum-scale`.
- [x] 1.6 Run `npx tsx scripts/test-play-a11y-scan.ts` and confirm it FAILS for the right reasons
      (`left-2`, `<div onClick>`, missing ink tokens, missing safe area, `maximum-scale=1`).
      Record the failure verbatim.

## 2. GREEN — contrast

- [x] 2.1 Add `ink-fire #B03A0B`, `ink-warm #8A4B00`, `ink-amber #7A5200`, `ink-alert #C21414`,
      `ink-go #067A55` to `apps/play-web/tailwind.config.js`.
- [x] 2.2 Swap the failing text utilities across `apps/play-web/src/**` only, anchored on `text-`
      so no fill, border, ring or gradient changes: `text-accent`/`text-rp-fire` → `text-ink-fire`,
      `text-accent-warm` → `text-ink-warm`, `text-rp-amber` → `text-ink-amber`,
      `text-rp-alert` → `text-ink-alert`, `text-rp-go` → `text-ink-go`.
- [x] 2.3 Replace `text-zinc-600` with `text-zinc-500` wherever it carries text (including
      `placeholder:text-zinc-600` in `ui.tsx` and `TaskRunner.tsx`), and
      `placeholder:text-zinc-700/40` in `JoinScreen.tsx` with `placeholder:text-zinc-500`.
- [x] 2.4 Change the two white-on-`accent` surfaces (`MapModeToggle` active pill, `PlayScreen`
      power-up toast) to `bg-ink-fire text-white`.

## 3. GREEN — viewport, safe area, touch targets

- [x] 3.1 Drop `maximum-scale=1` from `apps/play-web/index.html`'s viewport meta, keeping
      `viewport-fit=cover`.
- [x] 3.2 Add `.rp-safe-b`, `.rp-safe-top-0`, `.rp-safe-top-3`, `.rp-safe-top-8` to
      `apps/play-web/src/index.css`, after the `@tailwind` directives.
- [x] 3.3 Apply them: `Screen` (`ui.tsx`) and `JoinScreen`'s step-1 shell take `rp-safe-b`;
      `ConnectionBanner`, `PowerUpToast` and `ReconnectingPill` take the matching `rp-safe-top-*`.
- [x] 3.4 Bring the sub-44px controls to `min-h-[44px]`: `MapModeToggle`'s two mode buttons,
      `TaskRunner`'s geofence request-help button, `PlayScreen`'s How-to-play chip, `JoinScreen`'s
      add-member / language-switch / staff / create-attach-tab controls, `FinalScreen`'s
      share-photo button.
- [x] 3.5 Change `MapModeToggle`'s `left-2` to the logical `start-2`.

## 4. GREEN — semantics, keyboard, motion

- [x] 4.1 Give every entry field an `aria-label` drawn from the copy it already renders: quiz text,
      numeric, station code, survey textarea (`TaskRunner.tsx`) and the access-code field
      (`JoinScreen.tsx`). No new dictionary keys.
- [x] 4.2 Associate `FieldInput`'s `<label>` with its input/select via `useId()` + `htmlFor`/`id`.
- [x] 4.3 `CodeEntry` submits on Enter and requests an uppercase, uncorrected, `enterKeyHint="go"`
      keyboard.
- [x] 4.4 `CeremonyScreen`'s confetti canvas returns early under `prefers-reduced-motion`.
- [x] 4.5 Replace `CeremonyScreen`'s `<div onClick>` advance surface with a real keyboard-operable
      control.
- [x] 4.6 Re-run `npx tsx scripts/test-play-a11y-scan.ts` — all green.

## 5. REFACTOR / gates

- [x] 5.1 Re-read `apps/play-web/src/i18n.ts` and confirm this change added nothing to it.
- [x] 5.2 `npm run typecheck`
- [x] 5.3 `npm run lint`
- [x] 5.4 `npm test`
- [x] 5.5 `npm run play:build`
- [x] 5.6 `npm run creator:build`
- [x] 5.7 `npm run bundle:budget`
- [x] 5.8 `npm run i18n:check:strict`
- [x] 5.9 Record in the report that NO browser or device verification was possible (a live playtest
      stack owns this machine), and which findings therefore remain estimates rather than
      measurements.

## 6. Second pass — the defect class the guard could not see

The first pass fixed COLOURED TEXT ON A SURFACE. Re-running the guard by hand over the primary
participant paths surfaced the mirror case it had no rule for: WHITE TEXT ON A BRAND FILL.

- [x] 6.1 RED: add `findLowContrastWhiteOnFill(source, tokens, file, min)` to
      `scripts/lib/playA11yScan.ts` and its fixtures to `scripts/test-play-a11y-scan.ts` — four
      must-flag cases and nine must-NOT-flag counterparts (the `bg-accent/15` tint idiom, the
      `bg-gradient-to-r from-[#C2410C]` primary Button, an unresolvable token, an empty token map).
      Confirm it fails naming ONLY real defects.
- [x] 6.2 GREEN: `Button`'s `danger` variant `bg-rp-alert` → `bg-ink-alert` (3.76 → 6.17:1). This is
      the confirm control of every destructive dialog: leaving a run, SOS.
- [x] 6.3 GREEN: `ChatPanel`'s send button `bg-accent` → `bg-ink-fire` (3.16 → 6.08:1), plus
      `min-h-[44px]` (it was ~36px).
- [x] 6.4 GREEN: `PlayScreen`'s unread-chat badge `bg-accent` → `bg-ink-fire`.
- [x] 6.5 RED→GREEN: add `TAP_INLINE` to `apps/play-web/src/lib/interaction.ts` with assertions in
      `scripts/test-touch-a11y.ts`. `TAP_PAD` only reaches ~32px around a `text-xs` glyph; this
      reaches a real 44x44 while keeping the row height.
- [x] 6.6 GREEN: apply `TAP_INLINE` to `LiveOps`' two announcement dismiss controls (~32px), and
      `min-h-[44px]` to `PlayScreen`'s trackable drop/pick-up and territory-capture buttons (~24px,
      tapped mid-run while walking) and `PostGameSurvey`'s dismiss (~16px) and skip controls.
- [x] 6.7 Re-run both guards, then the gates.
