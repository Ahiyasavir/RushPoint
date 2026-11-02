// Measures what the composer does with several places. Not a gate (no `test-` prefix): run by hand.
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { AREA_KIND_TAG_IDS } from '../apps/creator-web/src/bankTags';
import { composeGame, seededRng, goToAreaFor } from '../apps/creator-web/src/lib/composeGame';
import { initialSmartBuildState, smartBuildAnswers } from '../apps/creator-web/src/lib/smartBuildWizard';

const copy = { placeMissionPrompt: () => 'pin', goToPlace: (a: string) => `GO:${a}.` } as never;
const kinds = [...AREA_KIND_TAG_IDS].filter((k) => k !== 'office' && k !== 'school');
const byTitle = new Map<string, readonly string[]>();
for (const e of TASK_BANK) { try { byTitle.set(e.build().title, e.tags); } catch { /* */ } }

const combos: string[][] = [];
for (let i = 0; i < kinds.length; i++) for (let j = i + 1; j < kinds.length; j++) {
  combos.push([kinds[i], kinds[j]]);
  for (let k = j + 1; k < kinds.length; k++) combos.push([kinds[i], kinds[j], kinds[k]]);
}

let games = 0; let tasks = 0; let told = 0; let stagesMulti = 0; let stagesTotal = 0; let wrongPlace = 0; let manyFit = 0;
let lopsided = 0; let noGame = 0;
const wrong = new Map<string, number>();
for (const areas of combos) for (let seed = 1; seed <= 6; seed++) for (const prep of [1, 2]) {
  const a = { ...smartBuildAnswers(initialSmartBuildState()), areas, prepEffort: prep, locationMissions: prep >= 2 } as never;
  const r = composeGame(TASK_BANK, a, copy, seededRng(seed * 7919));
  if (!r) { noGame++; continue; }
  games++;
  const count = new Map<string, number>();
  for (const st of r.stages) {
    stagesTotal++;
    const here = new Set<string>();
    for (const t of st.tasks) {
      tasks++;
      const m = /^GO:(\w+)\./.exec(t.description ?? '');
      if (m) { told++; here.add(m[1]); count.set(m[1], (count.get(m[1]) ?? 0) + 1); }
      const tags = byTitle.get(t.title) ?? [];
      const own = tags.filter((x) => (AREA_KIND_TAG_IDS as readonly string[]).includes(x));
      const fit = own.filter((x) => areas.includes(x));
      if (own.length > 0 && fit.length === 0) { wrongPlace++; wrong.set(t.title, (wrong.get(t.title) ?? 0) + 1); }
      if (fit.length > 1 && fit.length < areas.length) manyFit++;
      void goToAreaFor;
    }
    if (here.size > 1) stagesMulti++;
  }
  if (count.size === 1) lopsided++;
}
console.log({ games, noGame, tasks, told, stagesTotal, stagesMulti, wrongPlace, manyFit, lopsided });
console.log('never fits a chosen place:', [...wrong].sort((x, y) => y[1] - x[1]).slice(0, 12));
const counts: Record<string, number> = {};
for (const e of TASK_BANK) for (const t of e.tags) if ((AREA_KIND_TAG_IDS as readonly string[]).includes(t)) counts[t] = (counts[t] ?? 0) + 1;
const none = TASK_BANK.filter((e) => !e.tags.some((t) => (AREA_KIND_TAG_IDS as readonly string[]).includes(t))).length;
console.log('bank', TASK_BANK.length, 'by place', counts, 'no place tag', none);
