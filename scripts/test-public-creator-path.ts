// Pure-logic test for the logged-out creator-web routes (change: game-share-link).
//
// The failure this guards against is silent and total: a share link that lands
// on the login screen. The recipient sees a product they have never heard of
// asking them to sign up, and the creator hears "your link doesn't work".
//   npx tsx scripts/test-public-creator-path.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  resolvePublicCreatorRoute, stripBase, sharedGamePath,
} from '../apps/creator-web/src/lib/publicCreatorPath';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const TOKEN = 'Ab3-_xYz0123456789abcd'; // 22 chars, base64url

// ── Base stripping (the playtest tunnel serves creator-web under /creator/) ──
check('root base is a no-op', stripBase('/terms') === '/terms');
check('strips the /creator/ base', stripBase('/creator/terms', '/creator/') === '/terms');
check('strips a base written without a trailing slash', stripBase('/creator/terms', '/creator') === '/terms');
check('a trailing slash on the path is collapsed', stripBase('/terms/') === '/terms');
check('the root path survives as "/"', stripBase('/') === '/');
check('the base root survives as "/"', stripBase('/creator/', '/creator/') === '/');
check('a path that does not carry the base is left alone', stripBase('/terms', '/creator/') === '/terms');
check('a non-string pathname does not throw', stripBase(undefined as unknown as string) === '/');

// ── Legal (pre-existing behaviour, now base-aware) ──────────────────────────
check('/privacy is public', resolvePublicCreatorRoute('/privacy')?.kind === 'legal');
check('/terms is public', resolvePublicCreatorRoute('/terms')?.kind === 'legal');
check('/terms resolves its type', (resolvePublicCreatorRoute('/terms') as { type: string }).type === 'terms');
check('/privacy resolves its type', (resolvePublicCreatorRoute('/privacy') as { type: string }).type === 'privacy');
check('legal is public under the /creator/ base too',
  resolvePublicCreatorRoute('/creator/privacy', '/creator/')?.kind === 'legal');

// ── Share links ─────────────────────────────────────────────────────────────
const shared = resolvePublicCreatorRoute(`/p/${TOKEN}`);
check('a share path is public', shared?.kind === 'shared');
check('the token is carried through', shared?.kind === 'shared' && shared.token === TOKEN);
check('a share path is public under the /creator/ base',
  resolvePublicCreatorRoute(`/creator/p/${TOKEN}`, '/creator/')?.kind === 'shared');
check('a percent-encoded token is decoded',
  (resolvePublicCreatorRoute(`/p/${encodeURIComponent(TOKEN)}`) as { token: string }).token === TOKEN);
check('sharedGamePath round-trips',
  (resolvePublicCreatorRoute(sharedGamePath(TOKEN)) as { token: string }).token === TOKEN);

// ── Everything else stays behind the login ──────────────────────────────────
check('the dashboard is NOT public', resolvePublicCreatorRoute('/') === null);
check('the builder is NOT public', resolvePublicCreatorRoute('/build/game-1') === null);
check('the run console is NOT public', resolvePublicCreatorRoute('/run/g/r') === null);
check('the admin dashboard is NOT public', resolvePublicCreatorRoute('/admin/users') === null);
check('a malformed token is NOT a public route', resolvePublicCreatorRoute('/p/short') === null);
check('an empty token is NOT a public route', resolvePublicCreatorRoute('/p/') === null);
check('a token with a slash cannot smuggle a second segment',
  resolvePublicCreatorRoute(`/p/${TOKEN}/extra`) === null);
check('a nested path under /p is not public', resolvePublicCreatorRoute('/p/a/b/c') === null);
check('a path that merely starts with /p is not public', resolvePublicCreatorRoute('/private') === null);
check('/terms-of-service is not the terms page', resolvePublicCreatorRoute('/terms-of-service') === null);
check('an empty pathname is not public', resolvePublicCreatorRoute('') === null);
check('a garbage pathname does not throw', resolvePublicCreatorRoute(null as unknown as string) === null);

// ── Wiring guard: the public read must not go through the guarded factory ──
//
// `callable()` in services/api.ts throws `Not signed in` BEFORE any request
// leaves the browser. That is right for every creator-console call and fatally
// wrong for this one: the page would render "this link is not active" for a
// perfectly live link, and nothing would reach any server log to contradict it.
// Caught once in review; asserted here so it cannot come back through a
// copy-paste of the line above it.
console.log('\n── wiring ──');
const callsSrc = readFileSync(
  path.join(HERE, '..', 'apps', 'creator-web', 'src', 'services', 'calls.ts'), 'utf8');
const apiSrc = readFileSync(
  path.join(HERE, '..', 'apps', 'creator-web', 'src', 'services', 'api.ts'), 'utf8');
check('services/api.ts exports a publicCallable factory',
  /export function publicCallable/.test(apiSrc));
check('publicCallable does NOT assert a signed-in user',
  !/publicCallable[\s\S]{0,400}?Not signed in/.test(apiSrc));
check('getSharedGame is wired through publicCallable',
  /getSharedGame\s*=\s*publicCallable</.test(callsSrc),
  callsSrc.split('\n').find((l) => l.includes('getSharedGame =')) ?? 'not found');
check('the owner-side share callables stay behind the signed-in factory',
  /createGameShareLink\s*=\s*callable</.test(callsSrc)
  && /listGameShareLinks\s*=\s*callable</.test(callsSrc)
  && /revokeGameShareLink\s*=\s*callable</.test(callsSrc));

// AuthGate must serve the share route without a session, or the whole feature is
// a login wall with extra steps.
const gateSrc = readFileSync(
  path.join(HERE, '..', 'apps', 'creator-web', 'src', 'components', 'AuthGate.tsx'), 'utf8');
check('AuthGate resolves public routes through this module',
  /resolvePublicCreatorRoute\(/.test(gateSrc));
check('AuthGate renders the shared game page for a signed-out visitor',
  /publicRoute\?\.kind === 'shared'/.test(gateSrc) && /SharedGamePage/.test(gateSrc));
check('AuthGate no longer compares the raw pathname against a hardcoded list',
  !/LEGAL_PATHS\.includes/.test(gateSrc));

console.log(`\n${failures === 0 ? 'ALL PUBLIC-CREATOR-PATH TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
