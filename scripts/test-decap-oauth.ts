// Pure-logic tests for the marketing CMS's GitHub token exchange
// (functions/oauthRoute.js, mounted at /oauth + /oauth/callback by
// functions/server.js). The route takes its dependencies by injection precisely
// so this runs with no network, no GitHub app and no built callables bundle.
//
// The things worth pinning here are all security properties: a token is handed
// out exactly once, only after the CSRF state matches, and only to an origin we
// named in advance. Everything else about the CMS is recoverable; a leaked
// repo-scoped token is not.
//   npx tsx scripts/test-decap-oauth.ts
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const oauth = require_('../functions/oauthRoute.js');

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const ORIGIN = 'https://rush-point.com';
const REDIRECT = 'https://api.rush-point.com/oauth/callback';

// A minimal Express-shaped response recorder.
interface Recorded {
  status: number;
  headers: Record<string, string>;
  cookies: { name: string; value: string; options: Record<string, unknown> }[];
  cleared: string[];
  redirectedTo: string;
  body: string;
}
function makeRes() {
  const rec: Recorded = {
    status: 200, headers: {}, cookies: [], cleared: [], redirectedTo: '', body: '',
  };
  const res = {
    status(code: number) { rec.status = code; return res; },
    set(key: string, value: string) { rec.headers[key.toLowerCase()] = value; return res; },
    cookie(name: string, value: string, options: Record<string, unknown>) {
      rec.cookies.push({ name, value, options });
      return res;
    },
    clearCookie(name: string) { rec.cleared.push(name); return res; },
    redirect(code: number, url: string) { rec.status = code; rec.redirectedTo = url; return res; },
    send(html: string) { rec.body = html; return res; },
  };
  return { res, rec };
}

// ── 1. resolveScope — a caller cannot widen the token ───────────────────────
// The default is the SMALLER scope. `Ahiyasavir/RushPoint` is public, so
// public_repo is enough to commit posts; `repo` would additionally hand the admin
// page write access to every private repository the editor's account can reach.
check('scope repo kept when explicitly asked for', oauth.resolveScope('repo') === 'repo');
check('scope public_repo kept', oauth.resolveScope('public_repo') === 'public_repo');
for (const bad of ['admin:org', 'delete_repo', 'repo,gist', 'user', '', undefined, null, 42]) {
  check(`scope ${JSON.stringify(bad)} falls back to the smaller scope`,
    oauth.resolveScope(bad) === 'public_repo');
}

// ── 2. buildAuthorizeUrl ────────────────────────────────────────────────────
{
  const url = new URL(oauth.buildAuthorizeUrl({
    clientId: 'cid', redirectUri: REDIRECT, state: 'st4te', scope: 'repo',
  }));
  check('authorize points at github', url.origin + url.pathname === oauth.GITHUB_AUTHORIZE_URL);
  check('authorize carries client id', url.searchParams.get('client_id') === 'cid');
  check('authorize carries exact redirect', url.searchParams.get('redirect_uri') === REDIRECT);
  check('authorize carries state', url.searchParams.get('state') === 'st4te');
  check('authorize never carries the secret', !url.search.includes('secret'));
}

// ── 3. readCookie ───────────────────────────────────────────────────────────
check('cookie read', oauth.readCookie('a=1; rp_cms_oauth_state=abc; b=2', 'rp_cms_oauth_state') === 'abc');
check('cookie absent → empty', oauth.readCookie('a=1', 'rp_cms_oauth_state') === '');
check('cookie no header → empty', oauth.readCookie(undefined, 'rp_cms_oauth_state') === '');
check('cookie prefix is not a match', oauth.readCookie('xrp_cms_oauth_state=abc', 'rp_cms_oauth_state') === '');

// ── 4. statesMatch ──────────────────────────────────────────────────────────
check('states equal', oauth.statesMatch('abc', 'abc'));
check('states differ', !oauth.statesMatch('abc', 'abd'));
check('different lengths', !oauth.statesMatch('abc', 'abcd'));
check('empty never matches empty', !oauth.statesMatch('', ''));
check('missing never matches', !oauth.statesMatch(undefined, undefined));

// ── 5. resolveTargetOrigin ──────────────────────────────────────────────────
check('listed origin allowed', oauth.resolveTargetOrigin(ORIGIN, [ORIGIN]) === ORIGIN);
check('unlisted origin refused', oauth.resolveTargetOrigin('https://evil.test', [ORIGIN]) === '');
check('empty allow-list refuses', oauth.resolveTargetOrigin(ORIGIN, []) === '');
check('opaque origin refused', oauth.resolveTargetOrigin('null', [ORIGIN, 'null']) === '');

// ── 6. embedJson — the handshake page holds a token inside a <script> ───────
{
  const embedded = oauth.embedJson('</script><script>steal()</script>');
  check('script terminator escaped', !embedded.includes('</script'));
  check('escaping is reversible', JSON.parse(embedded) === '</script><script>steal()</script>');
}

