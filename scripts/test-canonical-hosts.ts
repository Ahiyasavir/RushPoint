// Guard: no app source links to a Firebase default host.
// Run by scripts/run-unit-tests.mjs via `npm test`.
//
// Every cross-app link resolves as `VITE_*_URL ?? <fallback>`, and that fallback
// was the Firebase default host copied into eight files. A build with the env var
// missing or misspelled therefore shipped links to `rushpoint-play.web.app` /
// `rushpoint-creator.web.app` instead of the real domain — silently, because a
// wrong-but-live URL is indistinguishable from a right one. The project has a
// real domain; the fallback is now CANONICAL_PLAY_URL / CANONICAL_CREATOR_URL
// from @rushpoint/shared, and this test keeps the literals from creeping back.
//
// Scope is deliberately apps/*/src only: docs and the hosting-redirect table
// legitimately NAME the old hosts (that redirect is what makes them harmless).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { CANONICAL_PLAY_URL, CANONICAL_CREATOR_URL, LEGACY_FIREBASE_HOSTS } from '../packages/shared/src/canonicalHosts';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['apps/play-web/src', 'apps/creator-web/src'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

// A LINK is a full URL literal. A bare mention inside a comment is prose, not a
// link, so only flag the `https://<host>` form actually usable as a destination.
const offenders: string[] = [];
for (const root of ROOTS) {
  for (const file of walk(join(repo, root))) {
    const src = readFileSync(file, 'utf8');
    src.split('\n').forEach((line, i) => {
      for (const host of LEGACY_FIREBASE_HOSTS) {
        if (line.includes(`https://${host}`)) {
          offenders.push(`${relative(repo, file)}:${i + 1} → https://${host}`);
        }
      }
    });
  }
}

if (offenders.length) offenders.forEach((o) => console.error(`  ✗ ${o}`));
ok(offenders.length === 0, 'no app source links to a Firebase default host');

// The constants themselves must stay on the real domain.
ok(CANONICAL_PLAY_URL === 'https://rush-point.com', 'CANONICAL_PLAY_URL is the real play domain');
ok(CANONICAL_CREATOR_URL === 'https://creator.rush-point.com', 'CANONICAL_CREATOR_URL is the real creator domain');
ok(!LEGACY_FIREBASE_HOSTS.some((h) => [CANONICAL_PLAY_URL, CANONICAL_CREATOR_URL].some((u) => u.includes(h))),
  'neither canonical URL is a Firebase default host');

console.log(`canonical-hosts: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
