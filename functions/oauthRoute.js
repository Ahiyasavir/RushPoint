// ─── GET /oauth + GET /oauth/callback — the CMS's GitHub token exchange ──────
//
// Decap CMS (apps/marketing/public/admin) commits content to this repository
// through GitHub's API, which means the editor's browser needs a GitHub access
// token. GitHub only mints one in exchange for a CLIENT SECRET, and a secret in a
// static site is not a secret — so the exchange has to happen on a server. This is
// that server, and these two routes are the whole of it.
//
// THE FLOW, precisely, because every step of it is a place to get it wrong:
//   1. The admin page opens a POPUP at  /oauth?provider=github&scope=repo .
//   2. We redirect that popup to GitHub's authorize page, carrying a random
//      `state` that we ALSO write as an httpOnly cookie.
//   3. The editor approves; GitHub redirects the popup to /oauth/callback?code&state.
//   4. We compare the returned `state` with the cookie (this is the CSRF check:
//      an attacker can make a browser arrive here, but cannot make it arrive
//      carrying our cookie), then POST the code + secret to GitHub and get a token.
//   5. We answer with a tiny HTML page whose ONLY job is to hand that token to the
//      window that opened it, via postMessage, in the handshake Decap expects:
//      the opener says "authorizing:github", we answer
//      "authorization:github:success:<json>". The page then closes.
//
// WHY THE postMessage TARGET IS CHECKED. The obvious implementation replies to
// `event.origin` — whoever spoke to us — which hands a repo-scoped GitHub token to
// any page that manages to open this popup. That token can write to this
// repository, so the opener's origin is checked against an allow-list before we
// say a word back, and an unlisted origin gets an error page and no token.
//
// Factored out of server.js and taking its dependencies by injection so it can be
// tested without the built callables bundle, an Admin SDK or a network.
const crypto = require('crypto');

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

// The state cookie. `SameSite=Lax` is required rather than `Strict`: the callback
// is reached by a top-level redirect FROM github.com, and Strict would withhold
// the cookie on exactly that navigation, so every sign in would fail the CSRF
// check it is supposed to pass.
const STATE_COOKIE = 'rp_cms_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_COOKIE_PATH = '/oauth';

// Only the scopes the CMS could actually need, and the default is the SMALLER of
// the two. `Ahiyasavir/RushPoint` is a public repository, so `public_repo` is
// enough to commit content to it — while `repo` would additionally hand this
// browser page write access to every private repository the editor's GitHub
// account can reach, which is a far larger blast radius than a blog post. If the
// repository is ever made private, sign in will still succeed and commits will
// start failing: set `auth_scope: repo` in the CMS config at the same time.
// Anything else in the query is a caller trying to widen the token.
const ALLOWED_SCOPES = new Set(['repo', 'public_repo']);
const DEFAULT_SCOPE = 'public_repo';

function resolveScope(requested) {
  const value = String(requested || '').trim();
  return ALLOWED_SCOPES.has(value) ? value : DEFAULT_SCOPE;
}

function buildAuthorizeUrl({ clientId, redirectUri, state, scope }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: resolveScope(scope),
    state,
    // The editor is a person we invited, not a visitor to sign up. This keeps the
    // GitHub screen from offering account creation inside our sign-in popup.
    allow_signup: 'false',
  });
  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

