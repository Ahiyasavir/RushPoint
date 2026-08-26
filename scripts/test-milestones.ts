// Pure-logic test for the mid-run milestone beats (change: test-mode-game-feel).
//
// WHY THIS EXISTS: a sealed assessment run has no score, no streak and no board,
// so between the first question and the last there is nothing at all telling a
// player they are getting somewhere. A milestone measures PERSISTENCE, not
// knowledge — it is identical for a player answering everything right and a player
// answering everything wrong — so it is the one celebration test mode may keep.
//
// Thresholds are RATIOS, not the literals 5/10/15/20: an assessment of 12 or 30
// questions has to get sensible beats too. `crossedMilestone` takes the previous
// count as well, because one completion can jump the counter by more than 1 (a
// partial stage auto-skips its siblings) and we must not fire four banners at once.
//
//   npx tsx scripts/test-milestones.ts
import { crossedMilestone, milestoneThresholds, MILESTONES, type Milestone } from '../apps/play-web/src/lib/milestones';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── the assessment that started this ─────────────────────────────────────────
console.log('\n-- 20 questions --');
{
  const fired: (Milestone | null)[] = [];
  for (let n = 1; n <= 20; n++) fired.push(crossedMilestone(n - 1, n, 20));
  check('quarter at 5', fired[4] === 'quarter', String(fired[4]));
  check('half at 10', fired[9] === 'half', String(fired[9]));
  check('lastFive at 15', fired[14] === 'lastFive', String(fired[14]));
  check('nothing at the finish', fired[19] === null, String(fired[19]));
  const count = fired.filter(Boolean).length;
  check('exactly three beats in a 20-question run', count === 3, String(count));
}

// ── ratios, not literals ─────────────────────────────────────────────────────
console.log('\n-- other run lengths --');
{
  // Every beat, with the completion count it fired at.
  const beats = (total: number) => {
    const out: { m: Milestone; at: number }[] = [];
    for (let n = 1; n <= total; n++) { const m = crossedMilestone(n - 1, n, total); if (m) out.push({ m, at: n }); }
    return out;
  };
  check('12 questions still gets beats', beats(12).length >= 2, JSON.stringify(beats(12)));
  check('30 questions still gets beats', beats(30).length >= 3, JSON.stringify(beats(30)));
  for (const total of [4, 5, 6, 8, 10, 12, 16, 20, 24, 30, 47, 100]) {
    const b = beats(total);
    // Each milestone fires at most once per run, and one answer never fires two.
    check(`no duplicate beat at total=${total}`, new Set(b.map((x) => x.m)).size === b.length, JSON.stringify(b));
    check(`one beat per answer at total=${total}`,
      b.every((x, i) => i === 0 || x.at > b[i - 1].at), JSON.stringify(b));
    check(`no beat at the finish at total=${total}`, b.every((x) => x.at < total), JSON.stringify(b));
  }
}

// ── too short to have a middle ───────────────────────────────────────────────
console.log('\n-- short runs --');
for (const total of [0, 1, 2, 3]) {
  let any = false;
  for (let n = 1; n <= total; n++) if (crossedMilestone(n - 1, n, total)) any = true;
  check(`no beats at total=${total}`, !any);
}

// ── a jump fires ONE banner, the most significant ────────────────────────────
console.log('\n-- jumps --');
{
  // A partial stage auto-skips siblings: done can leap from 3 to 16 in one write.
  check('jump 3->16 of 20 fires the highest crossed', crossedMilestone(3, 16, 20) === 'lastFive',
    String(crossedMilestone(3, 16, 20)));
  check('jump straight to the end fires nothing', crossedMilestone(0, 20, 20) === null,
    String(crossedMilestone(0, 20, 20)));
  check('no movement fires nothing', crossedMilestone(10, 10, 20) === null);
  check('going backwards fires nothing', crossedMilestone(12, 4, 20) === null);
}

// ── thresholds are self-consistent ───────────────────────────────────────────
console.log('\n-- thresholds --');
for (const total of [4, 7, 10, 20, 33, 100]) {
  const th = milestoneThresholds(total);
  const vals = MILESTONES.map((m) => th[m]).filter((v): v is number => v != null);
  check(`thresholds strictly inside (0,total) at total=${total}`,
    vals.every((v) => Number.isInteger(v) && v > 0 && v < total), JSON.stringify(th));
  // MILESTONES is a set, not an order — `lastFive` precedes `threeQuarters` in a
  // 20-question run and follows it in a 100-question one. The invariant is that no
  // two beats share a count, so one answer never fires two banners.
  check(`thresholds are distinct at total=${total}`,
    new Set(vals).size === vals.length, JSON.stringify(th));
}

// ── totality ─────────────────────────────────────────────────────────────────
console.log('\n-- malformed input --');
const junk: [unknown, unknown, unknown][] = [
  [null, null, null], [undefined, 5, 20], [1, undefined, 20], [1, 5, undefined],
  ['1', '5', '20'], [Number.NaN, Number.NaN, Number.NaN],
  [-4, -1, -20], [1.5, 5.5, 20.5], [0, Infinity, Infinity], [0, 5, Infinity],
];
for (const [a, b, c] of junk) {
  let threw = false; let out: Milestone | null = null;
  try { out = crossedMilestone(a as number, b as number, c as number); } catch { threw = true; }
  check(`total for (${String(a)}, ${String(b)}, ${String(c)})`,
    !threw && (out === null || MILESTONES.includes(out)), threw ? 'THREW' : String(out));
}
{
  let threw = false;
  try { milestoneThresholds(Number.NaN); milestoneThresholds(-1); milestoneThresholds(Infinity); } catch { threw = true; }
  check('milestoneThresholds never throws', !threw);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
