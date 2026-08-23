#!/usr/bin/env node
/**
 * Switch what the two Firebase Hosting sites serve — one command, either way.
 *
 *   npm run hosting:tunnel     → both .web.app sites REDIRECT to the ngrok playtest stack
 *   npm run hosting:firebase   → both .web.app sites serve the REAL built apps
 *
 * Why this exists
 * ---------------
 * While the backend still runs on the local emulator behind an ngrok tunnel, the
 * `*.web.app` origins are useless on their own (no Cloud Functions deployed ⇒ every
 * callable fails). But they're the STABLE, shareable, memorable links — and the one
 * the Play Store TWA is pinned to. So during the tunnel era we point them at the
 * tunnel, and once Blaze is on we point them back at the real deploy.
 *
 * That flip used to be a hand-rolled redirect page pasted into `dist/` and deployed
 * by hand. Two things went wrong with that and are fixed here:
 *
 *   1. The hand-made stub answered HTTP 200 on EVERY path (the SPA rewrite sends
 *      `**` → `/index.html`), so `manifest.webmanifest` and `icon-512.png` returned
 *      HTML. A status-code health check called that "fine"; Bubblewrap would have
 *      built the Android app around it. This script never touches the real `dist/`,
 *      so the two modes can't silently contaminate each other.
 *   2. A bare `<meta http-equiv="refresh">` DROPS the path and query string, so a
 *      shared join link (`/?code=ABC123`) arrived at the tunnel with no code. The
 *      generated page below forwards `pathname + search + hash` verbatim.
 *
 * Non-destructive by construction: tunnel mode writes to `.hosting-tunnel/` and
 * deploys through a generated `firebase.tunnel.json`, leaving `firebase.json` and
 * both app `dist` directories untouched.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = path.join(ROOT, '.hosting-tunnel');
const TUNNEL_CONFIG = path.join(ROOT, 'firebase.tunnel.json');

const mode = process.argv[2];
if (mode !== 'tunnel' && mode !== 'firebase') {
  console.error('Usage: node scripts/hosting-mode.mjs <tunnel|firebase>');
  process.exit(1);
}

const isWin = process.platform === 'win32';
const NPM = isWin ? 'npm.cmd' : 'npm';
const NPX = isWin ? 'npx.cmd' : 'npx';
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: isWin });

/**
 * The tunnel domain lives in `.tunnel.env` — the SAME file scripts/ngrok-tunnel.mjs
 * reads. Single source of truth on purpose: a domain hardcoded here would silently
 * rot the day the reserved ngrok domain changes, and the failure would only surface
 * as users landing on a dead host.
 */
