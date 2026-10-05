// Printing from the creator console must print the page (Ahiya, 2026-10-05: the host sheet
// printed as 8 empty pages with only the browser's header and footer).
//
// Cause: a GLOBAL print rule in apps/creator-web/src/index.css, written for a station QR sheet,
// hid every element on every page (`body * { visibility: hidden }`) and showed only
// `.print-sheet`. The QR printing moved to its own window long ago and nothing renders
// `.print-sheet` any more, so the rule blanked every print in the app while keeping the layout,
// which is why the page count was right and the pages were empty. A page that wants a special print
// layout scopes its own print CSS (HostSheetPage's PRINT_CSS); the global stylesheet must not hide
// the body.
//   npx tsx scripts/test-print-css.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : `  → ${detail}`}`);
  if (!cond) failures++;
}

const root = path.resolve(__dirname, '..');
const cssFiles: string[] = [];
function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(css|tsx)$/.test(name)) cssFiles.push(p);
  }
}
for (const app of ['apps/creator-web/src', 'apps/play-web/src']) walk(path.join(root, app));
ok(`scanned the apps' styles and components (${cssFiles.length} files)`, cssFiles.length > 50, String(cssFiles.length));

// Any print rule that hides the whole body: `body * { visibility: hidden` or `body > * { display: none`.
const HIDES_BODY = /body\s*>?\s*\*\s*\{[^}]*(visibility\s*:\s*hidden|display\s*:\s*none)/;
const offenders = cssFiles.filter((f) => HIDES_BODY.test(readFileSync(f, 'utf8'))).map((f) => path.relative(root, f));
ok('no stylesheet hides the whole body when printing', offenders.length === 0, offenders.join(', '));

const hostSheet = readFileSync(path.join(root, 'apps/creator-web/src/pages/HostSheetPage.tsx'), 'utf8');
ok('the host sheet still carries its own print CSS', /@media print/.test(hostSheet) && /\.hs-toolbar/.test(hostSheet));

console.log(failures === 0 ? '\n✅ print css: ALL PASS' : `\n❌ print css: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
