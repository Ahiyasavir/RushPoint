## Context

`StoryCardData` already accepts two override fields (`apps/play-web/src/lib/storyCard.ts:6-16`):

```ts
export interface StoryCardData {
  gameName: string; teamName: string; score: number;
  rank?: number; totalTime?: string; stagesDone?: string; ctaUrl: string;
  headline?: string;    // defaults to FINISHED!
  scoreLabel?: string;  // defaults to POINTS
}
```

The hardcoded literals in `buildStoryCard`:

- `:64` `const headline = data.headline ?? 'FINISHED!';`
- `:87` `ctx.fillText(String(data.score), W / 2, 1170);` — the big hero number.
- `:90` `ctx.fillText(data.scoreLabel ?? 'POINTS', W / 2, 1240);`
- `:94-96` `chips.push(['RANK', …]); chips.push(['TIME', …]); chips.push(['STAGES', …]);`
- `:120` `ctx.fillText('Build your own field game', W / 2, 1690);`

`buildPodiumCard` (`podiumCard.ts:22-43`): `:39` `ctx.fillText('🏆 Podium', W / 2, 110);`

Callers on the finish screen (`FinalScreen.tsx`): `share()` builds `StoryCardData` at `:135-144` and
`sharePodiumFn()` calls `sharePodium(...)` at `:92-100`. Both have `const { t, lang } = useT();`
(`:30`) in scope. `isTimeOnly = game.scoringPreset === 'time_only'` (`:44`), and the finish TIME is
`totalSec` → `fmtDuration(totalSec)` (`:50-53, :15-20`). The share caption is already localized via
`t.final.shareText` (`:128-134`).

Lib files are NOT scanned by the `t.*` i18n gate (PART B), so adding new keys and threading them is
net-new with no PART B regression; PART A still hard-gates the new dictionary entries.

## Goals / Non-Goals

**Goals:**
- A Hebrew player shares a Hebrew image; an English player's image is unchanged.
- The story card's hero + label match the scoring preset (time vs points), fixing the `time_only`
  mislabel.
- The card label mapping is a pure, unit-tested function.

**Non-Goals:**
- Changing the brand stamp, QR target, or the share fallback ladder.
- Touching `recapCollage.ts` (no hardcoded English label there).
- Moving canvas code into the entry chunk (cards stay lazy).

## Decisions

### D1 — Optional label + hero overrides on the card data (back-compatible)

Extend `StoryCardData` with optional fields; every default stays today's English literal:

```ts
heroValue?: string;   // overrides the big number (used for time_only finish time)
rankLabel?: string;   // default 'RANK'
timeLabel?: string;   // default 'TIME'
stagesLabel?: string; // default 'STAGES'
ctaText?: string;     // default 'Build your own field game'
```

In `buildStoryCard`: draw `data.heroValue ?? String(data.score)` for the hero (`:87`); use
`data.rankLabel ?? 'RANK'`, `data.timeLabel ?? 'TIME'`, `data.stagesLabel ?? 'STAGES'` for the chips
(`:94-96`); use `data.ctaText ?? 'Build your own field game'` for the tagline (`:120`). `headline` and
`scoreLabel` already have this shape.

`buildPodiumCard` / `sharePodium` gain an optional `title?: string` in their opts; `:39` draws
`opts.title ?? '🏆 Podium'`.

### D2 — A pure label-set helper, sourced from the dictionary, preset-aware

New `apps/play-web/src/lib/shareCardLabels.ts`:

```ts
// Structural slice of the play-web `final` dictionary — no import of storyCard/podiumCard.
export interface ShareCardDict {
  cardHeadline: string; cardPoints: string; cardTime: string;
  cardRank: string; cardStages: string; cardCta: string; cardPodium: string;
}
export interface ShareCardLabels {
  headline: string; scoreLabel: string;
  rankLabel: string; timeLabel: string; stagesLabel: string;
  ctaText: string; podiumTitle: string;
}
export function shareCardLabels(d: ShareCardDict, isTimeOnly: boolean): ShareCardLabels {
  return {
    headline: d.cardHeadline,
    scoreLabel: isTimeOnly ? d.cardTime : d.cardPoints, // ← the time_only fix
    rankLabel: d.cardRank,
    timeLabel: d.cardTime,
    stagesLabel: d.cardStages,
    ctaText: d.cardCta,
    podiumTitle: `🏆 ${d.cardPodium}`,
  };
}
```

