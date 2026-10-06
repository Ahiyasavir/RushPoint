// Pure-logic tests for game-intro-instructions (the "How to play" primer helpers).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import {
  cleanGameInstructions,
  gameInstructionsHasContent,
  localizedInstructionsBody,
} from '@rushpoint/shared';
import type { GameInstructions } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}
function eq(a: unknown, b: unknown, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

// ── cleanGameInstructions ─────────────────────────────────────────────────────
eq(cleanGameInstructions(undefined), undefined, 'undefined → undefined');
eq(cleanGameInstructions(null), undefined, 'null → undefined');
eq(cleanGameInstructions({}), undefined, 'empty object → undefined');
eq(cleanGameInstructions({ title: '   ', body: '', bodyHe: '  ' }), undefined,
  'whitespace-only primer → undefined');

eq(
  cleanGameInstructions({ title: '  How to play  ', body: '  Walk to the pin.  ', bodyHe: '  לכו לנקודה.  ' }),
  { title: 'How to play', body: 'Walk to the pin.', bodyHe: 'לכו לנקודה.' },
  'trims every string field',
);

eq(
  cleanGameInstructions({ title: 'T', body: 'B', imageUrl: '  https://cdn.example.com/x.png  ' }),
  { title: 'T', body: 'B', imageUrl: 'https://cdn.example.com/x.png' },
  'keeps + trims an https image',
);

eq(
  cleanGameInstructions({ title: 'T', body: 'B', imageUrl: 'http://cdn.example.com/x.png' }),
  { title: 'T', body: 'B' },
  'drops a non-https (http) image',
);

eq(
  cleanGameInstructions({ imageUrl: 'javascript:alert(1)' }),
  undefined,
  'a non-https-only primer → undefined (image dropped, nothing survives)',
);

eq(
  cleanGameInstructions({ imageUrl: 'https://cdn.example.com/only.png' }),
  { imageUrl: 'https://cdn.example.com/only.png' },
  'an https-image-only primer survives',
);

const full: GameInstructions = {
  title: 'How to play',
  body: 'Complete each stage.',
  bodyHe: 'השלימו כל שלב.',
  imageUrl: 'https://cdn.example.com/diagram.png',
};
eq(cleanGameInstructions(full), full, 'a full valid primer is preserved verbatim');

// ── videoUrl (issue 48, Ahiya 2026-10-06: a YouTube video as the instructions, watched before the
// start). Every common link form is stored as the canonical embed URL; anything else is dropped.
const EMBED = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
eq(cleanGameInstructions({ videoUrl: 'https://youtu.be/dQw4w9WgXcQ' })?.videoUrl, EMBED, 'youtu.be link → embed');
eq(cleanGameInstructions({ videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5s' })?.videoUrl, EMBED, 'watch?v= link → embed');
eq(cleanGameInstructions({ videoUrl: 'https://youtube.com/shorts/dQw4w9WgXcQ' })?.videoUrl, EMBED, 'shorts link → embed');
eq(cleanGameInstructions({ videoUrl: EMBED })?.videoUrl, EMBED, 'a stored embed URL survives a re-save unchanged');
eq(cleanGameInstructions({ title: 'T', videoUrl: 'https://vimeo.com/1234' }), { title: 'T' }, 'a non-YouTube link is dropped');
eq(cleanGameInstructions({ videoUrl: '   ' }), undefined, 'an empty link clears');
eq(cleanGameInstructions({ videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }), { videoUrl: EMBED }, 'a video alone is a primer');
ok(gameInstructionsHasContent({ videoUrl: EMBED }), 'video present → true');
ok(!gameInstructionsHasContent({ videoUrl: 'nope' }), 'an unusable video alone → false');

// ── gameInstructionsHasContent ────────────────────────────────────────────────
ok(!gameInstructionsHasContent(undefined), 'undefined → false');
ok(!gameInstructionsHasContent({}), 'empty → false');
ok(!gameInstructionsHasContent({ title: '   ', body: '  ' }), 'whitespace-only → false');
ok(!gameInstructionsHasContent({ imageUrl: 'http://x/x.png' }), 'non-https image only → false');
ok(gameInstructionsHasContent({ title: 'Hi' }), 'title present → true');
ok(gameInstructionsHasContent({ body: 'Go' }), 'body present → true');
ok(gameInstructionsHasContent({ bodyHe: 'לכו' }), 'bodyHe present → true');
ok(gameInstructionsHasContent({ imageUrl: 'https://x/x.png' }), 'https image present → true');

// ── localizedInstructionsBody ─────────────────────────────────────────────────
eq(localizedInstructionsBody(undefined, 'en'), '', 'undefined primer → empty string');
eq(localizedInstructionsBody({ body: 'English', bodyHe: 'עברית' }, 'he'), 'עברית', 'he → bodyHe');
eq(localizedInstructionsBody({ body: 'English' }, 'he'), 'English', 'he falls back to body');
eq(localizedInstructionsBody({ body: 'English', bodyHe: 'עברית' }, 'en'), 'English', 'en → body');
eq(localizedInstructionsBody({ body: '  spaced  ' }, 'en'), 'spaced', 'trims the returned body');

console.log(failed === 0
  ? `\n✅ ALL GAME-INSTRUCTIONS TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
