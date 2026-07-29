// Source guards for the audio-task recorder (change: audio-recorder-fallback).
// Run by scripts/run-unit-tests.mjs via `npm test`.
//
// THE BUG THIS PINS: `AudioEntry.start()` is an async function wired straight to
// `onClick`. `new MediaRecorder(...)` and `recorder.start()` both throw
// NotSupportedError on some Android and in-app (WhatsApp/Instagram) webviews —
// even after `isTypeSupported()` returned true AND the mic permission was
// granted. An uncaught throw inside that async handler became a floating
// REJECTED PROMISE: no error, no state change, no crash. The player tapped
// "start recording" and absolutely nothing happened.
//
// That failure is invisible to every other gate we own: it type-checks, it
// lints, and there is no component test runner for play-web. So this suite
// asserts the STRUCTURE that makes it impossible — every throwing call sits in a
// try/catch, and the unsupported path offers a real way to finish the task
// rather than a dead end.
//
//   npx tsx scripts/test-audio-recorder-guards.ts
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

// Strip comments FIRST. The comment above `new MediaRecorder(...)` explains the
// very bug being pinned, so a naive scan finds the prose rather than the call and
// reports it unguarded. Same trap that made the api-server CORS guard read 3KB of
// nothing. Strings are neutralised before line comments, so a `//` inside a
// string literal cannot truncate real code.
function stripComments(s: string): string {
  return s
    .replace(/'[^'\n]*'/g, "''")
    .replace(/"[^"\n]*"/g, '""')
    .split('\n')
    .map((l) => { const i = l.indexOf('//'); return i === -1 ? l : l.slice(0, i); })
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

// Isolate the recorder component so a try/catch elsewhere in this 1600-line file
// cannot satisfy these assertions.
const code = stripComments(src);
const start = code.indexOf('function AudioEntry');
ok(start !== -1, 'AudioEntry component must exist in TaskRunner.tsx');
const nextFn = code.indexOf('\nfunction ', start + 10);
const body = start === -1 ? '' : code.slice(start, nextFn === -1 ? undefined : nextFn);

// Attribute assertions read the RAW source: stripComments blanks string literals,
// so `accept="audio/*"` would arrive as `accept=""` and never match. Structural
// (try/catch) assertions use `body`; content assertions use `rawBody`.
const rawStart = src.indexOf('function AudioEntry');
const rawNext = src.indexOf('\nfunction ', rawStart + 10);
const rawBody = rawStart === -1 ? '' : src.slice(rawStart, rawNext === -1 ? undefined : rawNext);

// ── 1. Every throwing MediaRecorder call is guarded ─────────────────────────
// Both of these throw synchronously on real devices. Neither may sit bare in the
// async handler, or the rejection is swallowed and the button goes dead.
for (const [label, call] of [
  ['constructor', 'new MediaRecorder('],
  ['start()', 'recorder.start()'],
] as const) {
  const at = body.indexOf(call);
  ok(at !== -1, `AudioEntry must still call ${call}`);
  if (at === -1) continue;
  // Walk back to the nearest statement boundary and check we're inside a try.
  const before = body.slice(0, at);
  const lastTry = before.lastIndexOf('try {');
  const lastCatch = before.lastIndexOf('} catch');
  ok(
    lastTry !== -1 && lastTry > lastCatch,
    `the MediaRecorder ${label} must be inside a try/catch — an uncaught throw in this `
      + 'async onClick handler is a floating rejection, so the tap silently does nothing',
  );
}

// ── 2. Failure must reach the UI, not just be swallowed ─────────────────────
// A bare `catch {}` would satisfy assertion 1 while leaving the same dead button.
const catchBlocks = body.split('} catch').slice(1).map((b) => b.slice(0, 220));
const mediaCatches = catchBlocks.filter((b) => /setUnsupported|setErr/.test(b));
ok(
  mediaCatches.length >= 3,
  'each recorder failure path must set an error and/or the unsupported flag — an empty '
    + 'catch reproduces the original silent no-op',
);

// ── 3. The unsupported path is a way through, not a dead end ────────────────
// The original code rendered one sentence ("this browser cannot record") and
// stopped, stranding the player on a task they could not complete. A file input
// with `accept="audio/*"` opens the phone's own recorder and works inside the
// in-app webviews where getUserMedia does not.
ok(
  /type="file"/.test(rawBody) && /accept="audio\/\*"/.test(rawBody),
  'the unsupported path must offer a native file/recorder input so the task is still completable',
);
ok(
  /getUserMedia/.test(body) && /setUnsupported\(true\)/.test(body),
  'a denied/blocked getUserMedia must also fall through to that same input',
);

// ── 4. The mic is always released ───────────────────────────────────────────
// Every early return after getUserMedia must stop the tracks, or the recording
// indicator stays lit and the mic stays held after a failure.
const afterGum = body.slice(body.indexOf('getUserMedia'));
const failureReturns = afterGum.split('setUnsupported(true)').length - 1;
ok(failureReturns >= 2, 'the post-permission failure paths must set unsupported');
ok(
  (afterGum.match(/stopTracks\(\)/g) || []).length >= 2,
  'each post-permission failure path must call stopTracks() so the mic indicator clears',
);

// ── 5. The audio allow-list is the same in all THREE enforcement points ─────
// A submission is checked by `AUDIO_CONTENT_TYPES` (the callable), by
// `ALLOWED_CONTENT_TYPES` (the VPS upload server) and by storage.rules (the
// emulator/dev path). If one widens and another does not, the upload succeeds and
// the callable then refuses it — the player records, waits, and is told no. That
// is strictly worse than not offering the fallback at all, so pin them together.
const shared = readFileSync(join(repo, 'packages/shared/src/mediaKinds.ts'), 'utf8');
const serverSrc = readFileSync(join(repo, 'functions/server.js'), 'utf8');
const rules = readFileSync(join(repo, 'storage.rules'), 'utf8');

const sharedList = (shared.match(/AUDIO_CONTENT_TYPES\s*=\s*\[([\s\S]*?)\]/) || [])[1] ?? '';
const sharedTypes = [...sharedList.matchAll(/'audio\/([a-z0-9-]+)'/g)].map((m) => m[1]).sort();
ok(sharedTypes.length >= 4, 'AUDIO_CONTENT_TYPES must be parseable from shared');

for (const [label, src2] of [['functions/server.js', serverSrc], ['storage.rules', rules]] as const) {
  // Both express the set as an `audio/(a|b|c)` alternation.
  const alt = (src2.match(/audio\\?\/\(([a-z0-9|x\-]+)\)/) || [])[1] ?? '';
  const got = alt.split('|').filter(Boolean).sort();
  const missing = sharedTypes.filter((t) => !got.includes(t));
  if (missing.length) console.error(`    ${label} is missing: ${missing.join(', ')}`);
  ok(
    missing.length === 0,
    `${label} must accept every type in AUDIO_CONTENT_TYPES — a narrower gate here `
      + 'lets the upload succeed and then refuses the submission',
  );
}

// The client's extension fallback must only ever produce accepted types.
const extMap = (src.match(/AUDIO_EXT_TYPES[^=]*=\s*\{([\s\S]*?)\};/) || [])[1] ?? '';
const extTypes = [...extMap.matchAll(/'audio\/([a-z0-9-]+)'/g)].map((m) => m[1]);
const badExt = [...new Set(extTypes)].filter((t) => !sharedTypes.includes(t));
if (badExt.length) console.error(`    client would send unaccepted: ${badExt.join(', ')}`);
ok(badExt.length === 0, 'the client extension fallback must only emit accepted audio types');

console.log(`audio-recorder-guards: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
