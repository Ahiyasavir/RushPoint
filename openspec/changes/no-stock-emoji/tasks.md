# Tasks: no-stock-emoji

Source: Ahiya 2026-10-02. Guard: `scripts/test-no-stock-emoji.ts` (ratchet, started at 284 / 277).

## 1. RED
- [x] 1.1 Set both ceilings in `scripts/test-no-stock-emoji.ts` to 0 and add `packages/shared` reaction
      rendering to the expectations. Confirm RED (561).

## 2. GREEN
- [x] 2.1 Icon sets: extend creator-web `builderIcons.tsx`; add play-web `components/Icons.tsx`.
- [x] 2.2 Dictionaries: strip emoji from both apps' `i18n.ts` (HE and EN stay parity matched).
- [x] 2.3 creator-web components and pages (icon tables, EmptyState, SettingRow, prefixes).
- [x] 2.4 play-web screens and components (prefixes, medals, badges, how-it-works, survey scale).
- [x] 2.5 Reactions: render `FEED_EMOJIS` / `REACTION_EMOJI` keys as drawn icons; keys unchanged.
- [x] 2.6 Canvas share images: shapes instead of emoji glyphs.

## 3. Verify
- [x] 3.1 Guard at 0 for both apps; i18n strict; a11y / tap-target / brand-class scans.
- [ ] 3.2 Browser pass over the busiest screens (Builder, Run Console, staff app, play screen, final).
      DONE: Builder, Run Console (1280), staff app (375), play screen countdown, icon gallery reviewed.
      NOT SEEN live: the final / ceremony / TV screens and the canvas share images (typecheck and unit
      tests only).
- [x] 3.3 `npm run verify` (exit code to a file).
