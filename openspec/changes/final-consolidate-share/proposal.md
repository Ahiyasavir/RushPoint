## Why

The participant FinalScreen (`apps/play-web/src/screens/FinalScreen.tsx`) presents "share my result"
as **three separately-styled controls at three scroll positions**:

- the primary **story-card** share `<Button onClick={share}>` on the recap card,
- a **"share a photo"** text button directly under it (rendered only when `firstPhotoUrl` exists),
- a **"share the podium"** ghost button lower down, inside the podium card (rendered only when
  `podium.length > 0`).

The finisher's intent is one thing ("share my result"), but the surface scatters it as three
unrelated affordances a player meets at three different points down the screen. This is presentation
clutter on the most emotionally loaded screen in the product.

## What Changes

- **Consolidate the share affordances into one place on the recap card.** Keep the primary button as
  the story-card share. Directly beneath it, add a single compact **"more ways to share"** row that
  exposes the still-available variants (share a photo, share the podium) — instead of one button
  under the recap and another buried in the podium card.
- Each variant appears in that row **only when its output exists** (photo only when `firstPhotoUrl`;
  podium only when `podium.length > 0`), exactly as today. When neither variant applies, only the
  primary button shows.

Presentational only: same three share functions, same outputs, gathered into one clear cluster.

## What does NOT change

- **All three outputs stay available.** Story card (`share`), photo card (`sharePhotoFn`) and podium
  card (`sharePodiumFn`) are all still reachable — the callbacks are unchanged; only where their
  triggers live moves. Ability preserved: the story/photo/podium share paths, now grouped on the
  recap card instead of split between the recap and the podium card.
- **The podium card itself is untouched** except for the removal of its embedded share button — the
  1-2-3 reveal, medals, names and scores render exactly as before.
- **No change to share behaviour, `busy`/`shared` state, or confirmation copy** — this change is
  purely where the triggers are placed. (Note: the concurrent `finish-moment-polish` change edits the
  same file's share confirmation/badge/sound behaviour; this change must be layout-only and must not
  alter those semantics — see design.md.)
- **No new i18n strings.** Reuses the existing `final.shareBtn` / `final.sharePhoto` /
  `final.sharePodium` / `final.shareCreating` / `final.shareSaved` keys.
- No backend, no callable, no server change.

## Impact

- `apps/play-web` — `src/screens/FinalScreen.tsx` only (move the photo + podium share triggers into a
  single "more ways to share" row on the recap card; drop the podium card's embedded share button).
- **Not touched:** `functions/`, `packages/shared`, `apps/creator-web`, `src/i18n.ts` (existing keys
  reused), `src/lib/storyCard.ts` (share outputs unchanged).