function tunnelDomain() {
  const envFile = path.join(ROOT, '.tunnel.env');
  const fromEnv = process.env.NGROK_DOMAIN;
  if (fromEnv) return fromEnv;
  if (!existsSync(envFile)) {
    console.error('\n✖ No NGROK_DOMAIN found: set it in the environment or in `.tunnel.env`.');
    console.error('  `.tunnel.env` is the same file `npm run playtest:ngrok` reads.\n');
    process.exit(1);
  }
  for (const raw of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() === 'NGROK_DOMAIN') {
      return line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  console.error('\n✖ `.tunnel.env` exists but has no NGROK_DOMAIN line.\n');
  process.exit(1);
}

/**
 * `basePath` is where this site lives behind the single-origin proxy
 * (scripts/proxy.mjs: `/creator*` → creator-web, everything else → play-web).
 *
 * The forward is done in JS rather than a meta-refresh so the incoming
 * path/query/hash survive — that's what carries `?code=`, `?staff`, `?board=`,
 * `?game=` and `?ref=`. `<noscript>` keeps a meta-refresh fallback (losing the
 * path, but reaching the app) and a visible link covers both failing.
 */
function redirectPage({ domain, basePath, label }) {
  const target = `https://${domain}${basePath}`;
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RushPoint</title>
<meta name="robots" content="noindex">
<noscript><meta http-equiv="refresh" content="0; url=${target}"></noscript>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#FBF7F0;color:#1c1917;
       display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px}
  .card{max-width:22rem}
  .dot{width:44px;height:44px;margin:0 auto 18px;border-radius:50%;
       border:3px solid #F97316;border-top-color:transparent;animation:s .9s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
  a{color:#F97316;font-weight:600}
  p{opacity:.75;font-size:.95rem;line-height:1.5}
</style>
</head>
<body>
  <div class="card">
    <div class="dot"></div>
    <p>מעבירים אתכם ל${label}…</p>
    <p><a id="go" href="${target}">להמשך לחצו כאן</a></p>
  </div>
<script>
(function () {
  var base = ${JSON.stringify(target.replace(/\/$/, ''))};
  // Strip this site's own base prefix so it isn't duplicated on the far side,
  // then forward whatever the visitor actually asked for.
  var rest = location.pathname.replace(${JSON.stringify(basePath.replace(/\/$/, '') || '/')}, '') || '/';
  if (rest.charAt(0) !== '/') rest = '/' + rest;
  var url = base + rest + location.search + location.hash;
  document.getElementById('go').href = url;
  location.replace(url);
})();
</script>
</body>
</html>
`;
}

if (mode === 'tunnel') {
  const domain = tunnelDomain();
  console.log(`\n▶ hosting-mode: TUNNEL  →  https://${domain}\n`);

  rmSync(STAGE, { recursive: true, force: true });
  for (const site of ['creator', 'play']) {
    const dir = path.join(STAGE, site);
    mkdirSync(dir, { recursive: true });
    const basePath = site === 'creator' ? '/creator/' : '/';
    const label = site === 'creator' ? 'קונסולת היוצרים' : 'המשחק';
    const html = redirectPage({ domain, basePath, label });
    writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    // 404 too: Hosting serves it for anything the rewrite doesn't catch.
    writeFileSync(path.join(dir, '404.html'), html, 'utf8');
  }

  writeFileSync(
    TUNNEL_CONFIG,
    JSON.stringify(
      {
        _comment:
          'GENERATED by scripts/hosting-mode.mjs — do not edit. Redirect-only hosting config used while the backend runs behind the ngrok tunnel. Deliberately declares NO functions/firestore/storage so a tunnel deploy can never touch backend resources.',
        hosting: [
          {
            target: 'creator',
            public: '.hosting-tunnel/creator',
            ignore: ['firebase.json', '**/.*', '**/node_modules/**'],
            rewrites: [{ source: '**', destination: '/index.html' }],
          },
          {
            target: 'play',
            public: '.hosting-tunnel/play',
            ignore: ['firebase.json', '**/.*', '**/node_modules/**'],
            rewrites: [{ source: '**', destination: '/index.html' }],
          },
        ],
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  run(NPX, ['firebase-tools', 'deploy', '--only', 'hosting', '--config', 'firebase.tunnel.json']);

  console.log(`
✓ Both sites now forward to the tunnel (path + query preserved):
    https://rushpoint-creator.web.app  →  https://${domain}/creator/
    https://rushpoint-play.web.app     →  https://${domain}/

  The tunnel stack must be running (npm run playtest:ngrok) or these lead nowhere.

  ⚠ ngrok free shows a one-time browser interstitial before the app. Unavoidable
    from a redirect (it needs a request header); each visitor clicks through once.

  To go back once Blaze is on:  npm run hosting:firebase
`);
} else {
  console.log('\n▶ hosting-mode: FIREBASE — building and deploying the real apps\n');
  run(NPM, ['run', 'shared:build']);
  run(NPM, ['run', 'creator:build']);
  run(NPM, ['run', 'play:build']);
  run(NPX, ['firebase-tools', 'deploy', '--only', 'hosting']);

  rmSync(STAGE, { recursive: true, force: true });
  rmSync(TUNNEL_CONFIG, { force: true });

  console.log(`
✓ Both sites now serve the real built apps, and the tunnel staging dir is gone.

  Verify by CONTENT, not status code — the redirect stub also answered 200 on
  every path. All three of these must be true:
    curl -s https://rushpoint-play.web.app/manifest.webmanifest   → real JSON
    curl -sI https://rushpoint-play.web.app/icon-512.png          → image/png
    open  https://rushpoint-creator.web.app/privacy               → the policy

  ⚠ The apps talk to Cloud Functions. If the backend isn't deployed
    (needs the Blaze plan), the sites load but every callable fails:
      npm run deploy:backend
`);
}
