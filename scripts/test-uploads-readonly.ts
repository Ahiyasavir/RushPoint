// /uploads/* is a READ-ONLY surface (security audit 2026-10-22).
//
// functions/server.js used to carry `DELETE /uploads/*`, "guarded" by refusing any
// request with an Origin header. Only browsers send Origin, and Caddy forwards every
// verb from 127.0.0.1, so a plain HTTP client could erase every participant photo and
// every game's media without signing in. Two layers now close it, and both are pinned:
//   1. server.js mounts no mutating verb on /uploads,
//   2. Caddyfile.api proxies only GET/HEAD/OPTIONS for /uploads/* and answers 405 otherwise.
//   npx tsx scripts/test-uploads-readonly.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const root = join(__dirname, '..');
const server = readFileSync(join(root, 'functions', 'server.js'), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// Routes are declared as regex literals (`/^\/uploads\/(.+)$/`), so compare with the
// backslashes removed rather than escaping a regex inside a regex.
const flat = server.replace(/\\/g, '').replace(/\s+/g, '');
const routeOn = (verb: string) => flat.includes(`app.${verb}(/^/uploads`) || flat.includes(`app.${verb}('/uploads`);
const hits = ['delete', 'put', 'post', 'patch', 'all'].filter(routeOn);
check('server.js mounts no mutating verb on /uploads', hits.length === 0, hits.join(', '));
check('server.js still serves GET /uploads (the check above is looking at real routes)', routeOn('get'));

const caddy = readFileSync(join(root, 'Caddyfile.api'), 'utf8');
const readBlock = caddy.match(/@uploadsRead\s*\{([^}]*)\}/);
check('Caddyfile.api declares a read-only matcher for /uploads', readBlock !== null);
const methods = readBlock?.[1].match(/method\s+([^\n]+)/)?.[1].trim().split(/\s+/) ?? [];
check('that matcher allows only GET/HEAD/OPTIONS',
  methods.length > 0 && methods.every((m) => ['GET', 'HEAD', 'OPTIONS'].includes(m)),
  methods.join(' '));
check('every other verb on /uploads/* is refused at the proxy',
  /handle \/uploads\/\*\s*\{\s*respond 405\s*\}/.test(caddy));
check('the read matcher is evaluated before the catch-all',
  caddy.indexOf('handle @uploadsRead') > -1
  && caddy.indexOf('handle @uploadsRead') < caddy.search(/\n\thandle \{/));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nuploads read-only: all checks passed');
