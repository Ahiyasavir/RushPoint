// Pure-logic test for the podium moment (change: podium-share-moment). No emulator.
//   npx tsx scripts/test-podium.ts
import { selectPodium, computePodiumLayout } from '../packages/shared/src/podium';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const r = (teamId: string, rank: number, score: number) => ({ teamId, teamName: teamId, score, rank });
const five = [r('a', 1, 500), r('b', 2, 400), r('c', 3, 300), r('d', 4, 200), r('e', 5, 100)];

// ── selectPodium ─────────────────────────────────────────────────────────────
{
  const { podium, myPlacement } = selectPodium(five, 'd');
  check('podium has top 3', podium.length === 3);
  check('places map 1/2/3 in rank order', podium.map((p) => `${p.teamId}:${p.place}`).join(',') === 'a:1,b:2,c:3');
  check('myPlacement reflects the caller rank', myPlacement === 4);

  const two = selectPodium([r('x', 1, 9), r('y', 2, 8)]);
  check('fewer than 3 teams → shorter podium', two.podium.length === 2 && two.podium[1].place === 2);

  const unsorted = selectPodium([r('c', 3, 1), r('a', 1, 9), r('b', 2, 5)]);
  check('selection sorts by rank regardless of input order', unsorted.podium.map((p) => p.teamId).join('') === 'abc');
  check('no myTeamId → undefined placement', selectPodium(five).myPlacement === undefined);
}

// ── computePodiumLayout ──────────────────────────────────────────────────────
{
  const W = 1080, H = 1080;
  const blocks = computePodiumLayout({ width: W, height: H, count: 3 });
  check('3 blocks', blocks.length === 3);
  check('visual order is 2 · 1 · 3', blocks.map((b) => b.place).join(',') === '2,1,3');
  const first = blocks.find((b) => b.place === 1)!;
  const second = blocks.find((b) => b.place === 2)!;
  const third = blocks.find((b) => b.place === 3)!;
  check('first place is tallest', first.h > second.h && second.h > third.h);
  check('all blocks bottom-aligned + in bounds',
    blocks.every((b) => b.x >= 0 && b.x + b.w <= W && b.y >= 0 && b.y + b.h <= H && Math.abs(b.y + b.h - H) < 0.001));
  // Centred: the span is symmetric about the canvas centre.
  const minX = Math.min(...blocks.map((b) => b.x));
  const maxX = Math.max(...blocks.map((b) => b.x + b.w));
  check('podium is horizontally centred', Math.abs((minX + maxX) / 2 - W / 2) < 0.001);

  check('empty rankings → no blocks', computePodiumLayout({ width: W, height: H, count: 0 }).length === 0);
}

console.log(`\n${failures === 0 ? 'ALL PODIUM TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
