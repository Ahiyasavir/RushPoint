// The photo mission shows ONE next action (found playing at 375px, 2026-10-03).
//
// Before a photo existed, the biggest, orange button on the screen was "send
// photo" and the thing the player actually had to do ("take a photo") was a quiet
// outlined one. Pressing send then said "take a photo first", which is the
// screen correcting a choice it had steered the player into.
//
// The rule now: no photo yet ⇒ "take a photo" is the primary button and there is
// no send button at all. A photo exists ⇒ "send" is primary (and still answers,
// rather than going dead, if something is still in the way), and "take again"
// steps back to secondary. No component runner exists, so this asserts on the
// source of PhotoEntry in TaskRunner.tsx.
import { readFileSync } from 'node:fs';

const src = readFileSync('apps/play-web/src/components/TaskRunner.tsx', 'utf8');
const start = src.indexOf('function PhotoEntry(');
const end = src.indexOf('\nfunction ', start + 10);
const body = start >= 0 ? src.slice(start, end > start ? end : undefined) : '';

let failures = 0;
const check = (name: string, ok: boolean) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`); }
};

console.log('\nphoto mission: one next action');
check('PhotoEntry was found', body.length > 1000);
// Every "take" button picks its variant from whether a photo exists.
// One line per opening tag; `=>` inside the props rules out a `[^>]*` match.
const takes = [...body.matchAll(/<Button[^\n]*data-testid="photo-take"[^\n]*/g)].map((m) => m[0]);
check(`the take buttons were found (${takes.length})`, takes.length >= 2);
check('each take button is primary until a photo exists',
  takes.every((t) => /variant=\{file \? 'ghost' : 'primary'\}/.test(t)));
// The send button exists only once there is a file.
check('the send button renders only once a photo exists',
  /\{file && \(\s*<Button[\s\S]{0,900}data-testid="photo-submit"/.test(body));

// With a photo, send comes BEFORE the retake controls: on a 375px phone the
// preview pushed a send placed last below the fold, under two retake buttons.
const sendAt = body.indexOf('data-testid="photo-submit"');
const lateCapture = body.indexOf('{file && captureControls}');
check('with a photo, the retake controls come after send', sendAt > 0 && lateCapture > sendAt);
check('without a photo, the capture controls lead', /\{!file && captureControls\}/.test(body));

console.log(failures === 0 ? '\n✅ photo entry: ALL PASS' : `\n❌ photo entry: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
