// No children's missions for teens (Ahiya, 3.11: "how does this fit 14 to 17?" about a spy code name
// opener and a lie-down letter, then "make sure there are no more babyish missions for teens, teens =
// 14 to 17"). Composed games and the swap button, across every place and many seeds.
import { composeGame, kidsOnlyForOlder, seededRng } from '../apps/creator-web/src/lib/composeGame';
import { chooseRegeneratedMission } from '../apps/creator-web/src/lib/regenerateMission';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { AREA_KIND_TAG_IDS } from '../apps/creator-web/src/bankTags';
import { initialSmartBuildState, smartBuildAnswers } from '../apps/creator-web/src/lib/smartBuildWizard';

let failed = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failed++; };

ok(kidsOnlyForOlder(['kids'], 'youth', 14), 'a kids mission is out of a 14 to 17 game');
ok(kidsOnlyForOlder(['kids', 'mixed'], 'youth', 14), 'a family mission (kids and mixed) is out too');
ok(!kidsOnlyForOlder(['kids', 'youth'], 'youth', 14), 'a mission tagged for teens stays');
ok(!kidsOnlyForOlder(['mixed', 'adults'], 'youth', 14), 'a mixed mission with no kids tag stays');
ok(!kidsOnlyForOlder(['kids'], 'youth', 11), 'preteens still get the kids pool');
ok(kidsOnlyForOlder(['kids', 'mixed'], 'adults', 0), 'adults do not get children\'s missions');
ok(!kidsOnlyForOlder(['kids', 'mixed'], 'mixed', 0), 'a family game keeps family missions');
ok(!kidsOnlyForOlder(['kids'], 'kids', 0), 'a kids game keeps kids missions');
ok(!kidsOnlyForOlder(['kids', 'youth', 'adults'], 'corporate', 0), 'a mission tagged for adults suits a workplace group');
ok(kidsOnlyForOlder(['kids', 'youth'], 'corporate', 0), 'a kids and teens mission is still out of a workplace game');

// Judged one by one (mission-studio G18): a camp formation, a planted object, a named egg, a line of
// objects, a pirate map. A teen tag on any of these again fails here.
const CHILDISH = ['human-letter', 'code-names', 'odd-one-planted', 'egg-teammate', 'longest-line', 'pirate-map'];
for (const key of CHILDISH) {
  const e = TASK_BANK.find((x) => x.key === key);
  ok(!!e && !e.tags.includes('youth'), `${key} is not tagged for teens`);
}

const tagsOfTitle = new Map(TASK_BANK.map((e) => { try { return [e.build().title, e.tags as readonly string[]] as const; } catch { return ['', []] as const; } }));
let games = 0; let missions = 0; const leaked = new Set<string>();
const places = [[], ...AREA_KIND_TAG_IDS.filter((k) => k !== 'office').map((k) => [k])];
for (const areas of places) for (let seed = 1; seed <= 12; seed++) for (const prep of [1, 3]) {
  const a = { ...smartBuildAnswers(initialSmartBuildState()), audience: 'youth', ageBandId: 'band-14-17', areas, prepEffort: prep, people: seed % 3 === 0 ? 40 : 10 } as never;
  const r = composeGame(TASK_BANK, a, undefined, seededRng(seed * 6007 + prep));
  if (!r) continue;
  games++;
  for (const st of r.stages) for (const t of st.tasks) {
    missions++;
    const tags = tagsOfTitle.get(t.title) ?? [];
    if (tags.includes('kids') && !tags.includes('youth')) leaked.add(t.title);
  }
}
ok(games > 100, `the sweep composed teen games (${games} games, ${missions} missions)`);
ok(leaked.size === 0, `no children's mission in a teen game (${[...leaked].join(', ') || 'none'})`);

let swapLeaks = 0;
for (let seed = 1; seed <= 200; seed++) {
  const picked = chooseRegeneratedMission({ bank: TASK_BANK, profile: ['camera', 'teamwork'], context: { setting: 'fromAnywhere', prepTolerance: 3 }, drift: 0, offeredKeys: [], seed, audiences: ['youth'] } as never);
  if (picked && picked.tags.includes('kids') && !picked.tags.includes('youth')) swapLeaks++;
}
ok(swapLeaks === 0, `the swap button does not offer a children's mission to teens (${swapLeaks} of 200)`);

// Prep level 2 reads "I'll put the missions on real spots". With the children's missions gone the
// older pools hold fewer missions a pin can host, and a placed game came out with no pin at all.
for (const [audience, ageBandId] of [['youth', 'band-14-17'], ['adults', undefined], ['corporate', undefined]] as const) {
  const empty: number[] = [];
  for (let seed = 1; seed <= 30; seed++) {
    const r = composeGame(TASK_BANK, { audience, ageBandId, setting: 'outdoor', minutes: 90, people: 24, difficultyPreference: 'balanced', locationMissions: true, prepEffort: 2 } as never, { placeMissionPrompt: () => 'x' } as never, seededRng(seed), { recentBankKeys: [] });
    if (r && !r.wizardSteps.some((s) => s.targetFieldPath === 'coordinates')) empty.push(seed);
  }
  // Adults outdoors hold only four missions a pin can host (3.11), so a few games still come out
  // without one. That is a BANK gap, closed by writing placed adult missions, not by scoring.
  const allowed = audience === 'adults' ? 5 : 0;
  ok(empty.length <= allowed, `${audience}: a placed light prep game asks for a pin (${empty.length} of 30 without, allowed ${allowed})`);
}

process.exit(failed ? 1 : 0);
