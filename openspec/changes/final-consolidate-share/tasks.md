# Tasks — final-consolidate-share

UI lane (play-web has no component test runner). One file; no i18n edit (existing keys reused).
Shares `FinalScreen.tsx` with `finish-moment-polish` — keep this change layout-only.

## Implement

- [x] 1. **Add the "more ways to share" row on the recap card** — in
      `apps/play-web/src/screens/FinalScreen.tsx`, directly under the primary `share` `<Button>` on the
      recap card, render a single row containing the applicable secondary triggers: the photo trigger
      (`sharePhotoFn`, `t.final.sharePhoto`) when `firstPhotoUrl`, and the podium trigger
      (`sharePodiumFn`, `t.final.sharePodium`) when `podium.length > 0`. Keep `disabled={busy}` and the
      existing callbacks; reuse the existing secondary-button styling. (design.md §The fix)
- [x] 2. **Remove the podium card's embedded share button** — delete the
      `<Button variant="ghost" … onClick={sharePodiumFn}>{t.final.sharePodium}</Button>` inside the
      `podium.length > 0` card; leave the rest of the podium card unchanged. (design.md §The fix)
- [x] 3. **Keep the standalone photo button out** — the old photo `<button>` under the recap primary
      is now part of the consolidated row, not a separate element. Ensure there is exactly one photo
      trigger and one podium trigger on the screen. (design.md §Current state / §The fix)

## Verify (build lane — this agent)

- [ ] 4. `npm run verify` (typecheck · lint · test · creator:build · play:build · bundle:budget ·
      base:check · i18n:check:strict) — green. No new i18n key, so parity + PART B are unchanged.
- [ ] 5. `npx openspec validate final-consolidate-share --strict` — passes.

## Manual (parent / owner — UNVERIFIED here)

- [ ] 6. Finish with a photo and a podium → recap card shows the primary share plus one row exposing
      photo + podium share; podium card has no share button; each trigger produces its card. Finish
      with no photo/no podium → only the primary share button shows.
