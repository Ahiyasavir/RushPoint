// The mission editor's step 3 settings rows (change: mission-editor-value-rows).
//
// Ahiya, 2026-10-02: the "+" chips on step 3 were drawers of unrelated settings that opened to up to
// 810px, full of text, and hid their values behind "4 מוגדר". They are replaced by rows that each show
// their value. Everything a row decides is pure here: which scoring control a game's scoring actually
// reads, how four "when does it open" fields collapse into one answer (and back, without losing data),
// what each row says, and what "עוד הגדרות" names.
import type { Task } from '../packages/shared/src/types';
import {
  SETTINGS_ROW_KEYS, scoringRowFor, fieldIgnoredByPreset, visibleRows,
  releaseAnswerOf, applyReleaseAnswer, closeAnswerOf, applyCloseAnswer,
  TIME_LIMIT_PRESETS, timeLimitChoiceOf, stepPoints, stepHintCost,
  rowSummary, moreSettingsActive,
} from '../apps/creator-web/src/lib/missionSettingsRows';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS  ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`); }
}
const j = (x: unknown) => JSON.stringify(x);

const base = {
  id: 't1', title: 'כולם באוויר', description: '', type: 'photo',
  difficulty: 5, pointValue: 100, estimatedMinutes: 5, maxConcurrentTeams: 1,
} as unknown as Task;
const t = (patch: Partial<Task> = {}) => ({ ...base, ...patch }) as Task;

// ── rows ────────────────────────────────────────────────────────────────────
check('five row keys, in order', j(SETTINGS_ROW_KEYS) === j(['scoring', 'hint', 'opens', 'timeLimit', 'more']));

// ── the scoring row follows the game's scoring ─────────────────────────────
check('fixed points ⇒ points', scoringRowFor('fixed_points_speed') === 'points');
check('smart score ⇒ difficulty', scoringRowFor('smart_weighted') === 'difficulty');
check('speed race ⇒ no scoring row', scoringRowFor('time_only') === null);
check('missing / junk preset ⇒ the default (points)', scoringRowFor(undefined) === 'points' && scoringRowFor('nonsense') === 'points' && scoringRowFor(42) === 'points');
check('a speed race has no scoring row at all', !visibleRows('time_only').includes('scoring') && visibleRows('time_only').length === 4);
check('a points game shows all five rows', j(visibleRows('fixed_points_speed')) === j(SETTINGS_ROW_KEYS));

check('difficulty is ignored by fixed points and by a speed race, not by smart score',
  fieldIgnoredByPreset('difficulty', 'fixed_points_speed') && fieldIgnoredByPreset('difficulty', 'time_only')
  && !fieldIgnoredByPreset('difficulty', 'smart_weighted'));
check('points are ignored by smart score and a speed race',
  fieldIgnoredByPreset('pointValue', 'smart_weighted') && fieldIgnoredByPreset('pointValue', 'time_only')
  && !fieldIgnoredByPreset('pointValue', 'fixed_points_speed'));
check('time at the stop only matters to fixed points',
  !fieldIgnoredByPreset('expectedDurationMinutes', 'fixed_points_speed')
  && fieldIgnoredByPreset('expectedDurationMinutes', 'smart_weighted') && fieldIgnoredByPreset('expectedDurationMinutes', 'time_only'));
check('everything else is never ignored', !fieldIgnoredByPreset('hint', 'time_only') && !fieldIgnoredByPreset('maxConcurrentTeams', 'smart_weighted'));
check('an unknown preset ignores like the default', fieldIgnoredByPreset('difficulty', undefined) && !fieldIgnoredByPreset('pointValue', undefined));

// ── when it opens: four fields, one answer ─────────────────────────────────
check('nothing set ⇒ from the start', releaseAnswerOf(t()) === 'start');
check('a prerequisite ⇒ after another mission', releaseAnswerOf(t({ unlockAfterTaskIds: ['t0'] })) === 'afterMission');
check('minutes after start', releaseAnswerOf(t({ releaseAfterMinutes: 15 })) === 'afterStart');
check('a set time', releaseAnswerOf(t({ releaseAt: '2026-10-22T15:00:00.000Z' })) === 'atTime');
check('empty / zero / junk values are not conditions',
  releaseAnswerOf(t({ unlockAfterTaskIds: [], releaseAfterMinutes: 0, releaseAt: 'not a date' })) === 'start');
check('two conditions at once ⇒ combined (never silently one of them)',
  releaseAnswerOf(t({ unlockAfterTaskIds: ['t0'], releaseAt: '2026-10-22T15:00:00.000Z' })) === 'combined');

const startPatch = applyReleaseAnswer('start');
check('back to the start clears all three, as ABSENT (undefined), never null',
  'unlockAfterTaskIds' in startPatch && 'releaseAfterMinutes' in startPatch && 'releaseAt' in startPatch
  && startPatch.unlockAfterTaskIds === undefined && startPatch.releaseAfterMinutes === undefined && startPatch.releaseAt === undefined);
const after = applyReleaseAnswer('afterMission', ['t0', 't2']);
check('after another mission sets it and clears the other two',
  j(after.unlockAfterTaskIds) === j(['t0', 't2']) && after.releaseAfterMinutes === undefined && after.releaseAt === undefined && 'releaseAt' in after);
check('minutes after start', applyReleaseAnswer('afterStart', 20).releaseAfterMinutes === 20 && applyReleaseAnswer('afterStart', 20).unlockAfterTaskIds === undefined);
check('a set time', applyReleaseAnswer('atTime', '2026-10-22T15:00:00.000Z').releaseAt === '2026-10-22T15:00:00.000Z');
check('a choice without a usable value writes nothing (the row waits for the value)',
  j(applyReleaseAnswer('afterMission', [])) === '{}' && j(applyReleaseAnswer('afterStart', 0)) === '{}'
  && j(applyReleaseAnswer('afterStart', Number.NaN)) === '{}' && j(applyReleaseAnswer('atTime', 'junk')) === '{}');
check('the round trip: choosing an answer then reading it back gives that answer',
  releaseAnswerOf(t({ ...t({ releaseAt: '2026-10-22T15:00:00.000Z' }), ...applyReleaseAnswer('afterStart', 10) })) === 'afterStart');

// ── when it closes ─────────────────────────────────────────────────────────
check('never closes by default', closeAnswerOf(t()) === 'never');
check('minutes after start', closeAnswerOf(t({ expiresAfterMinutes: 30 })) === 'afterStart');
check('a set time', closeAnswerOf(t({ expiresAt: '2026-10-22T16:00:00.000Z' })) === 'atTime');
check('both ⇒ combined', closeAnswerOf(t({ expiresAfterMinutes: 30, expiresAt: '2026-10-22T16:00:00.000Z' })) === 'combined');
const never = applyCloseAnswer('never');
check('never clears both as ABSENT', 'expiresAfterMinutes' in never && 'expiresAt' in never && never.expiresAfterMinutes === undefined && never.expiresAt === undefined);
check('closing after N minutes clears the set time', applyCloseAnswer('afterStart', 45).expiresAfterMinutes === 45 && 'expiresAt' in applyCloseAnswer('afterStart', 45));
check('no usable value ⇒ no write', j(applyCloseAnswer('atTime', '')) === '{}');

// ── time per team ──────────────────────────────────────────────────────────
check('presets', j(TIME_LIMIT_PRESETS) === j([2, 5, 10, 15]));
check('no limit', timeLimitChoiceOf(t()) === 'none' && timeLimitChoiceOf(t({ timeLimitMinutes: 0 })) === 'none');
check('a preset is selected as itself', timeLimitChoiceOf(t({ timeLimitMinutes: 5 })) === 5);
check('anything else is "other"', timeLimitChoiceOf(t({ timeLimitMinutes: 7.5 })) === 'other');

// ── steppers ───────────────────────────────────────────────────────────────
check('points step by 10', stepPoints(100, 1) === 110 && stepPoints(100, -1) === 90);
check('an authored odd value still steps by 10', stepPoints(125, 1) === 135);
check('points never go below 0 or above 1000', stepPoints(5, -1) === 0 && stepPoints(995, 1) === 1000);
check('junk points step from the default', stepPoints(Number.NaN, 1) === 110 && stepPoints(undefined as never, -1) === 90);
check('hint cost steps by 5, never negative', stepHintCost(25, 1) === 30 && stepHintCost(3, -1) === 0 && stepHintCost(undefined, 1) === 30);

// ── what each row says (an i18n key + params, never prose) ─────────────────
const ctx = { preset: 'fixed_points_speed', titleOf: (id: string) => (id === 't0' ? 'כולם בתמונה' : '') };
check('points row', j(rowSummary('scoring', t({ pointValue: 120 }), ctx)) === j({ key: 'points', params: { n: 120 } }));
check('difficulty row (smart score)', j(rowSummary('scoring', t({ difficulty: 8 }), { ...ctx, preset: 'smart_weighted' })) === j({ key: 'difficultyHard' }));
check('no hint', j(rowSummary('hint', t(), ctx)) === j({ key: 'hintNone' }));
check('a hint and its cost (default 25)', j(rowSummary('hint', t({ hint: 'מתחת לספסל' }), ctx)) === j({ key: 'hintOn', params: { n: 25 } }));
check('a blank hint is no hint', j(rowSummary('hint', t({ hint: '   ' }), ctx)) === j({ key: 'hintNone' }));
check('opens: from the start', j(rowSummary('opens', t(), ctx)) === j({ key: 'opensStart' }));
check('opens: after a named mission', j(rowSummary('opens', t({ unlockAfterTaskIds: ['t0'] }), ctx)) === j({ key: 'opensAfterMission', params: { titles: 'כולם בתמונה' } }));
check('opens: a deleted prerequisite still reads, as a count', j(rowSummary('opens', t({ unlockAfterTaskIds: ['gone', 't0'] }), ctx)) === j({ key: 'opensAfterMissions', params: { n: 2 } }));
check('opens: minutes after start', j(rowSummary('opens', t({ releaseAfterMinutes: 15 }), ctx)) === j({ key: 'opensAfterStart', params: { n: 15 } }));
check('opens: combined says how many conditions', j(rowSummary('opens', t({ releaseAfterMinutes: 5, releaseAt: '2026-10-22T15:00:00.000Z' }), ctx)) === j({ key: 'opensCombined', params: { n: 2 } }));
check('time per team: none', j(rowSummary('timeLimit', t(), ctx)) === j({ key: 'timeLimitNone' }));
check('time per team: minutes', j(rowSummary('timeLimit', t({ timeLimitMinutes: 5 }), ctx)) === j({ key: 'timeLimitMinutes', params: { n: 5 } }));
check('more: nothing set', j(rowSummary('more', t(), ctx)) === j({ key: 'moreNone' }));
check('rowSummary never throws on junk', (() => { try { rowSummary('hint', null as never, ctx); rowSummary('opens', {} as never, null as never); return true; } catch { return false; } })());

// ── "עוד הגדרות" names what is set inside it ───────────────────────────────
const P = 'fixed_points_speed';
check('a fresh mission has nothing in "more"', j(moreSettingsActive(t(), P)) === '[]');
check('capacity, by value', j(moreSettingsActive(t({ maxConcurrentTeams: 3 }), P)) === j([{ key: 'capacity', n: 3 }]));
check('order is the order of the drawer',
  j(moreSettingsActive(t({ pausesTimer: true, maxConcurrentTeams: 3, expiresAfterMinutes: 30 }), P).map((x) => x.key))
  === j(['closes', 'capacity', 'pauseClock']));
check('everyone takes part only when more than one', j(moreSettingsActive(t({ requiredContributors: 1 }), P)) === '[]'
  && j(moreSettingsActive(t({ requiredContributors: 3 }), P)) === j([{ key: 'contributors', n: 3 }]));
check('tags are counted', j(moreSettingsActive(t({ tags: ['חוץ', 'צילום'] }), P)) === j([{ key: 'tags', n: 2 }]));
check('free hint thresholds count only with a hint', j(moreSettingsActive(t({ hintAutoRevealMinutes: 5 }), P)) === '[]'
  && j(moreSettingsActive(t({ hint: 'x', hintAutoRevealMinutes: 5 }), P)) === j([{ key: 'hintFree' }]));
check('time at the stop counts only where scoring reads it, and only when changed from the suggestion',
  j(moreSettingsActive(t({ expectedDurationMinutes: 9 }), 'fixed_points_speed')) === j([{ key: 'duration', n: 9 }])
  && j(moreSettingsActive(t({ expectedDurationMinutes: 9 }), 'smart_weighted')) === '[]');
check('the seeded total estimate is not "set" (it is on every mission)', j(moreSettingsActive(t({ estimatedMinutes: 40 }), 'smart_weighted')) === '[]');
check('more row lists the names', j(rowSummary('more', t({ maxConcurrentTeams: 3, pausesTimer: true }), ctx)) === j({ key: 'moreList', items: [{ key: 'capacity', n: 3 }, { key: 'pauseClock' }] }));
// 100 or more is the platform's "no queue here" (UNLIMITED_CAPACITY_THRESHOLD), the value every
// bank mission carries. Listing it as "100 teams at once" read as a limit someone set, on the most
// common mission in a composed game (found at 375px, 2026-10-04).
check('a no-queue capacity is not listed as a setting', j(moreSettingsActive(t({ maxConcurrentTeams: 100 }), P)) === j([]));
check('a capacity above the threshold is not listed either', j(moreSettingsActive(t({ maxConcurrentTeams: 250 }), P)) === j([]));
check('a real limit under the threshold is still listed', j(moreSettingsActive(t({ maxConcurrentTeams: 99 }), P)) === j([{ key: 'capacity', n: 99 }]));
check('moreSettingsActive never throws on junk', (() => { try { return Array.isArray(moreSettingsActive(null as never, P)); } catch { return false; } })());

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
