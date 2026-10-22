// Mission quality: a rating, learned from creators (changes: composer-v2-quality, composer-v2-learning).
//
// The founder: "תקדם משימות חזקות ותשים משימות חלשות כברירה אחרונה, ובכל זאת ... רנדומליות" and
// "תלמד על בסיס כמה היוצרים אוהבים את המשימות". Every bank mission has a 1-5 rating from his own
// review history. The rating is the PRIOR, worth PRIOR_STRENGTH observations (not 50%: the lesson of
// Roblox's cold-start paper); creators' keep / swap counts are the evidence; the composer and
// regenerate add a bonus from the posterior mean. Sampling inside the near-best band is the
// randomness, so the best missions win more often, never always.
//   npx tsx scripts/test-mission-quality.ts
import {
  BANK_QUALITY, PRIOR_STRENGTH, QUALITY_WEIGHT, priorFor, posteriorMean, qualityBonus, qualityOf, parseMissionStats,
} from '../apps/creator-web/src/lib/missionQuality';
import { composeGame, seededRng, type ComposerAnswers, type ComposerDescriptionCopy } from '../apps/creator-web/src/lib/composeGame';
import { chooseRegeneratedMission, regenerateContext } from '../apps/creator-web/src/lib/regenerateMission';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';

let failures = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── The ratings ─────────────────────────────────────────────────────────────
const missing = TASK_BANK.filter((e) => !(e.key in BANK_QUALITY)).map((e) => e.key);
ok('every bank mission is rated', missing.length === 0, missing.join(', '));
ok('every rating is 1 to 5', Object.values(BANK_QUALITY).every((q) => Number.isInteger(q) && q >= 1 && q <= 5));
const stale = Object.keys(BANK_QUALITY).filter((k) => !TASK_BANK.some((e) => e.key === k));
ok('no rating for a mission that is gone', stale.length === 0, stale.join(', '));
ok('his praised missions are 5', BANK_QUALITY['four-things'] === 5 && BANK_QUALITY['agent-in-crowd'] === 5);

// ── Prior and posterior ─────────────────────────────────────────────────────
ok('the prior rises with the rating', [1, 2, 3, 4, 5].every((q, i, a) => i === 0 || priorFor(q) > priorFor(a[i - 1])));
ok('a 3 is neutral', qualityBonus(priorFor(3)) === 0);
ok('the bonus is bounded by QUALITY_WEIGHT', [0, 0.1, 0.5, 0.9, 1].every((p) => Math.abs(qualityBonus(p)) <= QUALITY_WEIGHT + 1e-9));
ok('no evidence: the posterior is the prior', posteriorMean(4) === priorFor(4) && posteriorMean(4, { kept: 0, swapped: 0 }) === priorFor(4));
ok('the prior is worth PRIOR_STRENGTH observations', PRIOR_STRENGTH === 10
  && Math.abs(posteriorMean(3, { kept: 10, swapped: 0 }) - (PRIOR_STRENGTH * priorFor(3) + 10) / (PRIOR_STRENGTH + 10)) < 1e-9);
ok('creators who keep a weak mission lift it', posteriorMean(2, { kept: 40, swapped: 2 }) > priorFor(4));
ok('creators who keep swapping a strong one sink it', posteriorMean(5, { kept: 2, swapped: 40 }) < priorFor(2));
ok('a handful of signals does not overturn the rating', posteriorMean(5, { kept: 0, swapped: 2 }) > priorFor(4));
ok('garbage evidence is ignored', posteriorMean(4, { kept: -5, swapped: NaN } as never) === priorFor(4) && qualityOf('nope') === priorFor(3));

ok('the stats document parses to counts', JSON.stringify(parseMissionStats({ counts: { a: { kept: 3 }, b: { swapped: 2, kept: 'x' } } }))
  === JSON.stringify({ a: { kept: 3, swapped: 0 }, b: { kept: 0, swapped: 2 } }));
ok('a broken stats document reads as no evidence', [null, {}, { counts: 5 }, 'x'].every((d) => JSON.stringify(parseMissionStats(d)) === '{}'));

