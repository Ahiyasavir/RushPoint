## Why

RushPoint is Hebrew-default in its primary market, but every canvas share card a participant posts to
WhatsApp/Instagram hard-codes English:

- `apps/play-web/src/lib/storyCard.ts` — the headline `'FINISHED!'` (`:64`), the score label
  `'POINTS'` (`:90`), the chip labels `'RANK'` / `'TIME'` / `'STAGES'` (`:94-96`), and the CTA
  tagline `'Build your own field game'` (`:120`).
- `apps/play-web/src/lib/podiumCard.ts` — the title `'🏆 Podium'` (`:39`).

A Hebrew player who finishes and shares posts an **all-English image** to the exact audience most
likely to convert. The share *caption* is already bilingual (`i18n.ts:298`), so the image/caption
mismatch is jarring.

Compounding it, the story card **mislabels a `time_only` result**. On screen a `time_only` game
correctly makes the finish TIME the hero and suppresses the points number
(`apps/play-web/src/screens/FinalScreen.tsx:169-175`). But `share()` builds the card with
`score: finalScore` and the default `'POINTS'` label (`FinalScreen.tsx:135-144`; `storyCard.ts:87-90`).
For a `time_only` game `finalScore` is just a completion-bonus integer, so the most-shared artifact
shows a small meaningless number labeled POINTS with the real result relegated to a TIME chip.

## What Changes

- Localize the participant share cards so the image matches the player's current language (HE and EN):
  the story card's headline, score/hero label, chip labels (rank/time/stages) and CTA tagline, and the
  podium card's title SHALL be passed in as localized strings by the caller (which already has `t` /
  `lang`, `FinalScreen.tsx:30`).
- Extend `StoryCardData` with optional label overrides (`rankLabel`, `timeLabel`, `stagesLabel`,
  `ctaText`, plus a `heroValue` for the big number) alongside the existing `headline` / `scoreLabel`.
  Extend `buildPodiumCard` / `sharePodium` opts with an optional `title`. Every default stays the
  current English literal, so nothing regresses if a caller omits a field.
- Fix the `time_only` mislabel as part of the same card-labeling surface: for a `time_only` game the
  card's hero SHALL be the finish TIME with a TIME-style (localized) label, not the points integer
  labeled POINTS. For points-based presets the card keeps the points hero and label.
- Add a small pure helper `shareCardLabels(finalDict, isTimeOnly)` that assembles the localized label
  set (choosing the time vs points label by preset) from the play-web `final` dictionary, unit-tested
  for both languages and both preset families.
- Add the card label strings to the play-web `final` dictionary in HE + EN (dash-free, natural
  Hebrew) as the single source, and thread them through the callers.

## What does NOT change

- **The cards stay lazy.** `storyCard` / `podiumCard` remain behind the existing dynamic `import()`
  (`FinalScreen.tsx:92, :135`); the new label helper is a tiny dependency-free module and MUST NOT
  import the canvas modules, so `npm run bundle:budget` stays green (no heavy code re-entering the
  entry chunk).
- The QR + logo + human URL brand stamp and the native-share → download → clipboard fallback ladder
  are untouched.
- English cards for English players remain identical (the localized EN strings equal today's
  literals).
- `recapCollage.ts` is NOT changed: its only literal is the language-neutral `🏁` emoji prefixed to
  the caller-supplied game title (`recapCollage.ts:38`) — no hardcoded English UI label to fix.

## Impact

- Affected specs: `localized-share-cards` (new capability, requirements ADDED).
- Affected code: `apps/play-web/src/lib/storyCard.ts` (optional label/hero fields + defaults),
  `apps/play-web/src/lib/podiumCard.ts` (optional `title`), a new
  `apps/play-web/src/lib/shareCardLabels.ts` (pure), `apps/play-web/src/screens/FinalScreen.tsx`
  (thread localized labels + `heroValue` for time_only), `apps/play-web/src/i18n.ts` (new `final.card*`
  keys in HE + EN), and a new `scripts/test-share-card-labels.ts` (auto-discovered by the aggregator).
- NOT touched: the server, the brand stamp, the fallback ladder, `recapCollage.ts`.