Pure and dependency-free, so it is safe to import eagerly in `FinalScreen` without pulling in the
canvas modules — the cards themselves stay behind their existing dynamic `import()`.

### D3 — New dictionary keys (HE + EN), dash-free

Add to the `final` block in BOTH dictionaries (`apps/play-web/src/i18n.ts`):

| key | HE | EN |
|---|---|---|
| `cardHeadline` | `סיימנו!` | `FINISHED!` |
| `cardPoints` | `נקודות` | `POINTS` |
| `cardTime` | `זמן` | `TIME` |
| `cardRank` | `מקום` | `RANK` |
| `cardStages` | `שלבים` | `STAGES` |
| `cardCta` | `בנו משחק שדה משלכם` | `Build your own field game` |
| `cardPodium` | `פודיום` | `Podium` |

EN values equal today's literals so English cards are byte-identical. No em-dashes; Hebrew is Hebrew
and English is English so the shared leak predicate / PART A stays clean.

### D4 — Thread labels + time hero from `FinalScreen`

In `share()` (`:135-144`), spread the label set and add the time hero for `time_only`:

```ts
const labels = shareCardLabels(t.final, isTimeOnly);
const result = await shareStoryCard({
  gameName: name, teamName: team.displayName,
  score: finalScore,
  heroValue: isTimeOnly ? (totalSec != null ? fmtDuration(totalSec) : undefined) : undefined,
  rank: myRank,
  totalTime: totalSec != null ? fmtDuration(totalSec) : undefined,
  stagesDone: `${completedStages.length}/${team.stages.length}`,
  ctaUrl: creatorUrl(),
  headline: labels.headline, scoreLabel: labels.scoreLabel,
  rankLabel: labels.rankLabel, timeLabel: labels.timeLabel, stagesLabel: labels.stagesLabel,
  ctaText: labels.ctaText,
}, text);
```

In `sharePodiumFn()` (`:92-100`), pass `title: shareCardLabels(t.final, isTimeOnly).podiumTitle` into
the `sharePodium` opts.

For `time_only`, the hero becomes the finish time with the localized TIME label; the TIME chip still
carries the same duration (acceptable redundancy — the hero is the headline result, the chip is the
recap row) and RANK/STAGES chips are unchanged.

## Risks / Trade-offs

- **Hebrew glyph rendering on canvas.** Centered text (`ctx.textAlign = 'center'`) renders pure-Hebrew
  strings correctly without bidi reflow; all localized labels here are single-language tokens, so no
  mixed-direction shaping is needed.
- **Bundle budget.** The label helper is dependency-free and does not import the canvas modules; the
  cards remain lazy. `npm run bundle:budget` must stay green (verify after `play:build`).
- **A caller that omits a field** still renders the English default — no crash, graceful degradation.

## Test Strategy

- **Pure unit test — `scripts/test-share-card-labels.ts`** (auto-discovered by the `npm test`
  aggregator). Import the real `he` and `en` `final` slices from `apps/play-web/src/i18n.ts` and
  `shareCardLabels`, and assert:
  - `isTimeOnly === true` ⇒ `scoreLabel === d.cardTime` (the time_only fix), for both languages;
  - `isTimeOnly === false` ⇒ `scoreLabel === d.cardPoints`, for both languages;
  - HE returns the Hebrew tokens and EN returns the English tokens (headline / cta / podiumTitle);
  - `podiumTitle` starts with `🏆 `.
- **UI lane:** `npm run typecheck` · `npm run lint` · `npm run play:build` · `npm run creator:build`
  · `npm run bundle:budget` (cards stay lazy) · `npm run i18n:check:strict` (PART A clean, zero new
  PART B warnings) — all green.
- **Manual visual check (flagged, not a gate):** in Hebrew, finish a points game and a `time_only`
  game, share each, and confirm the image is Hebrew and the `time_only` card shows the finish TIME as
  the hero with a Hebrew time label (not a stray number labeled POINTS); repeat in English and confirm
  the image is unchanged from today.

## RTL / i18n notes

Hebrew is the default. All new strings route through the `final` dictionary (single source), are pure
single-language tokens (no leak), and contain no em-dashes. The canvas centers text, so Hebrew renders
without directional artifacts. Lib files are outside the PART B scan, so no new hardcoded-string
warning is introduced.