// ── The composer prefers strong missions, and still varies ──────────────────
const COPY: ComposerDescriptionCopy = {
  lead: () => 'L', ageLabel: (b) => b, ageTag: (b) => b, durationTag: (m) => `${m}`, composedLead: () => 'C',
  activityPhrase: (t) => t, activityJoin: (x) => x.join(','), activityTag: (t) => t, placeMissionPrompt: () => 'P',
};
const byTitle = new Map(TASK_BANK.map((e) => { try { return [e.build().title, e.key] as const; } catch { return ['', ''] as const; } }));
let sumOn = 0, sumOff = 0, nOn = 0, nOff = 0, sameDraws = true;
const gamesSeen = new Set<string>();
for (const audience of ['youth', 'adults', 'mixed', 'kids'] as const) {
  for (let seed = 1; seed <= 15; seed++) {
    const a = { minutes: 120, audience, setting: 'outdoor', difficultyPreference: 'balanced', people: 20, ageBandId: 'band-14-17' } as ComposerAnswers;
    let d1 = 0, d2 = 0;
    const r1 = seededRng(seed), r2 = seededRng(seed);
    const on = composeGame(TASK_BANK, a, COPY, () => { d1++; return r1(); }, { recentBankKeys: [] });
    const off = composeGame(TASK_BANK, a, COPY, () => { d2++; return r2(); }, { recentBankKeys: [] }, { quality: false });
    if (d1 !== d2) sameDraws = false;
    for (const t of on?.stages.flatMap((s) => s.tasks) ?? []) { sumOn += BANK_QUALITY[byTitle.get(t.title) ?? ''] ?? 3; nOn++; }
    for (const t of off?.stages.flatMap((s) => s.tasks) ?? []) { sumOff += BANK_QUALITY[byTitle.get(t.title) ?? ''] ?? 3; nOff++; }
    if (on && audience === 'youth') gamesSeen.add(on.stages.flatMap((s) => s.tasks.map((t) => t.title)).join('|'));
  }
}
ok('quality costs no extra random draws', sameDraws);
ok('composed games hold stronger missions on average', sumOn / nOn > sumOff / nOff, `${(sumOn / nOn).toFixed(2)} vs ${(sumOff / nOff).toFixed(2)}`);
ok('the same answers still give different games (randomness kept)', gamesSeen.size >= 12, `${gamesSeen.size} of 15`);

// Learned evidence flows through the composer.
const weak = TASK_BANK.find((e) => BANK_QUALITY[e.key] === 3 && e.tags.includes('youth') && e.tags.includes('outdoor') && !e.occasions && !e.tags.includes('start') && !e.tags.includes('finish'))!;
let withLove = 0, without = 0;
for (let seed = 1; seed <= 30; seed++) {
  const a = { minutes: 120, audience: 'youth', setting: 'outdoor', difficultyPreference: 'balanced', people: 20, ageBandId: 'band-14-17' } as ComposerAnswers;
  const has = (g: ReturnType<typeof composeGame>) => (g?.stages ?? []).some((s) => s.tasks.some((t) => byTitle.get(t.title) === weak.key));
  if (has(composeGame(TASK_BANK, a, COPY, seededRng(seed), { recentBankKeys: [] }, { missionStats: { [weak.key]: { kept: 60, swapped: 0 } } }))) withLove++;
  if (has(composeGame(TASK_BANK, a, COPY, seededRng(seed), { recentBankKeys: [] }))) without++;
}
ok('a mission creators keep is offered more', withLove > without, `${withLove} vs ${without} of 30`);

// ── Regenerate prefers strong missions too ──────────────────────────────────
const outgoing = TASK_BANK.find((e) => e.tags.includes('camera') && !e.occasions)!.build();
let qOn = 0, qOff = 0;
for (let seed = 1; seed <= 60; seed++) {
  const base = { bank: TASK_BANK, profile: ['camera'] as never, context: regenerateContext(null), drift: 0, offeredKeys: [], seed };
  qOn += BANK_QUALITY[chooseRegeneratedMission(base)?.key ?? ''] ?? 3;
  qOff += BANK_QUALITY[chooseRegeneratedMission({ ...base, quality: false })?.key ?? ''] ?? 3;
}
ok('regenerate offers stronger missions on average', qOn > qOff, `${(qOn / 60).toFixed(2)} vs ${(qOff / 60).toFixed(2)}`);
void outgoing;

console.log(failures === 0 ? '\n✅ mission quality: ALL PASS' : `\n❌ mission quality: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
