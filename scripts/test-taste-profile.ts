// The creator's taste profile (change: composer-v2-taste).
//
// Every regenerate is a "not this kind" signal about the mission swapped away, and every mission
// still in a game at launch is a "yes, this kind". The founder asked for the profile to be as small
// as possible while carrying a lot ("כמה שיותר מתומצת ובכל זאת יתן הרבה מאוד מידע"): one signed
// 4-bit value per tag, in a fixed order, with decay, written as a short versioned string.
//   npx tsx scripts/test-taste-profile.ts
import {
  TASTE_TAG_IDS, TASTE_VERSION, TASTE_MAX, TASTE_WEIGHT,
  emptyTaste, encodeTaste, decodeTaste, recordTaste, recordTasteMany, tasteAffinity, tasteTagsForTask,
  tasteKey, readTaste, writeTaste,
} from '../apps/creator-web/src/lib/tasteProfile';
import { composeGame, seededRng, type ComposerAnswers, type ComposerDescriptionCopy } from '../apps/creator-web/src/lib/composeGame';
import { chooseRegeneratedMission, regenerateContext } from '../apps/creator-web/src/lib/regenerateMission';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { ACTIVITY_TAG_IDS, MECHANIC_TAG_IDS } from '../apps/creator-web/src/bankTags';

let failures = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── The vocabulary and the encoding ─────────────────────────────────────────
ok('taste covers every activity and mechanic tag, in a fixed order',
  TASTE_TAG_IDS.length === ACTIVITY_TAG_IDS.length + MECHANIC_TAG_IDS.length
  && [...ACTIVITY_TAG_IDS, ...MECHANIC_TAG_IDS].every((t, i) => TASTE_TAG_IDS[i] === t));
const v = emptyTaste().map((_, i) => ((i * 5) % (2 * TASTE_MAX + 1)) - TASTE_MAX);
const enc = encodeTaste(v);
ok('the encoding is versioned', enc.startsWith(`${TASTE_VERSION}:`));
ok('every value from -7 to 7 survives a round trip', JSON.stringify(decodeTaste(enc)) === JSON.stringify(v));
ok('a whole profile is under 48 characters', enc.length < 48, `${enc.length} chars: ${enc}`);
ok('an empty profile is all zeros', emptyTaste().every((x) => x === 0) && decodeTaste(encodeTaste(emptyTaste())).every((x) => x === 0));
ok('garbage decodes to an empty profile, never a throw',
  [null, undefined, '', 'x', 't9:AAAA', 't1:!!!', 42, {}].every((g) => {
    try { const d = decodeTaste(g as never); return d.length === TASTE_TAG_IDS.length && d.every((x) => x === 0); } catch { return false; }
  }));
ok('the encoding is URL and storage safe', /^[A-Za-z0-9:_-]+$/.test(enc));

// ── Learning ────────────────────────────────────────────────────────────────
let p = encodeTaste(emptyTaste());
for (let i = 0; i < 3; i++) p = recordTaste(p, ['strangers', 'dare'], -1);
p = recordTaste(p, ['puzzle', 'thinking'], 1);
ok('a swapped-away kind turns negative', tasteAffinity(p, ['strangers']) < 0);
ok('a kept kind turns positive', tasteAffinity(p, ['puzzle']) > 0);
ok('an unseen kind stays neutral', tasteAffinity(p, ['nature']) === 0);
ok('affinity is bounded to [-1, 1]', [['strangers'], ['puzzle'], ['strangers', 'puzzle'], []]
  .every((t) => { const a = tasteAffinity(p, t as never); return a >= -1 && a <= 1; }));
let sat = encodeTaste(emptyTaste());
for (let i = 0; i < 50; i++) sat = recordTaste(sat, ['hunt'], 1);
ok('values saturate at the maximum', decodeTaste(sat)[TASTE_TAG_IDS.indexOf('hunt')] === TASTE_MAX);
let fading = recordTaste(encodeTaste(emptyTaste()), ['music'], 1);
for (let i = 0; i < 40; i++) fading = recordTaste(fading, ['hunt'], 1);
ok('old taste fades as new signals arrive', decodeTaste(fading)[TASTE_TAG_IDS.indexOf('music')] === 0);
ok('tags outside the vocabulary are ignored', recordTaste(encodeTaste(emptyTaste()), ['youth', 'easy', 'nope'] as never, 1) === encodeTaste(emptyTaste()));

// A launch keeps a whole game at once: ONE decay, not one per mission (twenty decays would erase it).
let before = encodeTaste(emptyTaste());
for (let i = 0; i < 3; i++) before = recordTaste(before, ['music'], 1);
const launched = recordTasteMany(before, Array.from({ length: 20 }, () => ['hunt', 'camera']), 1);
ok('a launch of 20 missions decays the profile once', decodeTaste(launched)[TASTE_TAG_IDS.indexOf('music')] === Math.trunc(decodeTaste(before)[TASTE_TAG_IDS.indexOf('music')] * 0.9));
ok('a launch moves each kept tag one step, however many missions carry it', decodeTaste(launched)[TASTE_TAG_IDS.indexOf('hunt')] === 2);
ok('an empty launch changes nothing', recordTasteMany(before, [], 1) === before);

