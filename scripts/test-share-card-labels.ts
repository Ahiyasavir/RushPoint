// ─────────────────────────────────────────────────────────────────────────────
// Participant share-card label mapping (change: localized-share-cards).
//
// The branded story / podium share images are the viral artifact a player posts
// to WhatsApp/Instagram. They used to hard-code English ('FINISHED!', 'POINTS',
// 'RANK'/'TIME'/'STAGES', 'Build your own field game', '🏆 Podium'), so a Hebrew
// player shared an all-English image to the exact audience most likely to
// convert. `shareCardLabels(finalDict, isTimeOnly)` is the ONE pure function that
// maps the play-web `final` dictionary (current language) + the scoring preset
// onto the localized label set the canvas consumes.
//
// This suite pins the (preset, language) -> label mapping against the REAL `he`
// and `en` `final` slices, including the finding #4 fix: a `time_only` result's
// hero label is the TIME token, never the POINTS token.
//
// Pure — no emulator, no DOM, no canvas. Auto-discovered by
// scripts/run-unit-tests.mjs, so `npm test` runs it.
//   npx tsx scripts/test-share-card-labels.ts
// ─────────────────────────────────────────────────────────────────────────────
import { translations } from '../apps/play-web/src/i18n';
import { shareCardLabels, type ShareCardDict } from '../apps/play-web/src/lib/shareCardLabels';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m  ${msg}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}${detail ? '\n        ' + detail : ''}`);
  }
}
function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

const HEBREW = /[֐-׿]/;
const LATIN = /[A-Za-z]/;

// The `final` slice carries far more than the card keys; the helper only reads
// the ShareCardDict subset, and TS proves each app dictionary supplies it.
const he: ShareCardDict = translations.he.final;
const en: ShareCardDict = translations.en.final;

console.log('\n\x1b[1m🎴 share-card label mapping\x1b[0m');

// ── finding #4 — the time_only hero label is TIME, not POINTS ─────────────────
section('time_only hero label is the TIME token (finding #4)');
for (const [lang, d] of [['he', he], ['en', en]] as const) {
  const labels = shareCardLabels(d, true);
  ok(labels.scoreLabel === d.cardTime, `${lang}: time_only scoreLabel === cardTime`,
    `got "${labels.scoreLabel}" want "${d.cardTime}"`);
  ok(labels.scoreLabel !== d.cardPoints, `${lang}: time_only scoreLabel is NOT the POINTS token`,
    `got "${labels.scoreLabel}"`);
}

// ── points-based preset keeps the POINTS hero label ──────────────────────────
section('points-based hero label is the POINTS token');
for (const [lang, d] of [['he', he], ['en', en]] as const) {
  const labels = shareCardLabels(d, false);
  ok(labels.scoreLabel === d.cardPoints, `${lang}: points scoreLabel === cardPoints`,
    `got "${labels.scoreLabel}" want "${d.cardPoints}"`);
}

// ── every label routes through the dictionary (both presets) ─────────────────
section('all labels come from the dictionary, chips/cta/podium preset-agnostic');
for (const isTimeOnly of [true, false]) {
  for (const [lang, d] of [['he', he], ['en', en]] as const) {
    const labels = shareCardLabels(d, isTimeOnly);
    ok(labels.headline === d.cardHeadline, `${lang} (timeOnly=${isTimeOnly}): headline === cardHeadline`);
    ok(labels.rankLabel === d.cardRank, `${lang} (timeOnly=${isTimeOnly}): rankLabel === cardRank`);
    ok(labels.timeLabel === d.cardTime, `${lang} (timeOnly=${isTimeOnly}): timeLabel === cardTime`);
    ok(labels.stagesLabel === d.cardStages, `${lang} (timeOnly=${isTimeOnly}): stagesLabel === cardStages`);
    ok(labels.ctaText === d.cardCta, `${lang} (timeOnly=${isTimeOnly}): ctaText === cardCta`);
    ok(labels.podiumTitle === `🏆 ${d.cardPodium}`, `${lang} (timeOnly=${isTimeOnly}): podiumTitle is "🏆 " + cardPodium`);
    ok(labels.podiumTitle.startsWith('🏆 '), `${lang} (timeOnly=${isTimeOnly}): podiumTitle starts with the trophy`);
  }
}

// ── each language really is that language ─────────────────────────────────────
section('HE returns Hebrew tokens, EN returns English tokens');
{
  const heL = shareCardLabels(he, false);
  ok(HEBREW.test(heL.headline), 'he: headline is Hebrew');
  ok(HEBREW.test(heL.ctaText), 'he: cta is Hebrew');
  ok(HEBREW.test(heL.podiumTitle), 'he: podiumTitle contains Hebrew (after the trophy)');

  const enL = shareCardLabels(en, false);
  ok(LATIN.test(enL.headline) && !HEBREW.test(enL.headline), 'en: headline is English');
  ok(LATIN.test(enL.ctaText) && !HEBREW.test(enL.ctaText), 'en: cta is English');
  ok(LATIN.test(enL.podiumTitle) && !HEBREW.test(enL.podiumTitle), 'en: podiumTitle is English');
}

console.log(
  `\n${failed === 0 ? `\x1b[32m✓ ALL ${passed} SHARE-CARD LABEL ASSERTIONS PASSED\x1b[0m` : `\x1b[31m✗ ${failed} of ${passed + failed} ASSERTION(S) FAILED\x1b[0m`}\n`,
);
process.exit(failed === 0 ? 0 : 1);
