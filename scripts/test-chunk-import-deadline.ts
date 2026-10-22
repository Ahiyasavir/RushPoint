// A screen chunk that HANGS must not leave a player on "loading" forever (2026-10-22).
//
// The production stress of the 14.10 join (16 fresh WebKit phones on player.rush-point.com): one phone
// joined its team on the server in 5 s, and then sent NOTHING for 35 s and showed nothing. The game
// screen is a lazy chunk fetched only after the join; `lazyWithRetry` heals a chunk that FAILS (one
// reload) but waited forever on one that never settles, which on weak reception at an event is a child
// who got in and sees nothing. Two guards: the game screen is fetched in advance while the join screen
// is up, and every lazy route import has a deadline that turns a hang into the existing one-reload heal.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withImportDeadline, CHUNK_IMPORT_DEADLINE_MS } from '../apps/play-web/src/lib/chunkDeadline';
import { withImportDeadline as creatorDeadline, CHUNK_IMPORT_DEADLINE_MS as CREATOR_MS } from '../apps/creator-web/src/lib/chunkDeadline';

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); }
};
const never = () => new Promise<never>(() => { /* a fetch that never settles */ });

async function main() {
  // 1. The deadline itself.
  const hung = await withImportDeadline(never(), 30).then(() => 'resolved', (e: Error) => e?.name ?? 'error');
  check('a hanging import is turned into a rejection after the deadline', hung === 'ChunkImportTimeout', hung);
  const fast = await withImportDeadline(Promise.resolve({ default: 1 }), 1000);
  check('an import that arrives in time is passed through unchanged', (fast as { default: number }).default === 1);
  const failed = await withImportDeadline(Promise.reject(new Error('404')), 1000).then(() => 'resolved', (e: Error) => e.message);
  check('a failing import keeps its own error (the existing heal reads it)', failed === '404', failed);
  check('the deadline leaves room for a slow phone (>= 20 s, <= 45 s)', CHUNK_IMPORT_DEADLINE_MS >= 20_000 && CHUNK_IMPORT_DEADLINE_MS <= 45_000, CHUNK_IMPORT_DEADLINE_MS);
  // creator-web carries its own copy (packages/shared is framework-free): it must behave the same.
  const hungC = await creatorDeadline(never(), 30).then(() => 'resolved', (e: Error) => e?.name ?? 'error');
  check('creator-web: the same deadline, the same behaviour', hungC === 'ChunkImportTimeout' && CREATOR_MS === CHUNK_IMPORT_DEADLINE_MS, { hungC, CREATOR_MS });

  // 2. Both lazy helpers apply it, so every route chunk is covered.
  for (const app of ['play-web', 'creator-web']) {
    const src = readFileSync(join(process.cwd(), `apps/${app}/src/lib/lazyWithRetry.ts`), 'utf8');
    check(`${app}: lazyWithRetry imports through the deadline`, /withImportDeadline\(\s*factory\(\)/.test(src));
  }

  // 3. The game screen is fetched while the join screen is still up.
  const join_ = readFileSync(join(process.cwd(), 'apps/play-web/src/screens/JoinScreen.tsx'), 'utf8');
  check('the join screen fetches the game screen in advance', /import\('\.\/PlayScreen'\)/.test(join_));

  console.log(`\n${failures === 0 ? 'ALL CHUNK DEADLINE TESTS PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}
void main();
