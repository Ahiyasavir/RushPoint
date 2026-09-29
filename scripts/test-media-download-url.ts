// Pure-logic tests — a download button must actually download
// (change: download-actually-downloads)
//
// Reported: "when I press the download button in the organizer panel it still just
// opens the image in a tab and does not download it." That is the SPECIFIED behaviour
// of `<a download>` pointing at another origin - the attribute is ignored, because a
// page does not get to choose a filename for somebody else's server. Only a
// `Content-Disposition` from the serving origin can do it, and mediaServing.js has
// emitted one on `?download=1` since media-serving-correctness. Nothing asked for it.
import { mediaDownloadUrl, MEDIA_DOWNLOAD_FLAG } from '../packages/shared/src/mediaDownloadUrl';

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}\n      got  ${JSON.stringify(actual)}\n      want ${JSON.stringify(expected)}`);
}

const API = 'https://api.rush-point.com/uploads/runs/r1/teams/t1/clip.webm';

console.log('\n— the flag lands on the query —');
eq('a plain url gains the flag', mediaDownloadUrl(API), `${API}?download=1`);
eq('the flag name is what the server reads', MEDIA_DOWNLOAD_FLAG, 'download');
eq('an existing query is preserved',
  mediaDownloadUrl(`${API}?v=2`), `${API}?v=2&download=1`);
eq('a fragment stays at the end, not inside the query',
  mediaDownloadUrl(`${API}#t=10`), `${API}?download=1#t=10`);
eq('a query AND a fragment are both preserved',
  mediaDownloadUrl(`${API}?v=2#t=10`), `${API}?v=2&download=1#t=10`);
eq('a root-relative url works too',
  mediaDownloadUrl('/uploads/a.jpg'), '/uploads/a.jpg?download=1');

console.log('\n— idempotent: a button pressed twice cannot corrupt the url —');
eq('already flagged is returned unchanged',
  mediaDownloadUrl(`${API}?download=1`), `${API}?download=1`);
eq('flagged among others is unchanged',
  mediaDownloadUrl(`${API}?v=2&download=1`), `${API}?v=2&download=1`);
eq('a bare flag with no value counts as present',
  mediaDownloadUrl(`${API}?download`), `${API}?download`);
eq('double application is stable',
  mediaDownloadUrl(mediaDownloadUrl(API)), `${API}?download=1`);

console.log('\n— local urls are left ALONE: `download` already works there —');
eq('a blob url is untouched',
  mediaDownloadUrl('blob:https://player.rush-point.com/abc-123'),
  'blob:https://player.rush-point.com/abc-123');
eq('a data url is untouched',
  mediaDownloadUrl('data:image/png;base64,AAA'), 'data:image/png;base64,AAA');
eq('case does not matter', mediaDownloadUrl('BLOB:x'), 'BLOB:x');

console.log('\n— total: junk in, nothing invented out —');
for (const [label, v] of [
  ['null', null], ['undefined', undefined], ['a number', 7],
  ['an object', {}], ['an empty string', ''], ['whitespace only', '   '],
] as [string, unknown][]) {
  eq(`${label} ⇒ empty string`, mediaDownloadUrl(v as never), '');
}

let threw = false;
for (const v of [null, undefined, 0, {}, [], Symbol('x')]) {
  try { mediaDownloadUrl(v as never); } catch { threw = true; }
}
eq('nothing throws', threw, false);

// ── Every call site, not just the helper (field report 2026-09-27) ──────────────
// The helper above was correct and tested, and the organizer STILL got a video opened in
// a tab: the media gallery's per-item "הורדה" link pointed `<a download>` at the raw
// api.rush-point.com url, so only "download all" had been fixed. A helper nobody is
// made to call fixes nothing. So: every `<a … download=…>` in both apps must take its
// href from mediaDownloadUrl, or be declared here as a LOCAL url (blob:/data:), where
// the attribute does work. A declared entry that no longer exists fails too.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LOCAL_HREF_OK: { file: string; href: string; why: string }[] = [
  { file: 'apps/play-web/src/components/TaskRunner.tsx', href: 'preview',
    why: 'the player\'s own photo, an object url of the captured file' },
  { file: 'apps/play-web/src/components/TaskRunner.tsx', href: 'previewUrl',
    why: 'the player\'s own clip, an object url of the recorded blob' },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

console.log('\n— every <a download> in the apps goes through mediaDownloadUrl —');
const files = [...walk('apps/creator-web/src'), ...walk('apps/play-web/src')];
let anchors = 0;
const usedAllow = new Set<number>();
for (const abs of files) {
  const file = abs.replace(/\\/g, '/');
  const src = readFileSync(abs, 'utf8');
  // A JSX `download=` attribute (not the word in a comment or a `?download=1` string).
  const re = /\sdownload=\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const open = src.lastIndexOf('<a', m.index);
    if (open < 0) continue;
    anchors++;
    const element = src.slice(open, m.index + 400);
    const line = src.slice(0, m.index).split('\n').length;
    const href = /href=\{([^}]*)\}/.exec(element)?.[1]?.trim() ?? '(none)';
    if (href.startsWith('mediaDownloadUrl(')) { eq(`${file}:${line} uses the helper`, true, true); continue; }
    const allowIdx = LOCAL_HREF_OK.findIndex((a) => a.file === file && a.href === href);
    if (allowIdx >= 0) { usedAllow.add(allowIdx); eq(`${file}:${line} is a declared local url (${href})`, true, true); continue; }
    eq(`${file}:${line} href={${href}} must be mediaDownloadUrl(...) — a cross-origin <a download> just opens the file`, href, 'mediaDownloadUrl(...)');
  }
}
LOCAL_HREF_OK.forEach((a, i) => {
  if (!usedAllow.has(i)) eq(`stale allowlist entry ${a.file} href={${a.href}}`, 'present', 'gone');
});
// Print the denominator: "no bad anchors" must never be compatible with "found none".
console.log(`  (${anchors} <a download> element(s) examined in ${files.length} files)`);
eq('the sweep actually found anchors to examine', anchors > 0, true);

console.log('');
if (failures > 0) {
  console.error(`✗ media-download-url: ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('✓ media-download-url: all assertions passed\n');