// A deliberately small cookie reader. Adding a dependency for one header on one
// route is not worth it, and `cookie` is not a runtime dependency of this package.
function readCookie(header, name) {
  if (!header) return '';
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

// Constant time, so the comparison cannot be probed a character at a time.
function statesMatch(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

// The opener's origin, if we are willing to speak to it. An empty allow-list
// refuses everything rather than everyone: a token handed to an unknown origin
// cannot be taken back.
function resolveTargetOrigin(origin, allowedOrigins) {
  const value = String(origin || '');
  if (!value || value === 'null') return '';
  return (allowedOrigins || []).includes(value) ? value : '';
}

// The payload is embedded inside a <script>, so the sequence that ends a script
// element has to be neutralised. A token never contains it, but an error MESSAGE
// is partly text we did not write, and this page is served from the API origin.
// Keyed by CODE POINT rather than by the character itself, because two of these
// five are line terminators in JavaScript: written literally in this file they
// would break the very line meant to escape them, and an editor would show
// nothing wrong. Same class of trap as the control-character note in CLAUDE.md.
const SCRIPT_UNSAFE = new Map([
  [0x3c, '\\u003c'],
  [0x3e, '\\u003e'],
  [0x26, '\\u0026'],
  [0x2028, '\\u2028'],
  [0x2029, '\\u2029'],
]);

function embedJson(value) {
  return JSON.stringify(value).replace(
    new RegExp('[<>&\\u2028\\u2029]', 'g'),
    (c) => SCRIPT_UNSAFE.get(c.charCodeAt(0)),
  );
}

// The page Decap talks to. It does nothing except complete the handshake: the
// opener posts "authorizing:github" once its listener is ready, and only then do
// we answer. Posting first would race that listener and hang the sign in on a slow
// machine, which is the classic way this integration "works on my laptop".
function renderHandshakePage({ status, payload, allowedOrigins }) {
  const message = status === 'success'
    ? `authorization:github:success:${JSON.stringify(payload)}`
    : `authorization:github:error:${JSON.stringify(payload)}`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="robots" content="noindex, nofollow" /><title>RushPoint content</title></head>
<body>
<p>Completing sign in&hellip; you can close this window.</p>
<script>
(function () {
  var message = ${embedJson(message)};
  var allowed = ${embedJson(allowedOrigins || [])};
  function handle(event) {
    if (allowed.indexOf(event.origin) === -1) return;
    if (String(event.data || '').indexOf('authorizing:github') !== 0) return;
    window.removeEventListener('message', handle, false);
    event.source.postMessage(message, event.origin);
    window.close();
  }
  if (!window.opener) {
    document.body.textContent = 'This page has to be opened by the content editor.';
    return;
  }
  window.addEventListener('message', handle, false);
  // Nudge the opener, in case it was already listening before this page loaded.
  window.opener.postMessage('authorizing:github', '*');
}());
</script>
</body>
</html>`;
}

function createOAuthHandlers({
  clientId,
  clientSecret,
  redirectUri,
  allowedOrigins,
  // Injected so the exchange can be exercised without the network.
  exchangeCode,
  randomState = () => crypto.randomBytes(24).toString('hex'),
  secureCookie = true,
}) {
  const origins = (allowedOrigins || []).filter(Boolean);
  const configured = !!(clientId && clientSecret && redirectUri && origins.length);

  const exchange = exchangeCode || (async (code) => {
    const response = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    // GitHub answers 200 with `{error: ...}` for a bad code, so the status alone
    // proves nothing; the body is the verdict.
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error || !body.access_token) {
      throw new Error(body.error_description || body.error || `github responded ${response.status}`);
    }
    return { token: body.access_token, scope: body.scope || '' };
  });

  function send(res, status, html) {
    res.status(status);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(html);
  }

  function fail(res, status, message) {
    send(res, status, renderHandshakePage({
      status: 'error',
      payload: { message },
      allowedOrigins: origins,
    }));
  }

  return {
    configured,

    begin(req, res) {
      if (!configured) {
        fail(res, 503, 'The content editor is not connected to GitHub yet.');
        return;
      }
      const state = randomState();
      res.cookie(STATE_COOKIE, state, {
        httpOnly: true,
        secure: secureCookie,
        sameSite: 'lax',
        maxAge: STATE_TTL_MS,
        path: STATE_COOKIE_PATH,
      });
      res.set('Cache-Control', 'no-store');
      res.redirect(302, buildAuthorizeUrl({
        clientId,
        redirectUri,
        state,
        scope: req.query && req.query.scope,
      }));
    },

    async callback(req, res) {
      if (!configured) {
        fail(res, 503, 'The content editor is not connected to GitHub yet.');
        return;
      }
      const query = req.query || {};
      // One sign in, one state. Clear it before every exit path, so a replayed
      // callback cannot reuse the cookie a successful one left behind.
      res.clearCookie(STATE_COOKIE, { path: STATE_COOKIE_PATH });

      if (query.error) {
        // The editor pressed cancel, or GitHub refused. Their words, not ours.
        fail(res, 400, String(query.error_description || query.error));
        return;
      }
      const cookieState = readCookie(req.headers && req.headers.cookie, STATE_COOKIE);
      if (!statesMatch(query.state, cookieState)) {
        fail(res, 400, 'This sign in could not be verified. Start again from the editor.');
        return;
      }
      const code = String(query.code || '');
      if (!code) {
        fail(res, 400, 'GitHub did not return an authorization code.');
        return;
      }
      let result;
      try {
        result = await exchange(code);
      } catch (error) {
        // Never echo the exchange error verbatim: it is the one path that has held
        // the client secret in scope.
        // eslint-disable-next-line no-console
        console.error('CMS OAuth exchange failed:', error && error.message);
        fail(res, 502, 'GitHub would not complete the sign in. Try again.');
        return;
      }
      send(res, 200, renderHandshakePage({
        status: 'success',
        payload: { token: result.token, provider: 'github' },
        allowedOrigins: origins,
      }));
    },
  };
}

module.exports = {
  createOAuthHandlers,
  buildAuthorizeUrl,
  renderHandshakePage,
  resolveScope,
  resolveTargetOrigin,
  readCookie,
  statesMatch,
  embedJson,
  STATE_COOKIE,
  STATE_COOKIE_PATH,
  STATE_TTL_MS,
  GITHUB_AUTHORIZE_URL,
  GITHUB_TOKEN_URL,
};
