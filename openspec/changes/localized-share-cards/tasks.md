## 1. RED — the pure label helper + its test

- [x] 1.1 Add `apps/play-web/src/lib/shareCardLabels.ts` with `ShareCardDict`, `ShareCardLabels`, and
      `shareCardLabels(d, isTimeOnly)` per the design (dependency-free; MUST NOT import
      `storyCard`/`podiumCard`). The score label is `isTimeOnly ? d.cardTime : d.cardPoints`.
- [x] 1.2 Add `scripts/test-share-card-labels.ts` (auto-discovered by the `npm test` aggregator):
      import the real `he`/`en` `final` slices from `apps/play-web/src/i18n.ts` and assert time_only ⇒
      `scoreLabel === cardTime`, points ⇒ `scoreLabel === cardPoints`, HE returns Hebrew tokens, EN
      returns English tokens, and `podiumTitle` starts with `🏆 `.
- [x] 1.3 Run `npm test` and confirm the new test FAILS first (missing keys / helper) — RED.

## 2. GREEN — dictionary keys

- [x] 2.1 Add `cardHeadline`, `cardPoints`, `cardTime`, `cardRank`, `cardStages`, `cardCta`,
      `cardPodium` to the `final` block in BOTH dictionaries in `apps/play-web/src/i18n.ts` (values per
      the design table; dash-free; Hebrew in Hebrew, English in English).
- [x] 2.2 Run `npm test` — the label test now PASSES. Run `npm run i18n:check:strict` — PART A clean.

## 3. GREEN — card renderers accept localized labels

- [x] 3.1 In `apps/play-web/src/lib/storyCard.ts`, extend `StoryCardData` with optional `heroValue`,
      `rankLabel`, `timeLabel`, `stagesLabel`, `ctaText`. In `buildStoryCard`: draw
      `data.heroValue ?? String(data.score)` for the hero; `data.rankLabel ?? 'RANK'` /
      `data.timeLabel ?? 'TIME'` / `data.stagesLabel ?? 'STAGES'` for the chips; and
      `data.ctaText ?? 'Build your own field game'` for the tagline. `headline`/`scoreLabel` defaults
      stay.
- [x] 3.2 In `apps/play-web/src/lib/podiumCard.ts`, add optional `title` to `buildPodiumCard` /
      `sharePodium` opts and draw `opts.title ?? '🏆 Podium'`.

## 4. GREEN — thread from FinalScreen (incl. the time_only hero fix)

- [x] 4.1 In `FinalScreen.tsx` `share()`, compute `const labels = shareCardLabels(t.final, isTimeOnly)`
      and pass `headline`, `scoreLabel`, `rankLabel`, `timeLabel`, `stagesLabel`, `ctaText`, plus
      `heroValue: isTimeOnly ? (totalSec != null ? fmtDuration(totalSec) : undefined) : undefined`
      into the `shareStoryCard` data.
- [x] 4.2 In `sharePodiumFn()`, pass `title: shareCardLabels(t.final, isTimeOnly).podiumTitle` into the
      `sharePodium` opts.
- [x] 4.3 Confirm `shareCardLabels` is imported eagerly (small, pure) while `storyCard`/`podiumCard`
      stay behind their existing dynamic `import()`.

## 5. Gates

- [x] 5.1 `npm run typecheck` — green.
- [x] 5.2 `npm run lint` — 0 errors.
- [x] 5.3 `npm test` — the label test passes (and all others).
- [x] 5.4 `npm run play:build` then `npm run bundle:budget` — green (cards still lazy; no canvas code
      in the entry chunk). `npm run creator:build` — green.
- [x] 5.5 `npm run i18n:check:strict` — PART A clean, zero new PART B warnings.
- [x] 5.6 Flag the manual visual check (not a gate): Hebrew points card + Hebrew `time_only` card share
      as Hebrew images, the `time_only` hero is the finish TIME with a Hebrew label (not a number
      labeled POINTS); English images unchanged.

## 6. REFACTOR

- [x] 6.1 Confirm the preset→label decision lives ONLY in `shareCardLabels` (single source), and every
      card default remains the current English literal for back-compat.
