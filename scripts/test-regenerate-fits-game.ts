// A swapped-in mission must fit the GAME, not only the slot (found 29.10 by composing 24 games and
// swapping every mission: 14% of swaps brought a mission already in the game, 14% a family twin of one,
// and 5% a mission for another audience, such as an office mission in a kids' game).
import { readFileSync } from 'node:fs';
import { composeGame, seededRng, type ComposerDescriptionCopy } from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { translations } from '../apps/creator-web/src/i18n';
import { chooseRegeneratedMission, missionTagProfile, missionRoleAt, regenerateContext, seedFor } from '../apps/creator-web/src/lib/regenerateMission';
import { swapGameFit } from '../apps/creator-web/src/lib/tasteProfile';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 400) : ''}`);
  if (!cond) failures++;
}
const d = (translations as any).he.dashboard;
const copy: ComposerDescriptionCopy = {
  lead: ({ people, minutes, ageLabel }: any) => d.wizard.descriptionLead(people, minutes, ageLabel),
  ageLabel: () => 'גיל', ageTag: () => 'גיל', durationTag: (m: number) => d.wizard.durationTag(m),
  composedLead: ({ people, minutes, ageLabel }: any) => d.wizard.composedLead(people, minutes, ageLabel),
  activityPhrase: (tag: string) => d.wizard.activityPhrases[tag] ?? '',
  activityJoin: (p: string[]) => (p.length ? `${d.wizard.activityPrefix} ${p.join(d.wizard.activityJoinSeparator)}` : ''),
  activityTag: (tag: string) => d.wizard.activityTags[tag] ?? '',
  stageNames: (role: string) => d.wizard.composedStageNames[role] ?? [],
  occasionStageNames: (o: string, role: string) => d.wizard.occasionStageNames[o]?.[role] ?? [],
  placeMissionPrompt: () => d.wizard.placeMissionPrompt,
  placeSpotHint: (s: string) => d.wizard.placeSpotHint[s] ?? '',
  hiddenCluePrompt: () => d.wizard.hiddenCluePrompt,
} as unknown as ComposerDescriptionCopy;

const bank = TASK_BANK as any[];
const byKey = new Map(bank.map((e) => [e.key, e]));
let swaps = 0; const dupKey: string[] = []; const dupFamily: string[] = []; const aud: string[] = [];
for (const audience of ['kids', 'youth', 'adults', 'corporate']) for (const seed of [1, 2, 3, 4, 5, 6]) {
  const r: any = composeGame(bank, { audience, setting: 'outdoor', minutes: 90, prepEffort: 3, locationMissions: true, difficultyPreference: 'balanced', people: 12, ageBandId: audience === 'kids' ? 'band-8-10' : 'band-14-17' } as any, copy, seededRng(seed), { recentBankKeys: [] });
  if (!r) continue;
  const game: any = { id: 'g' + seed, stages: r.stages };
  game.stages.forEach((st: any, si: number) => st.tasks.forEach((t: any, ti: number) => {
    const fit = swapGameFit(game, t.id, bank);
    const picked: any = chooseRegeneratedMission({ bank, profile: missionTagProfile(t, missionRoleAt(si, ti, game.stages.length, st.tasks.length)), context: regenerateContext(game, t), drift: 0, offeredKeys: [], seed: seedFor(t.id, 0), inGameKeys: fit.inGameKeys, audiences: fit.audiences } as any);
    if (!picked) return;
    swaps++;
    if (fit.inGameKeys.includes(picked.key)) dupKey.push(`${audience}: "${t.title}" -> "${picked.build().title}"`);
    const fams = new Set(fit.inGameKeys.map((k) => byKey.get(k)?.family).filter(Boolean));
    if (picked.family && fams.has(picked.family)) dupFamily.push(`${audience}: "${picked.build().title}" (${picked.family})`);
    if (!picked.tags.includes(audience) && !picked.tags.includes('mixed')) aud.push(`${audience}: "${picked.build().title}"`);
  }));
}
ok(`swaps were really made (${swaps})`, swaps > 300, swaps);
ok('a swap never brings a mission that is already in the game', dupKey.length === 0, dupKey.slice(0, 4));
ok('a swap never brings a twin of a mission in the game', dupFamily.length === 0, dupFamily.slice(0, 4));
ok("a swap brings a mission for the game's audience", aud.length === 0, aud.slice(0, 4));

// The audience is read from the game's own bank missions; a hand-built game has none and is not filtered.
const kidsGame: any = { stages: [{ id: 's', tasks: bank.filter((e) => e.tags.includes('kids') && !e.tags.includes('youth')).slice(0, 5).map((e, i) => ({ ...e.build(), id: 't' + i })) }] };
ok('a game of kids missions serves kids', swapGameFit(kidsGame, 't0', bank).audiences.includes('kids'), swapGameFit(kidsGame, 't0', bank));
ok('the swapped mission itself is not counted as "in the game"', !swapGameFit(kidsGame, 't0', bank).inGameKeys.includes(bank.find((e) => e.build().title === kidsGame.stages[0].tasks[0].title)?.key));
ok('a hand-built game has no audience and no bank keys', JSON.stringify(swapGameFit({ stages: [{ id: 's', tasks: [{ id: 'x', title: 'משימה שלי' }] }] }, 'x', bank)) === JSON.stringify({ inGameKeys: [], audiences: [] }));
ok('garbage is the neutral fit, never a throw', JSON.stringify(swapGameFit(null, 'x', bank)) === JSON.stringify({ inGameKeys: [], audiences: [] }));
const builder = readFileSync('apps/creator-web/src/pages/BuilderPage.tsx', 'utf8');
ok('the Builder passes the game fit into every swap', /swapGameFit\(game, source\.id, missionBankNow\(\)\)/.test(builder) && /inGameKeys: fit\.inGameKeys,\s*audiences: fit\.audiences/.test(builder));

console.log(failures === 0 ? '\n✅ regenerate fits the game: ALL PASS' : `\n❌ regenerate fits the game: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
