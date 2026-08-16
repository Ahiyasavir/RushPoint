// The canonical upload origin is DECLARED in two places that cannot import each other:
// `RUSHPOINT_UPLOAD_ORIGINS` in packages/shared/src/validation.ts (the accept-set the
// callables enforce) and `CANONICAL_UPLOAD_ORIGIN` in functions/server.js (the origin the
// upload route MINTS urls on). functions/server.js is plain CJS loaded before the built
// bundle, so requiring shared there would run the callables ahead of
// admin.initializeApp().
//
// Drift between them is silent and expensive: the server would hand a creator a URL that
// the very next autosave refuses, and — before change: task-media-durability — deletes.
// So the duplication is pinned rather than trusted.
//   npx tsx scripts/test-upload-origin-parity.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUSHPOINT_UPLOAD_ORIGINS } from '../packages/shared/src/validation';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const src = readFileSync(join(__dirname, '..', 'functions', 'server.js'), 'utf8');
const m = src.match(/const CANONICAL_UPLOAD_ORIGIN\s*=\s*'([^']+)'/);

check('functions/server.js declares CANONICAL_UPLOAD_ORIGIN', m !== null);
check('shared declares at least one canonical upload origin', RUSHPOINT_UPLOAD_ORIGINS.length > 0);
check('the two declarations agree',
  m?.[1] === RUSHPOINT_UPLOAD_ORIGINS[0],
  `server.js=${m?.[1]} shared=${RUSHPOINT_UPLOAD_ORIGINS[0]}`);
check('the canonical origin is https and carries no trailing slash',
  RUSHPOINT_UPLOAD_ORIGINS.every((o) => o.startsWith('https://') && !o.endsWith('/')));
// The request-derived fallback must never be reachable before the canonical origin —
// behind the proxy it mints http:// (no `trust proxy`), which is mixed content in the
// browser and unrecognised by every accept-set mode.
check('the request-derived fallback comes last',
  /VPS_UPLOAD_ORIGIN\s*\|\|\s*CANONICAL_UPLOAD_ORIGIN\s*\|\|/.test(src.replace(/\s+/g, ' ')));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
