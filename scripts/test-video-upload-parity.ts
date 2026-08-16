// The video content-type allowlist and size cap are enforced in FOUR places
// (change: video-submission-task), and they only work if they agree:
//   VIDEO_CONTENT_TYPES        @rushpoint/shared — the callable's kind gate
//   ALLOWED_CONTENT_TYPES      functions/uploadRoute.js — the VPS upload server
//   storage.rules              the emulator/dev upload path
//   MAX_VIDEO_BYTES            play-web's recorder, refusing before upload
//
// If one is narrower than another the player films, waits through an upload, and is
// THEN told no — strictly worse than not offering video at all. This is the same
// failure mode scripts/test-audio-recorder-guards.ts pins for audio.
//   npx tsx scripts/test-video-upload-parity.ts
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { VIDEO_CONTENT_TYPES } from '../packages/shared/src/mediaKinds';
import { VIDEO_DURATION_LIMITS } from '../packages/shared/src/videoDuration';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const uploadRoute = readFileSync(join(repo, 'functions/uploadRoute.js'), 'utf8');
const rules = readFileSync(join(repo, 'storage.rules'), 'utf8');
const taskRunner = readFileSync(join(repo, 'apps/play-web/src/components/TaskRunner.tsx'), 'utf8');

const sharedTypes = VIDEO_CONTENT_TYPES.map((t) => t.split('/')[1]).sort();
check('VIDEO_CONTENT_TYPES is parseable', sharedTypes.length === 3, sharedTypes.join(','));

// Every enforcement point expresses the set as a `video/(a|b|c)` alternation.
for (const [label, src] of [
  ['functions/uploadRoute.js', uploadRoute],
  ['storage.rules', rules],
] as const) {
  const alt = (src.match(/video\\?\/\(([a-z0-9|]+)\)/) || [])[1] ?? '';
  const got = alt.split('|').filter(Boolean).sort();
  const missing = sharedTypes.filter((t) => !got.includes(t));
  if (missing.length) console.error(`    ${label} is missing: ${missing.join(', ')}`);
  check(
    `${label} accepts every type in VIDEO_CONTENT_TYPES`,
    missing.length === 0,
    `got=${got.join(',')}`,
  );
  // And nothing EXTRA — a wider server gate would accept bytes the callable then
  // refuses on submission, which is the same dead end in the other direction.
  const extra = got.filter((t) => !sharedTypes.includes(t));
  check(`${label} accepts nothing beyond VIDEO_CONTENT_TYPES`, extra.length === 0, extra.join(','));
}

// ─── The byte cap is one number, expressed in three files ────────────────────
function mbOf(src: string, pattern: RegExp, label: string): number | undefined {
  const m = src.match(pattern);
  if (!m) { check(`${label} cap is parseable`, false); return undefined; }
  return Number(m[1]);
}
const serverMb = mbOf(uploadRoute, /MAX_PARTICIPANT_VIDEO_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/, 'uploadRoute');
const clientMb = mbOf(taskRunner, /MAX_VIDEO_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/, 'TaskRunner');
const rulesMb = mbOf(rules, /(\d+)\s*\*\s*1024\s*\*\s*1024;?\s*\/\/\s*20MB max|(\d+)\s*\*\s*1024\s*\*\s*1024\s*\/\/\s*20MB/, 'storage.rules');

check('the server and the recorder agree on the video cap',
  serverMb !== undefined && serverMb === clientMb, `server=${serverMb}MB client=${clientMb}MB`);
check('storage.rules carries the same video cap',
  rulesMb === serverMb, `rules=${rulesMb}MB server=${serverMb}MB`);

// ─── The cap must actually cover a ceiling-length clip ────────────────────────
// This is the assertion that fails if someone raises VIDEO_DURATION_LIMITS.ceiling
// without re-deriving the byte cap — the exact drift that would ship an upload path
// refusing missions the Builder happily authored.
check('the recorder pins its bitrate rather than taking the browser default',
  /videoBitsPerSecond:\s*VIDEO_BITS_PER_SECOND/.test(taskRunner));

const capBytes = (serverMb ?? 0) * 1024 * 1024;
const worstCase = ((2_000_000 + 96_000) * VIDEO_DURATION_LIMITS.ceilingSeconds) / 8;
check('a ceiling-length clip at the pinned bitrate fits under the cap',
  worstCase < capBytes,
  `${Math.round(worstCase / 1024 / 1024)}MB at ${VIDEO_DURATION_LIMITS.ceilingSeconds}s vs ${serverMb}MB cap`);

console.log(`\n${failures === 0 ? 'ALL VIDEO-UPLOAD-PARITY TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
