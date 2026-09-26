// Guards the naming and layout rules of docs/marketing. Run by
// scripts/run-unit-tests.mjs via `npm test`. No emulator, no network.
//
//   npx tsx scripts/test-marketing-structure.ts
//
// Why this exists: the folder was reorganised on 2026-09-22 because every file
// had been named in its own private style, and nobody could tell which cut of a
// reel was the current one. The rules that fixed it are written in
// docs/marketing/README.md. A rule that lives only in a README is a suggestion;
// this makes it a gate, so the mess cannot come back one convenient exception
// at a time.
//
// Four units:
//   1. the top level holds exactly the declared folders
//   2. every video sits in videos/<published|drafts>/<NN>-<slug>/, NN unique
//   3. every delivered mp4 is <NN>-<slug>-v<N>[-variant][-small].mp4
//   4. every video README carries the same five headings
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', 'docs', 'marketing');

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  x ${msg}`); }
}

const dirs = (p: string) =>
  fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];
const files = (p: string) =>
  fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true })
    .filter((e) => e.isFile()).map((e) => e.name).sort() : [];

// ── 1. the top level ─────────────────────────────────────────────────────────
// Declared, never inferred: a new top level folder is a decision, and it should
// have to be made here as well as on disk.
const TOP = ['footage', 'graphics', 'music', 'playbooks', 'tools', 'videos'];
{
  const got = dirs(ROOT);
  ok(got.join() === TOP.join(),
    `docs/marketing top level is exactly ${TOP.join(', ')} (got ${got.join(', ') || 'nothing'})`);
  ok(fs.existsSync(path.join(ROOT, 'README.md')),
    'docs/marketing/README.md exists (it carries the rules)');
}

// ── 2. one folder per video, numbered once ───────────────────────────────────
const STATES = ['drafts', 'published'];
const FOLDER = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
type Video = { state: string; folder: string; nn: string; slug: string; dir: string };
const videos: Video[] = [];
{
  // Only the declared states, never anything else. `drafts/` may be ABSENT: git
  // does not track an empty directory, so a clean checkout (CI) never has one
  // until a draft exists. `published/` must be there.
  const got = dirs(path.join(ROOT, 'videos'));
  ok(got.every((d) => STATES.includes(d)) && got.includes('published'),
    `videos/ holds only ${STATES.join(' and ')}, with published present (got ${got.join(', ') || 'nothing'})`);
  for (const state of STATES) {
    for (const folder of dirs(path.join(ROOT, 'videos', state))) {
      const m = FOLDER.exec(folder);
      ok(m !== null,
        `videos/${state}/${folder} is named <NN>-<slug>, two digits then lower case kebab`);
      if (m) {
        videos.push({ state, folder, nn: m[1], slug: m[2],
          dir: path.join(ROOT, 'videos', state, folder) });
      }
    }
  }
  ok(videos.length > 0, 'at least one video folder exists');
  // A number is allocation order and is never reused, so a duplicate means two
  // videos are claiming the same identity across published/ and drafts/.
  const seen = new Map<string, string>();
  for (const v of videos) {
    const prev = seen.get(v.nn);
    ok(prev === undefined,
      `number ${v.nn} is used once (${v.folder}${prev ? ` collides with ${prev}` : ''})`);
    if (prev === undefined) seen.set(v.nn, `${v.state}/${v.folder}`);
  }
}

// ── 3. every delivered file carries the folder's name and a version ──────────
// `source/` is raw input that arrived with whatever name it had, so it is out of
// scope on purpose; the rule governs what WE produce.
//
// The mp4s themselves are gitignored (docs/marketing/.gitignore: *.mp4), so a
// clean checkout - CI - has none at all. "Every video holds an mp4" is therefore
// enforced only where renders exist on disk (any mp4 anywhere under videos/):
// on the machine that makes them, a folder missing its delivery still fails; in
// CI the naming rules below still judge whatever is present.
const MP4 = (f: string) => f.toLowerCase().endsWith('.mp4');
const rendersPresent = videos.some((v) => files(v.dir).some(MP4));
{
  for (const v of videos) {
    const mp4s = files(v.dir).filter(MP4);
    if (rendersPresent) ok(mp4s.length > 0, `${v.folder} holds at least one mp4`);
    // No backslash escapes anywhere in this pattern on purpose. It is built
    // inside a template literal, and a tool that writes the file can turn a
    // lone backslash into nothing at all; the check then matches nothing and
    // still reports success. [0-9] and [.] say the same thing and cannot be
    // silently disarmed.
    const shape = new RegExp('^' + v.nn + '-' + v.slug + '-v([0-9]+)(-[a-z0-9-]+)?[.]mp4$');
    const masters = new Set<string>();
    const smalls = new Set<string>();
    for (const f of mp4s) {
      const m = shape.exec(f);
      ok(m !== null,
        `${v.folder}/${f} is named ${v.nn}-${v.slug}-v<N>[-variant][-small].mp4`);
      if (!m) continue;
      // The version must always be present, which is what makes "highest wins"
      // a usable rule instead of a guess.
      ok(Number(m[1]) >= 1, `${v.folder}/${f} declares a version of at least 1`);
      if (m[2] === '-small') smalls.add(m[1]);
      else if (m[2] === undefined) masters.add(m[1]);
    }
    // Every master needs a share copy, or the next person re-encodes one by hand
    // and names it whatever they like. That is how this folder drifted before.
    for (const ver of masters) {
      ok(smalls.has(ver),
        `${v.folder} v${ver} has a -small share copy beside its master`);
    }
  }
}

// ── 4. the five headings ─────────────────────────────────────────────────────
// Extra headings are fine. These five are not optional, because they are the
// questions someone always has: is it live, what does it say, why is it like
// that, did it work, what is left.
const HEADINGS = ['סטטוס', 'התסריט', 'למה זה בנוי ככה', 'מה נמדד', 'פתוח'];
{
  for (const v of videos) {
    const readme = path.join(v.dir, 'README.md');
    ok(fs.existsSync(readme), `${v.folder}/README.md exists`);
    if (!fs.existsSync(readme)) continue;
    const got = [...fs.readFileSync(readme, 'utf8').matchAll(/^## (.+)$/gm)]
      .map((m) => m[1].trim());
    for (const h of HEADINGS) {
      ok(got.includes(h), `${v.folder}/README.md carries the "${h}" heading`);
    }
  }
}

console.log(`\nmarketing structure: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
