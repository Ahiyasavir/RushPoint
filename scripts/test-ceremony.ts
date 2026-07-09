// Pure-logic tests for ceremony mode (pickCeremonyFeed selector + the phase
// machine). Change: ceremony-mode. Run by scripts/run-unit-tests.mjs via
// `npm test`. No emulator needed.
import {
  pickCeremonyFeed, ceremonyStart, ceremonyNext, CEREMONY_FEED_CAP,
  type FeedItem, type CeremonyPhase,
} from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const item = (over: Partial<FeedItem>): FeedItem => ({
  id: 'i', taskId: 't', taskTitle: 'Task', teamId: 'tm', teamName: 'Team',
  photoUrl: 'https://x/p.jpg', reactions: {}, reactedBy: {}, active: true,
  createdAt: '2026-01-01T00:00:00.000Z', ...over,
});

// ── pickCeremonyFeed ──────────────────────────────────────────────────────────
ok(CEREMONY_FEED_CAP === 20, 'CEREMONY_FEED_CAP is 20');
ok(pickCeremonyFeed([]).length === 0, 'empty input yields an empty feed');

// Excludes inactive items.
{
  const out = pickCeremonyFeed([
    item({ id: 'a', active: true }),
    item({ id: 'b', active: false }),
  ]);
  ok(out.length === 1 && out[0].teamName === 'Team', 'active:false items are excluded');
}

// Ranks by total reactions desc.
{
  const out = pickCeremonyFeed([
    item({ id: 'low', taskTitle: 'Low', reactions: { '👍': 1 } }),
    item({ id: 'high', taskTitle: 'High', reactions: { '👍': 2, '🔥': 3 } }),
    item({ id: 'none', taskTitle: 'None' }),
  ]);
  ok(out.map((o) => o.taskTitle).join(',') === 'High,Low,None', 'ranked by total reactions desc');
  ok(out[0].totalReactions === 5 && out[1].totalReactions === 1 && out[2].totalReactions === 0,
    'totalReactions sums every emoji count');
}

// Tie-break: earlier createdAt wins.
{
  const out = pickCeremonyFeed([
    item({ id: 'later', taskTitle: 'Later', reactions: { '🔥': 2 }, createdAt: '2026-01-01T02:00:00.000Z' }),
    item({ id: 'earlier', taskTitle: 'Earlier', reactions: { '👍': 2 }, createdAt: '2026-01-01T01:00:00.000Z' }),
  ]);
  ok(out[0].taskTitle === 'Earlier', 'tie on reactions breaks by createdAt asc');
}

// Caps at n (default CEREMONY_FEED_CAP).
{
  const many = Array.from({ length: 30 }, (_, i) =>
    item({ id: `m${i}`, reactions: { '👍': i }, createdAt: `2026-01-01T00:${String(i).padStart(2, '0')}:00.000Z` }));
  const out = pickCeremonyFeed(many);
  ok(out.length === CEREMONY_FEED_CAP, `caps at ${CEREMONY_FEED_CAP}`);
  ok(out[0].totalReactions === 29, 'cap keeps the top-liked items');
  const out3 = pickCeremonyFeed(many, 3);
  ok(out3.length === 3, 'explicit n caps to n');
}

// Output shape is exactly CeremonyFeedItem (no reactedBy/id/active leak).
{
  const out = pickCeremonyFeed([item({ id: 'shape', reactedBy: { u: '👍' }, reactions: { '👍': 1 } })]);
  const keys = Object.keys(out[0]).sort();
  ok(keys.join(',') === 'photoUrl,taskTitle,teamName,totalReactions',
    `output keys are exactly taskTitle/teamName/photoUrl/totalReactions (got ${keys.join(',')})`);
}

// ── Phase machine ─────────────────────────────────────────────────────────────
// ceremonyStart: skips empty phases.
ok(ceremonyStart(5, 4) === 'slideshow', 'feed + 3 or more teams starts at slideshow');
ok(ceremonyStart(0, 4) === 'podium3', 'no feed skips straight to podium3');
ok(ceremonyStart(0, 3) === 'podium3', 'exactly 3 teams starts at podium3');
ok(ceremonyStart(0, 2) === 'podium2', '2 teams starts at podium2');
ok(ceremonyStart(0, 1) === 'podium1', '1 team starts at podium1');
ok(ceremonyStart(0, 0) === 'standings', '0 teams goes straight to standings');
ok(ceremonyStart(3, 0) === 'slideshow', 'feed still plays even with 0 teams');
ok(ceremonyStart(3, 2) === 'slideshow', 'feed + 2 teams still starts at slideshow');

// ceremonyNext: full transition table; standings is terminal.
ok(ceremonyNext('slideshow', 3) === 'podium3', 'slideshow advances to podium3 (3 teams)');
ok(ceremonyNext('slideshow', 2) === 'podium2', 'slideshow advances to podium2 (2 teams)');
ok(ceremonyNext('slideshow', 1) === 'podium1', 'slideshow advances to podium1 (1 team)');
ok(ceremonyNext('slideshow', 0) === 'standings', 'slideshow advances to standings (0 teams)');
ok(ceremonyNext('podium3', 3) === 'podium2', 'podium3 advances to podium2');
ok(ceremonyNext('podium2', 3) === 'podium1', 'podium2 advances to podium1');
ok(ceremonyNext('podium1', 3) === 'standings', 'podium1 advances to standings');
ok(ceremonyNext('standings', 3) === 'standings', 'standings is terminal');

// ceremonyNext is total: every phase has a successor for every team count.
{
  const phases: CeremonyPhase[] = ['slideshow', 'podium3', 'podium2', 'podium1', 'standings'];
  let total = true;
  for (const p of phases) {
    for (const teams of [0, 1, 2, 3, 7]) {
      const next = ceremonyNext(p, teams);
      if (!phases.includes(next)) total = false;
    }
  }
  ok(total, 'ceremonyNext is total over phases × team counts');
}

// Every start eventually reaches standings (no loops).
{
  let terminates = true;
  for (const feed of [0, 4]) {
    for (const teams of [0, 1, 2, 3, 9]) {
      let phase = ceremonyStart(feed, teams);
      let steps = 0;
      while (phase !== 'standings' && steps < 10) { phase = ceremonyNext(phase, teams); steps++; }
      if (phase !== 'standings') terminates = false;
    }
  }
  ok(terminates, 'every sequence terminates at standings');
}

console.log(failed === 0
  ? `\n✅ ALL CEREMONY TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
