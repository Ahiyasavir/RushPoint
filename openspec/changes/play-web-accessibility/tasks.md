## 1. RED — the static guard first

- [ ] 1.1 Create `scripts/lib/playA11yScan.ts` exporting the pure scanners
      `findPhysicalDirectionClasses`, `findUnlabelledIconButtons`, `findClickableNonInteractive`,
      `contrastRatio` and `playWebTsxFiles` — total functions over `(source, file)`, no filesystem
      access inside the scanners themselves.
- [ ] 1.2 Create `scripts/test-play-a11y-scan.ts` in the house style of
      `scripts/test-touch-a11y.ts` (`ok(cond, msg)`, `passed`/`failed`, `process.exit`).
- [ ] 1.3 Encode Test Strategy sections A, B and C as synthetic fixtures, each with its
      must-NOT-flag counterpart, so the guard cannot become a false-positive machine.
- [ ] 1.4 Encode section D: `contrastRatio` known values, symmetry, the five `ink-*` tokens parsed
      out of `apps/play-web/tailwind.config.js` clearing 4.5:1 on all three surfaces, and the two
      regression pins (`#FF5722` on white = 3.16, `#FFB300` on `#FFF0E6` = 1.61).
- [ ] 1.5 Encode section E: all three scanners over every `apps/play-web/src/**/*.tsx` yield zero
      findings; `tailwind.config.js` defines the ink tokens; `index.css` carries the safe-area
      rules; the viewport meta keeps `viewport-fit=cover` and drops `maximum-scale`.
- [ ] 1.6 Run `npx tsx scripts/test-play-a11y-scan.ts` and confirm it FAILS for the right reasons
      (`left-2`, `<div onClick>`, missing ink tokens, missing safe area, `maximum-scale=1`).
      Record the failure verbatim.

## 2. GREEN — contrast

- [ ] 2.1 Add `ink-fire #B03A0B`, `ink-warm #8A4B00`, `ink-amber #7A5200`, `ink-alert #C21414`,
      `ink-go #067A55` to `apps/play-web/tailwind.config.js`.
- [ ] 2.2 Swap the failing text utilities across `apps/play-web/src/**` only, anchored on `text-`
      so no fill, border, ring or gradient changes: `text-accent`/`text-rp-fire` → `text-ink-fire`,
      `text-accent-warm` → `text-ink-warm`, `text-rp-amber` → `text-ink-amber`,
      `text-rp-alert` → `text-ink-alert`, `text-rp-go` → `text-ink-go`.
- [ ] 2.3 Replace `text-zinc-600` with `text-zinc-500` wherever it carries text (including
      `placeholder:text-zinc-600` in `ui.tsx` and `TaskRunner.tsx`), and
      `placeholder:text-zinc-700/40` in `JoinScreen.tsx` with `placeholder:text-zinc-500`.
- [ ] 2.4 Change the two white-on-`accent` surfaces (`MapModeToggle` active pill, `PlayScreen`
      power-up toast) to `bg-ink-fire text-white`.

## 3. GREEN — viewport, safe area, touch targets

- [ ] 3.1 Drop `maximum-scale=1` from `apps/play-web/index.html`'s viewport meta, keeping
      `viewport-fit=cover`.
- [ ] 3.2 Add `.rp-safe-b`, `.rp-safe-top-0`, `.rp-safe-top-3`, `.rp-safe-top-8` to
      `apps/play-web/src/index.css`, after the `@tailwind` directives.
- [ ] 3.3 Apply them: `Screen` (`ui.tsx`) and `JoinScreen`'s step-1 shell take `rp-safe-b`;
      `ConnectionBanner`, `PowerUpToast` and `ReconnectingPill` take the matching `rp-safe-top-*`.
- [ ] 3.4 Bring the sub-44px controls to `min-h-[44px]`: `MapModeToggle`'s two mode buttons,
      `TaskRunner`'s geofence request-help button, `PlayScreen`'s How-to-play chip, `JoinScreen`'s
      add-member / language-switch / staff / create-attach-tab controls, `FinalScreen`'s
      share-photo button.
- [ ] 3.5 Change `MapModeToggle`'s `left-2` to the logical `start-2`.

## 4. GREEN — semantics, keyboard, motion

- [ ] 4.1 Give every entry field an `aria-label` drawn from the copy it already renders: quiz text,
      numeric, station code, survey textarea (`TaskRunner.tsx`) and the access-code field
      (`JoinScreen.tsx`). No new dictionary keys.
- [ ] 4.2 Associate `FieldInput`'s `<label>` with its input/select via `useId()` + `htmlFor`/`id`.
- [ ] 4.3 `CodeEntry` submits on Enter and requests an uppercase, uncorrected, `enterKeyHint="go"`
      keyboard.
- [ ] 4.4 `CeremonyScreen`'s confetti canvas returns early under `prefers-reduced-motion`.
- [ ] 4.5 Replace `CeremonyScreen`'s `<div onClick>` advance surface with a real keyboard-operable
      control.
- [ ] 4.6 Re-run `npx tsx scripts/test-play-a11y-scan.ts` — all green.

## 5. REFACTOR / gates

- [ ] 5.1 Re-read `apps/play-web/src/i18n.ts` and confirm this change added nothing to it.
- [ ] 5.2 `npm run typecheck`
- [ ] 5.3 `npm run lint`
- [ ] 5.4 `npm test`
- [ ] 5.5 `npm run play:build`
- [ ] 5.6 `npm run creator:build`
- [ ] 5.7 `npm run bundle:budget`
- [ ] 5.8 `npm run i18n:check:strict`
- [ ] 5.9 Record in the report that NO browser or device verification was possible (a live playtest
      stack owns this machine), and which findings therefore remain estimates rather than
      measurements.
