// Pure-logic tests — a cancelled camera must never eat a photo
// (change: camera-capture-never-eats-a-photo)
//
// Reported from the field: "when I take a photo it does not save it, and after I press
// OK it puts me back on 'take a photo' instead of 'send photo' ... it is as if it
// deletes it." `pickFile` treated an EMPTY change event - which is exactly how every
// mobile browser reports a CANCELLED camera - as "clear the photo".
import { pickedFileVerdict } from '../apps/play-web/src/lib/capturePick';

const MAX_RAW = 40 * 1024 * 1024;

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

console.log('\n— THE BUG: nothing arrived, so nothing may change —');
for (const [label, f] of [
  ['a cancelled camera (no file)', null],
  ['an undefined file', undefined],
  ['a zero-byte file, which Android hands back on a failed capture', { type: 'image/jpeg', size: 0 }],
  ['a file with no size at all', { type: 'image/jpeg' }],
  ['a NaN size', { type: 'image/jpeg', size: Number.NaN }],
  ['a negative size', { type: 'image/jpeg', size: -1 }],
  ['a garbage file object', 'not-a-file'],
] as [string, unknown][]) {
  eq(`${label} ⇒ keep`, pickedFileVerdict(f as never, MAX_RAW), { action: 'keep', reason: '' });
}

console.log('\n— a real capture replaces —');
eq('an ordinary JPEG replaces',
  pickedFileVerdict({ type: 'image/jpeg', size: 3_000_000 }, MAX_RAW), { action: 'replace', reason: '' });
eq('a PNG replaces',
  pickedFileVerdict({ type: 'image/png', size: 900_000 }, MAX_RAW), { action: 'replace', reason: '' });
eq('a HEIC capture replaces',
  pickedFileVerdict({ type: 'image/heic', size: 4_000_000 }, MAX_RAW), { action: 'replace', reason: '' });

// Some Android pickers omit the MIME type entirely. Refusing on that would reject a
// perfectly good capture - the same quirk AUDIO_EXT_TYPES already exists for.
eq('an empty type is NOT a refusal',
  pickedFileVerdict({ type: '', size: 2_000_000 }, MAX_RAW), { action: 'replace', reason: '' });
eq('a missing type is NOT a refusal',
  pickedFileVerdict({ size: 2_000_000 }, MAX_RAW), { action: 'replace', reason: '' });

console.log('\n— a genuinely wrong file is refused, and STILL keeps what is held —');
eq('a PDF is refused as not an image',
  pickedFileVerdict({ type: 'application/pdf', size: 1000 }, MAX_RAW),
  { action: 'reject', reason: 'notAnImage' });
eq('a video is refused as not an image',
  pickedFileVerdict({ type: 'video/mp4', size: 1000 }, MAX_RAW),
  { action: 'reject', reason: 'notAnImage' });
eq('an absurd raw capture is refused as too large',
  pickedFileVerdict({ type: 'image/jpeg', size: MAX_RAW + 1 }, MAX_RAW),
  { action: 'reject', reason: 'tooLarge' });
eq('exactly at the ceiling is still accepted',
  pickedFileVerdict({ type: 'image/jpeg', size: MAX_RAW }, MAX_RAW),
  { action: 'replace', reason: '' });

console.log('\n— a broken ceiling must not refuse a valid photo —');
for (const [label, cap] of [
  ['a zero ceiling', 0],
  ['a negative ceiling', -5],
  ['a NaN ceiling', Number.NaN],
  ['an Infinite ceiling', Number.POSITIVE_INFINITY],
] as [string, number][]) {
  eq(`${label} still accepts an ordinary photo`,
    pickedFileVerdict({ type: 'image/jpeg', size: 3_000_000 }, cap), { action: 'replace', reason: '' });
}

console.log('\n— the verdict is total: nothing throws —');
let threw = false;
for (const bad of [null, undefined, 0, '', [], {}, { size: {} }, { type: 7, size: 10 }]) {
  try { pickedFileVerdict(bad as never, MAX_RAW); } catch { threw = true; }
}
ok('no input shape throws', !threw);
// `reason` is non-empty only for a rejection - a caller keys its message on it.
ok('only a rejection carries a reason',
  ['keep', 'replace'].every((a) => {
    const v = a === 'keep'
      ? pickedFileVerdict(null, MAX_RAW)
      : pickedFileVerdict({ type: 'image/jpeg', size: 10 }, MAX_RAW);
    return v.reason === '';
  }));

console.log('');
if (failures > 0) {
  console.error(`✗ capture-pick: ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('✓ capture-pick: all assertions passed\n');
