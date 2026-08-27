// Every local module functions/server.js requires must be COPYed into the API
// runtime image.
//
// WHY THIS EXISTS. Dockerfile.api builds in two stages and copies a HAND-WRITTEN
// list of files into the runtime stage: the esbuild bundle (lib/), server.js, and
// each plain-Node sibling server.js requires directly. Those siblings are never
// bundled, so a `require('./newThing.js')` added to server.js without a matching
// COPY line produces an image that builds cleanly, pushes cleanly, and
// crash-loops on boot with MODULE_NOT_FOUND.
//
// This is not hypothetical. On 2026-08-27 oauthRoute.js was added to server.js
// and the deploy took the live API down — every gate was green, the build
// succeeded, `docker compose up` reported "Started", and the only evidence was
// in `docker logs`. The failure is invisible everywhere it could have been
// caught, which is exactly the shape of failure worth a static check.
//
// `./lib/index.js` is exempt: it is the esbuild output, copied as a directory.
//   npx tsx scripts/test-api-image-contents.ts
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_PATH = 'functions/server.js';
const DOCKERFILE_PATH = 'Dockerfile.api';

// Copied as a directory (`COPY --from=build /repo/functions/lib ./lib`), so it
// needs no per-file line and would fail the filename match below.
const EXEMPT = new Set(['./lib/index.js']);

let failures = 0;
function check(label: string, cond: boolean, detail = '', hint = ''): void {
  const suffix = [detail, cond ? '' : hint].filter(Boolean).join(' — ');
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${suffix ? ' :: ' + suffix : ''}`);
  if (!cond) failures++;
}

const serverSource = readFileSync(path.join(root, SERVER_PATH), 'utf8');
const dockerfile = readFileSync(path.join(root, DOCKERFILE_PATH), 'utf8');

// Only the runtime stage matters. A file COPYed in the BUILD stage (which does a
// bare `COPY . .`) is present at build time and absent from the shipped image —
// which is precisely the trap, so the build stage must not be allowed to satisfy
// this check.
const runtimeStart = dockerfile.search(/^FROM .* AS runtime$/m);
check('Dockerfile.api has a runtime stage', runtimeStart !== -1,
  '', 'the stage name changed; this check is reading the wrong half of the file');
const runtimeStage = runtimeStart === -1 ? '' : dockerfile.slice(runtimeStart);

// Local requires in server.js: `require('./x.js')`, not package requires.
const required = [...serverSource.matchAll(/require\((['"])(\.\/[^'"]+)\1\)/g)]
  .map((m) => m[2]);

check('the scan found server.js\'s local requires', required.length > 0,
  `${required.length} found: ${required.join(', ')}`,
  `no require('./…') matched in ${SERVER_PATH} — the pattern is stale`);

const checked = required.filter((spec) => !EXEMPT.has(spec));
for (const spec of checked) {
  const basename = path.posix.basename(spec);
  // The runtime stage must copy this exact file out of the build stage.
  const copied = new RegExp(
    `^COPY --from=build /repo/functions/${basename.replace(/\./g, '\\.')}\\s`,
    'm',
  ).test(runtimeStage);
  check(`'${spec}' is copied into the runtime image`, copied, '',
    `add: COPY --from=build /repo/functions/${basename} ./${basename}`);
}

// The denominator, printed on purpose: "nothing missing" and "nothing examined"
// otherwise read identically (CLAUDE.md, the control-character lesson).
console.log(`\nchecked ${checked.length} of ${required.length} local require(s) (${EXEMPT.size} exempt)`);
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
