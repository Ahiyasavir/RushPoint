/**
 * The uploaded media budget (change: editable-pages-and-media).
 *
 * Uploads are committed to the repository, which is what makes them work with no
 * storage service and no third party watching who views them. The cost is that
 * **git keeps every version of a file forever**: replacing a 40 MB video five
 * times leaves 200 MB in the repository permanently, even though only the last
 * one is on the site. Nothing warns you, the site stays fast, and the damage is
 * awkward to undo because it means rewriting history.
 *
 * So the budget is enforced at the point where it is still cheap to fix: before
 * the file is committed. This is a guard against an expensive mistake, not a
 * style rule, which is why the message says what to do rather than just failing.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const UPLOADS = join(ROOT, 'apps', 'marketing', 'public', 'uploads');

/** A still image has no excuse to be large; a video legitimately is. */
const BUDGET_MB: Record<'image' | 'video' | 'other', number> = {
  image: 2,
  video: 40,
  other: 5,
};

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v']);

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = '', hint = ''): void {
  checks += 1;
  if (!ok) failures += 1;
  const suffix = [detail, ok ? '' : hint].filter(Boolean).join(' — ');
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${suffix ? ` :: ${suffix}` : ''}`);
}

function kindOf(file: string): 'image' | 'video' | 'other' {
  const ext = extname(file).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return 'other';
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// An absent uploads directory is not a failure: a site with no pictures yet is a
// normal state. It IS reported, so "0 files checked" never reads as "all good".
if (!existsSync(UPLOADS)) {
  console.log('PASS  the uploads directory is absent, so there is nothing to check');
  console.log('\nALL MEDIA TESTS PASSED :: 0 files');
  process.exit(0);
}

const files = walk(UPLOADS).filter((f) => !f.endsWith('README.md'));

let totalBytes = 0;
for (const file of files) {
  const bytes = statSync(file).size;
  totalBytes += bytes;
  const kind = kindOf(file);
  const budget = BUDGET_MB[kind] * 1024 * 1024;
  const name = file.slice(UPLOADS.length + 1).replace(/\\/g, '/');

  check(
    `${name} is within the ${kind} budget`,
    bytes <= budget,
    `${(bytes / 1024 / 1024).toFixed(1)} MB of ${BUDGET_MB[kind]} MB`,
    kind === 'video'
      ? 'trim it, or export at 1080p or smaller. Git keeps every version forever, so this is easier to fix now than later'
      : 'export it smaller, or save it as webp',
  );
}

// The whole directory, not only each file. Fifty files just inside the per-file
// budget is the same problem arriving slowly.
const TOTAL_BUDGET_MB = 300;
check(
  'the uploads directory as a whole is within budget',
  totalBytes <= TOTAL_BUDGET_MB * 1024 * 1024,
  `${(totalBytes / 1024 / 1024).toFixed(1)} MB of ${TOTAL_BUDGET_MB} MB across ${files.length} file(s)`,
  'remove what is no longer used on the site, or move the largest videos to a hosting service',
);

console.log('');
if (failures > 0) {
  console.log(`MEDIA TESTS FAILED :: ${failures} of ${checks}`);
  process.exit(1);
}
console.log(`ALL MEDIA TESTS PASSED :: ${files.length} file(s), ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