// ── A task's tags ───────────────────────────────────────────────────────────
const entry = TASK_BANK.find((e) => e.tags.includes('strangers'))!;
const built = entry.build();
ok('an unedited bank mission is read with its bank tags', tasteTagsForTask(built, TASK_BANK).includes('strangers'));
ok('a hand-written mission falls back to what the mission itself shows',
  tasteTagsForTask({ ...built, title: 'something nobody wrote in the bank' }, TASK_BANK).every((t) => !(MECHANIC_TAG_IDS as readonly string[]).includes(t)));

// ── Storage ─────────────────────────────────────────────────────────────────
const mem = new Map<string, string>();
const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, val: string) => { mem.set(k, val); } };
ok('per-creator key', tasteKey('u1') !== tasteKey('u2') && tasteKey(null).endsWith(':anon'));
writeTaste('u1', p, store);
ok('a profile round-trips through the store', readTaste('u1', store) === p);
const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
ok('a throwing store reads empty and writes nothing, never throws',
  (() => { try { writeTaste('u1', p, broken); return decodeTaste(readTaste('u1', broken)).every((x) => x === 0); } catch { return false; } })());

// ── The composer leans toward taste ─────────────────────────────────────────
const COPY: ComposerDescriptionCopy = {
  lead: () => 'L', ageLabel: (b) => b, ageTag: (b) => b, durationTag: (m) => `${m}`, composedLead: () => 'C',
  activityPhrase: (t) => t, activityJoin: (x) => x.join(','), activityTag: (t) => t, placeMissionPrompt: () => 'P',
};
const byTitle = new Map(TASK_BANK.map((e) => { try { return [e.build().title, e.tags] as const; } catch { return ['', []] as const; } }));
let lovesPuzzle = encodeTaste(emptyTaste());
for (let i = 0; i < 6; i++) lovesPuzzle = recordTaste(lovesPuzzle, ['puzzle', 'thinking'], 1);
for (let i = 0; i < 6; i++) lovesPuzzle = recordTaste(lovesPuzzle, ['strangers'], -1);
let puzzleWith = 0, puzzleWithout = 0, strangersWith = 0, strangersWithout = 0, sameDraws = true;
for (const audience of ['youth', 'adults', 'mixed'] as const) {
  for (let seed = 1; seed <= 15; seed++) {
    const a = { minutes: 120, audience, setting: 'outdoor', difficultyPreference: 'balanced', people: 20, ageBandId: 'band-14-17' } as ComposerAnswers;
    let n1 = 0, n2 = 0;
    const r1 = seededRng(seed), r2 = seededRng(seed);
    const g1 = composeGame(TASK_BANK, a, COPY, () => { n1++; return r1(); }, { recentBankKeys: [], taste: lovesPuzzle });
    const g2 = composeGame(TASK_BANK, a, COPY, () => { n2++; return r2(); }, { recentBankKeys: [] });
    if (n1 !== n2) sameDraws = false;
    const count = (g: typeof g1, tag: string) => (g?.stages ?? []).flatMap((s) => s.tasks).filter((t) => (byTitle.get(t.title) ?? []).includes(tag as never)).length;
    puzzleWith += count(g1, 'puzzle'); puzzleWithout += count(g2, 'puzzle');
    strangersWith += count(g1, 'strangers'); strangersWithout += count(g2, 'strangers');
  }
}
ok('taste costs no extra random draws', sameDraws);
ok('a puzzle lover gets more puzzles', puzzleWith > puzzleWithout, `${puzzleWith} vs ${puzzleWithout}`);
ok('a creator who keeps swapping strangers away gets fewer of them', strangersWith < strangersWithout, `${strangersWith} vs ${strangersWithout}`);
ok('taste is a nudge, bounded like the other bonuses', TASTE_WEIGHT > 0 && TASTE_WEIGHT <= 0.1);

// ── Regenerate leans toward taste ───────────────────────────────────────────
const outgoing = TASK_BANK.find((e) => e.tags.includes('camera') && !e.occasions)!.build();
let hits = 0, hitsNeutral = 0;
for (let seed = 1; seed <= 40; seed++) {
  // Taste alone: quality (composer-v2-quality) is held off on both sides, as its own test holds taste off.
  const base = { bank: TASK_BANK, profile: ['camera'] as never, context: regenerateContext(null), drift: 0, offeredKeys: [], seed, quality: false };
  const withTaste = chooseRegeneratedMission({ ...base, taste: lovesPuzzle });
  const neutral = chooseRegeneratedMission(base);
  if (withTaste?.tags.includes('strangers')) hits++;
  if (neutral?.tags.includes('strangers')) hitsNeutral++;
}
ok('regenerate offers fewer of the kind the creator keeps swapping away', hits <= hitsNeutral, `${hits} vs ${hitsNeutral}`);

console.log(failures === 0 ? '\n✅ taste profile: ALL PASS' : `\n❌ taste profile: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
