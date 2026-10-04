// An icon NAME must never be rendered as text.
//
// The no-stock-emoji change (2026-10-02) turned emoji fields into icon names
// ('sparkle', 'book', 'doc'). One renderer still wrote the field straight into the
// JSX, so the new-game wizard's three path cards showed the English words
// "sparkle", "book" and "doc" beside a Hebrew title. TypeScript cannot see it (an
// IconName is a string, and a string is a valid ReactNode), and the emoji scan is
// satisfied by it. Found by opening the wizard at 375px.
//
// The rule this enforces is narrow and certain: a JSX child that is exactly an
// identifier named like an icon (`{icon}`, `{x.icon}`, `{fooIcon}`) is a bug; it
// must go through <Icon name={…} />.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['apps/creator-web/src', 'apps/play-web/src'];

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out); }
    else if (p.endsWith('.tsx')) out.push(p);
  }
}

const files: string[] = [];
for (const d of DIRS) walk(path.join(ROOT, d), files);

// `>{icon}<`, `> {row.icon} <`, `>{fooIcon}</` — an icon-named value as a text child.
const RAW = />\s*\{\s*(?:[A-Za-z_$][\w$]*\.)?(?:icon|[a-z][\w$]*Icon)\s*\}\s*</g;
const hits: string[] = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(RAW)) {
    const line = src.slice(0, m.index).split('\n').length;
    hits.push(`${path.relative(ROOT, f)}:${line}  ${m[0].replace(/\s+/g, ' ')}`);
  }
}

let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}${detail ? `\n${detail}` : ''}`); }
};
console.log('\nicon names are drawn, never printed');
check(`the scan reached the apps (${files.length} .tsx files)`, files.length > 100);
check('no icon name is rendered as a text child', hits.length === 0, hits.join('\n'));

console.log(failures === 0 ? '\n✅ icon name not text: ALL PASS' : `\n❌ icon name not text: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
