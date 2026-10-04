// No pale text on the light themes of play-web and creator-web (found playing a flash
// mission, 2026-10-04).
//
// play-web is light ("Warm Trail") and reverses only the ZINC scale in its Tailwind
// config, so `text-zinc-200` reads dark. Every OTHER colour scale is untouched: a
// `text-purple-200` left over from the dark theme is #e9d5ff on a near-white card,
// about 1.2:1. That was the flash mission's TITLE on a player's phone, plus its
// timer, its badge and the "you won" line. The a11y scan checks contrast between
// tokens it can resolve; it cannot know that a stock Tailwind shade is on a light
// card, so this rule is stated directly: a 50 to 300 text shade of any non-zinc
// scale is not used, except where the line is declared to sit on a dark backdrop.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'apps/play-web/src';
const PALE = /\btext-(purple|violet|fuchsia|indigo|sky|emerald|amber|rose|red|green|blue|teal|cyan|lime|orange|yellow|pink)-(50|100|200|300)\b/g;

/** Lines that sit on a dark backdrop, by a substring of the line, each with its reason. */
const ON_DARK: Record<string, string> = {
  'moment.bonusPoints': 'the full-screen flash "moment" overlay: white text on a dark backdrop',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} :: ${JSON.stringify(detail)}`); }
};

console.log('\nno pale text on the light theme');
const files = walk(ROOT);
const hits: string[] = [];
const usedAllow = new Set<string>();
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (!PALE.test(line)) return;
    PALE.lastIndex = 0;
    const allow = Object.keys(ON_DARK).find((k) => line.includes(k));
    if (allow) { usedAllow.add(allow); return; }
    hits.push(`${f}:${i + 1}  ${line.trim().slice(0, 100)}`);
  });
}
check(`the scan reached play-web (${files.length} files)`, files.length > 30);
check('no pale text shade on a light surface', hits.length === 0, hits);
check('no stale on-dark exception', Object.keys(ON_DARK).every((k) => usedAllow.has(k)), Object.keys(ON_DARK).filter((k) => !usedAllow.has(k)));

// creator-web is light by default too (dark is opt-in), and its ink tokens (`ink-amber`,
// `ink-alert`, ...) exist for exactly this. A base (not `dark:`, not `hover:`) 50 to 400 shade
// of a non-zinc scale is pale on its light surfaces: `text-amber-400` is about 1.7:1 on white.
const CREATOR_PALE = /(?:^|[\s"'`])text-(purple|violet|fuchsia|indigo|sky|emerald|amber|rose|red|green|blue|teal|cyan|lime|orange|yellow|pink)-(50|100|200|300|400)\b/;
const creatorFiles = walk('apps/creator-web/src');
const creatorHits: string[] = [];
for (const f of creatorFiles) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (CREATOR_PALE.test(line)) creatorHits.push(`${f}:${i + 1}  ${line.trim().slice(0, 100)}`);
  });
}
check(`creator-web: the scan reached it (${creatorFiles.length} files)`, creatorFiles.length > 30);
check('creator-web: no pale base text shade (use the ink tokens)', creatorHits.length === 0, creatorHits);

console.log(failures === 0 ? '\n✅ pale text: ALL PASS' : `\n❌ pale text: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
