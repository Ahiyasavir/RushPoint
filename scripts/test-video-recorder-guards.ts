// Source guards for the video-task recorder (VideoEntry in TaskRunner.tsx).
// Run by scripts/run-unit-tests.mjs via `npm test`.
//
// THE BUG THIS PINS: the shutter that ENDS a take was rendered
// `disabled={tooShort}` — greyed out until the mission's minimum clip length had
// elapsed. A player who tapped stop early got a dead grey control and no way out
// of a live recording. The camera kept rolling; the only escape was killing the
// app. It is the worst possible place for a disabled state, because the whole job
// of that control is escape.
//
// The minimum is a property of the CLIP, not of the RECORDING SESSION: it belongs
// on the submit button, where refusing has a remedy (record again), never on stop,
// where refusing has none. play-web has no component test runner, so the durable
// protection is a source scan.
//
// Guard 2 covers the second half of the same report — the viewfinder was a small
// box inside the mission card rather than a camera screen.
//
//   npx tsx scripts/test-video-recorder-guards.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(repo, 'apps/play-web/src/components/TaskRunner.tsx'), 'utf8');

// Same trap as the audio guards: the comment above `new MediaRecorder(...)`
// describes the very bug being pinned, so comments are stripped before any
// structural scan. Strings are neutralised first so a `//` inside a literal
// cannot truncate real code.
function stripComments(s: string): string {
  return s
    .replace(/'[^'\n]*'/g, "''")
    .replace(/"[^"\n]*"/g, '""')
    .split('\n')
    .map((l) => { const i = l.indexOf('//'); return i === -1 ? l : l.slice(0, i); })
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const code = stripComments(src);
const start = code.indexOf('function VideoEntry');
ok(start !== -1, 'VideoEntry component must exist in TaskRunner.tsx');
const nextFn = code.indexOf('\nfunction ', start + 10);
const body = start === -1 ? '' : code.slice(start, nextFn === -1 ? undefined : nextFn);

// Attribute/class assertions read the RAW source — stripComments blanks string
// literals, so `accept="video/*"` would arrive as `accept=""`.
const rawStart = src.indexOf('function VideoEntry');
const rawNext = src.indexOf('\nfunction ', rawStart + 10);
const rawBody = rawStart === -1 ? '' : src.slice(rawStart, rawNext === -1 ? undefined : rawNext);

// ── 1. The shutter can ALWAYS end a take ────────────────────────────────────
// The one <button> wired to stop() must carry no disabled attribute at all. A
// conditional expression would be just as bad as `disabled={tooShort}` — this is
// a control with no legitimate reason to ever be inert while recording.
const shutterAt = body.indexOf('stop()');
ok(shutterAt !== -1, 'VideoEntry must still call stop()');

// Every JSX <button …> element in the component, as raw attribute text.
// Handler arrows are masked first: `onClick={() => stop()}` inside the tag would
// otherwise end the match at the arrow's own `>`, hiding every attribute after it
// — including the `disabled` this suite exists to forbid.
const buttons = [...rawBody.replace(/=>/g, '=➜').matchAll(/<button\b([^>]*)>/g)]
  .map((m) => m[1].replace(/=➜/g, '=>'));
const stopButtons = buttons.filter((attrs) => /\bstop\(\)/.test(attrs));
ok(stopButtons.length >= 1, 'a <button> must be wired directly to stop()');
for (const attrs of stopButtons) {
  ok(
    !/\bdisabled\b/.test(attrs),
    'the shutter that ends a recording must NEVER be disabled — gating it on the '
      + "mission's minimum length is what trapped a player inside a live take with a "
      + 'dead grey button (gate the SUBMIT button instead)',
  );
}

// And the same rule stated against the minimum directly: whatever variable holds
// the too-short verdict must not appear inside any button that stops recording.
for (const attrs of stopButtons) {
  ok(
    !/tooShort/i.test(attrs),
    'the stop control must not consult the clip minimum in any form',
  );
}

// ── 2. The viewfinder is a camera screen, not a thumbnail in a card ─────────
// The original recorder rendered the live stream as a small `aspect-video` box
// inside the mission card. Filming a field mission through a postage stamp is how
// a player ends up with 30 seconds of pavement.
ok(
  /fixed inset-0/.test(rawBody),
  'the live viewfinder must render as a fullscreen fixed overlay, not inline in the mission card',
);
ok(
  /object-cover/.test(rawBody) && /h-full w-full/.test(rawBody),
  'the viewfinder <video> must fill that overlay',
);
// One shutter, two states — the camera-app shape the report asked for: press to
// start, press the same control again to stop.
ok(
  /recording \? stop\(\) : beginRecording\(\)/.test(stripComments(rawBody).replace(/\s+/g, ' ')),
  'one shutter button must toggle the take: press to start, press again to stop',
);
ok(
  /aria-label=\{recording \?/.test(rawBody),
  'the shutter is icon-only, so its accessible name must change with its state',
);

// ── 3. Stopping still cannot hang ───────────────────────────────────────────
// `onstop` does not fire on every browser, so stop() must finalize on the throw
// path AND behind a watchdog. Without both, "stop" leaves the UI recording
// forever — a different route to the same trap.
const stopFn = body.slice(body.indexOf('function stop()'));
const stopBody = stopFn.slice(0, stopFn.indexOf('\n  }') + 4);
ok(/recorder\.stop\(\)/.test(stopBody), 'stop() must call recorder.stop()');
ok(/catch\s*\{[\s\S]{0,120}finalize\(\)/.test(stopBody), 'a throwing recorder.stop() must still finalize');
ok(/watchdogRef\.current = setTimeout/.test(stopBody), 'stop() must arm a watchdog so a missing onstop cannot hang the take');
ok(/finalizedRef/.test(body), 'finalize() must be idempotent (finalizedRef), since three paths can reach it');

// ── 4. The camera is always released ────────────────────────────────────────
// Every failure path after getUserMedia must stop the tracks, or the phone's
// recording indicator stays lit and the camera stays held.
const afterGum = body.slice(body.indexOf('getUserMedia'));
ok(
  (afterGum.match(/stopTracks\(\)/g) || []).length >= 2,
  'each post-permission failure path must call stopTracks() so the camera indicator clears',
);

// ── 5. The unsupported path is still a way through ─────────────────────────
ok(
  /type="file"/.test(rawBody) && /accept="video\/\*"/.test(rawBody),
  'the unsupported path must offer the phone camera via a file input',
);

console.log(`video-recorder-guards: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