// ── 7. The page never names an origin it was not configured with ────────────
{
  const page = oauth.renderHandshakePage({
    status: 'success',
    payload: { token: 'gho_secret', provider: 'github' },
    allowedOrigins: [ORIGIN],
  });
  check('page carries the allow-list', page.includes(ORIGIN));
  check('page checks the sender origin', page.includes('allowed.indexOf(event.origin)'));
  check('page waits for the opener handshake', page.includes("addEventListener('message'"));
  check('page is not indexable', page.includes('noindex'));
}

// ── 8. begin() — unconfigured refuses, configured redirects and sets state ──
async function run() {
  {
    const handlers = oauth.createOAuthHandlers({
      clientId: '', clientSecret: '', redirectUri: REDIRECT, allowedOrigins: [ORIGIN],
    });
    const { res, rec } = makeRes();
    check('unconfigured reports so', handlers.configured === false);
    handlers.begin({ query: {} }, res);
    check('unconfigured begin → 503', rec.status === 503);
    check('unconfigured begin sets no cookie', rec.cookies.length === 0);
  }
  {
    const handlers = oauth.createOAuthHandlers({
      clientId: 'cid', clientSecret: 'shhh', redirectUri: REDIRECT, allowedOrigins: [],
    });
    check('no allowed origins ⇒ not configured', handlers.configured === false);
  }

  const handlers = oauth.createOAuthHandlers({
    clientId: 'cid',
    clientSecret: 'shhh',
    redirectUri: REDIRECT,
    allowedOrigins: [ORIGIN],
    randomState: () => 'fixed-state',
    exchangeCode: async (code: string) => {
      if (code !== 'good-code') throw new Error('bad code');
      return { token: 'gho_token', scope: 'repo' };
    },
  });
  check('configured reports so', handlers.configured === true);

  {
    const { res, rec } = makeRes();
    handlers.begin({ query: { scope: 'admin:org' } }, res);
    check('begin redirects', rec.status === 302 && rec.redirectedTo.startsWith(oauth.GITHUB_AUTHORIZE_URL));
    check('begin narrows a widened scope', new URL(rec.redirectedTo).searchParams.get('scope') === 'public_repo');
    const cookie = rec.cookies[0];
    check('begin sets the state cookie', !!cookie && cookie.name === oauth.STATE_COOKIE && cookie.value === 'fixed-state');
    check('state cookie is httpOnly', !!cookie && cookie.options.httpOnly === true);
    check('state cookie is secure', !!cookie && cookie.options.secure === true);
    check('state cookie is SameSite=Lax (Strict would break the github redirect)',
      !!cookie && cookie.options.sameSite === 'lax');
    check('state cookie expires', !!cookie && Number(cookie.options.maxAge) > 0);
    check('begin is uncacheable', rec.headers['cache-control'] === 'no-store');
    check('the state in the cookie is the state sent to github',
      new URL(rec.redirectedTo).searchParams.get('state') === cookie.value);
  }

  // ── 9. callback() — every refusal path yields no token ────────────────────
  const cookieHeader = `${oauth.STATE_COOKIE}=fixed-state`;
  const callback = async (query: Record<string, string>, cookie = cookieHeader) => {
    const { res, rec } = makeRes();
    await handlers.callback({ query, headers: { cookie } }, res);
    return rec;
  };

  {
    const rec = await callback({ code: 'good-code', state: 'fixed-state' });
    check('happy path → 200', rec.status === 200);
    check('happy path hands over the token', rec.body.includes('gho_token'));
    check('happy path says success', rec.body.includes('authorization:github:success'));
    check('happy path is uncacheable', rec.headers['cache-control'] === 'no-store');
    check('happy path clears the state cookie', rec.cleared.includes(oauth.STATE_COOKIE));
  }
  {
    const rec = await callback({ code: 'good-code', state: 'attacker-state' });
    check('wrong state → 400', rec.status === 400);
    check('wrong state yields no token', !rec.body.includes('gho_token'));
  }
  {
    const rec = await callback({ code: 'good-code', state: 'fixed-state' }, '');
    check('missing cookie → 400', rec.status === 400);
    check('missing cookie yields no token', !rec.body.includes('gho_token'));
  }
  {
    const rec = await callback({ state: 'fixed-state' });
    check('missing code → 400', rec.status === 400);
    check('missing code yields no token', !rec.body.includes('gho_token'));
  }
  {
    const rec = await callback({ code: 'wrong-code', state: 'fixed-state' });
    check('failed exchange → 502', rec.status === 502);
    check('failed exchange yields no token', !rec.body.includes('gho_token'));
    check('failed exchange does not leak the reason', !rec.body.includes('bad code'));
  }
  {
    const rec = await callback({ error: 'access_denied', error_description: 'the user cancelled' });
    check('user cancelled → 400', rec.status === 400);
    check('user cancelled repeats github', rec.body.includes('the user cancelled'));
    check('user cancelled yields no token', !rec.body.includes('gho_token'));
  }
  {
    // An error message is the one part of this page an outsider influences.
    const rec = await callback({ error: '</script><script>alert(1)</script>' });
    check('a hostile github error cannot close the script tag', !rec.body.includes('</script><script>'));
  }

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
