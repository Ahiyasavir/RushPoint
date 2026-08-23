## 1. Plainer opt-in chip labels

- [x] 1.1 In `apps/creator-web/src/i18n.ts`, update the EN and HE values for `chipSetTimerPoints`,
      `groupTimerPoints`, `chipRules` and `groupRules` to the plain, content-accurate wording from
      design.md's table (chip and its group title get the SAME string). Leave `chipAddHint` and
      `hintField` untouched. Do not rename any KEY, only its value. No dashes or hyphens in the new
      copy (the repo's no-dash standard applies).
- [x] 1.2 Run `npx tsx scripts/test-no-dashes.ts` and `npm run i18n:check:strict`; confirm both
      pass with the new labels (PART A parity/purity green, no new PART B findings).
- [x] 1.3 Verify via the preview tools: open a mission's wizard step 3, confirm the chip row shows
      the new labels, click each renamed chip and confirm the opened group's title matches the chip
      that opened it. Check both EN and HE.

## 2. Responsive Builder header

- [x] 2.1 In `apps/creator-web/src/pages/BuilderPage.tsx`, import `useIsMobile` from
      `../hooks/useMediaQuery` and branch the header's secondary controls on it: at mobile width,
      render undo, redo, export, import and the secondary "test run" launch action as items inside a
      single `OverflowMenu`; above mobile width, render today's markup unchanged. Keep the hidden
      `<input type="file">` mounted regardless of width so the import flow is unaffected.
- [x] 2.2 Add EN + HE i18n keys for the new mobile overflow menu's trigger label and `aria-label`
      (reuse existing action labels such as `b.undo`, `b.redo`, `b.exportFile`, `b.importFile` and
      `b.launchTestRun` for the items themselves rather than duplicating them).
- [x] 2.3 Keep the primary controls directly on the bar at every width: back, title, save status,
      tab strip, readiness, primary launch. Confirm none of them moved into the menu.
- [x] 2.4 Verify via the preview tools at phone width (<= 639px): confirm the header does not
      overflow horizontally, the tab strip is still usable, the overflow menu opens on-screen
      (not clipped), and each collapsed action still works, including import opening a file picker.
      Check both LTR (EN) and RTL (HE).
- [x] 2.5 Verify via the preview tools at tablet and desktop widths: confirm the header is
      byte-for-byte the same experience as before this change (undo/redo, File menu and both launch
      buttons directly on the bar).

## 3. Gate sweep

- [x] 3.1 Run `npm run typecheck` — all workspaces pass.
- [x] 3.2 Run `npm run lint` — 0 errors.
- [x] 3.3 Run `npm test` — full aggregator + vitest pass (including `test-no-dashes.ts` and
      `test-mediaquery.ts`; no new pure-logic test expected per design.md decision 5).
- [x] 3.4 Run `npm run creator:build` — passes.
- [x] 3.5 Run `npm run i18n:check:strict` — clean, zero new PART B warnings, PART A green.
- [x] 3.6 Run `npm run e2e` — regression check only (this change makes no callable changes). Use the
      port-offset lane if another emulator is live:
      `RUSHPOINT_EMULATOR_PORT_OFFSET=1000 node scripts/emulator-exec.mjs "node scripts/e2e-verify.mjs"`.
- [x] 3.7 Run the full `npm run verify` gauntlet and confirm all green before considering the
      change done.
