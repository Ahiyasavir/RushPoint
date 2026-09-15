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

console.log('');
if (failures > 0) {
  console.error(`✗ media-download-url: ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('✓ media-download-url: all assertions passed\n');
