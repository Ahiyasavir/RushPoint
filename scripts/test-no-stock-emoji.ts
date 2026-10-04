// No stock emoji in the apps' UI (ratchet).
//
// Ahiya, 2026-10-02: "the fire icon should be something you make, not a regular emoji; in general I
// don't want regular emoji in the texts of the app." Stock emoji look generic and render differently on
// every phone; icons are drawn (creator-web components/builderIcons.tsx, play-web components/FuseIcons.tsx).
//
// The two apps carried 561 of them when this rule was set (change: no-stock-emoji took them to 0).
// The ceiling mechanism stays, so a future exception is a visible edit here:
//   1. each app's count may only go DOWN (lower the ceiling below when you remove some, the test says so);
//   2. files listed in ZERO_FILES (new UI written after the rule) must hold none at all.
// Comments are not UI and are skipped. Plain typographic glyphs (✕ › · ▾ …) are text, not emoji.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F2FF}⭐⭕⌚⌛⏩-⏺‼⁉]/gu;
// Stars are deliberately NOT here: ★ ☆ live in the same symbol block and render differently per phone,
// so they are drawn too (the "star" icon, outlined or filled).
const TEXT_GLYPHS = new Set([...'✓✔✕✖✗✘•·›‹▾▴▸◂↶↷→←↑↓⋯…']);

const CEILING: Record<string, number> = {
  'apps/creator-web/src': 0,
  'apps/play-web/src': 0,
};
const ZERO_FILES = [
  'apps/creator-web/src/components/MissionSettingsRows.tsx',
  'apps/creator-web/src/lib/missionSettingsRows.ts',
  'apps/creator-web/src/components/FollowedStrip.tsx',
  'apps/play-web/src/components/StaffFollowedStrip.tsx',
  'apps/play-web/src/components/FuseIcons.tsx',
];

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS  ${name}`);
  else { failed++; console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`); }
}

function countIn(file: string): { n: number; lines: string[] } {
  let n = 0;
  const lines: string[] = [];
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const s = line.trim();
    if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) return;
    const hits = (line.match(EMOJI) ?? []).filter((c) => !TEXT_GLYPHS.has(c));
    if (hits.length) { n += hits.length; lines.push(`${i + 1}: ${hits.join(' ')}`); }
  });
  return { n, lines };
}
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

for (const [root, ceiling] of Object.entries(CEILING)) {
  const files = walk(root);
  const total = files.reduce((acc, f) => acc + countIn(f).n, 0);
  check(`${root}: ${total} stock emoji across ${files.length} files, ceiling ${ceiling}`, total <= ceiling,
    'a stock emoji was added; draw an icon instead (see the header)');
  if (total < ceiling) console.log(`      ↓ ${ceiling - total} removed: lower this app's CEILING to ${total} so they cannot come back`);
}
for (const f of ZERO_FILES) {
  const { n, lines } = countIn(f);
  check(`${f} has no stock emoji`, n === 0, lines.join(' | '));
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
