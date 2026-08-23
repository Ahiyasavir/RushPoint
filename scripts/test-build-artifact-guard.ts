// Pure-logic tests for playtest-build-isolation — the guard that catches a build
// whose asset base does not match the path it is served from, and a playtest
// serving wiring that has drifted back onto the gate's output directory.
// Run by scripts/run-unit-tests.mjs via `npm test`.
//
// The failure this guards is INVISIBLE in production: `npm run verify` rebuilds
// apps/creator-web with base `/`, that build lands in the directory the live
// playtest preview serves, the reverse proxy sends `/assets/*` to play-web
// (because only `/creator*` goes to creator-web), play-web answers 200 with its
// own SPA HTML, and the creator console is a blank page with every process
// healthy and every request successful.
//
// SYNTHETIC FIXTURES for the HTML decisions: this file never reads dist/ and
// never runs a build, so it can be neither made green by a stale build nor made
// red by the absence of one. The real built index.html files are checked by
// scripts/check-build-base.mjs (`npm run base:check`, inside `npm run verify`).
// package.json IS read — it is source, not build output, so asserting the real
// wiring is deterministic and is the whole point of that half of the guard.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PLAYTEST_OUT_DIR,
  GATE_OUT_DIR,
  RESERVED_PROXY_PREFIXES,
  ARTIFACT_CONTRACT,
  extractRootRefs,
  checkBuiltBase,
  checkPlaytestScriptWiring,
  formatProblems,
} from './lib/buildArtifactGuard.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const codes = (res: { problems: Array<{ code: string }> }) => res.problems.map((p) => p.code).sort();

// ── Fixtures ────────────────────────────────────────────────────────────────
// Shaped like the real emitted files: a module script + a stylesheet + the
// public-dir links Vite base-prefixes, plus hand-authored absolute URLs (font
// preconnect / og:image) that it deliberately does NOT rewrite.
function html({ base = '/', extra = '' }: { base?: string; extra?: string } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="manifest" href="${base}manifest.webmanifest" />
    <link rel="icon" type="image/svg+xml" href="${base}icon.svg" />
    <link rel="apple-touch-icon" href="${base}icon-192.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />
    <meta property="og:image" content="https://rushpoint-creator.web.app/og.jpg" />
    <script type="module" crossorigin src="${base}assets/index-Ce4z6HcG.js"></script>
    <link rel="stylesheet" crossorigin href="${base}assets/index-BN5FMiSG.css">
${extra}
  </head>
  <body><div id="root"></div></body>
</html>`;
}

// ── ARTIFACT_CONTRACT ───────────────────────────────────────────────────────
{
  const c = ARTIFACT_CONTRACT;
  ok(Array.isArray(c) && c.length === 4, `contract covers both apps x both audiences (got ${c?.length})`);
  const key = (a: { app: string; outDir: string }) => `${a.app}:${a.outDir}`;
  ok(new Set(c.map(key)).size === c.length, 'contract entries are unique (app, outDir)');
  for (const a of c) {
    ok(a.outDir === GATE_OUT_DIR || a.outDir === PLAYTEST_OUT_DIR, `${key(a)}: outDir is one of the two declared dirs`);
    ok(a.base.startsWith('/') && a.base.endsWith('/'), `${key(a)}: base is /…/-shaped`);
    ok(a.audience === (a.outDir === PLAYTEST_OUT_DIR ? 'playtest' : 'gate'), `${key(a)}: audience follows outDir`);
  }
  ok(GATE_OUT_DIR !== PLAYTEST_OUT_DIR, 'the gate dir and the playtest dir are disjoint');
  const creatorPlaytest = c.find((a) => a.app === 'creator-web' && a.outDir === PLAYTEST_OUT_DIR);
  const creatorGate = c.find((a) => a.app === 'creator-web' && a.outDir === GATE_OUT_DIR);
  const playPlaytest = c.find((a) => a.app === 'play-web' && a.outDir === PLAYTEST_OUT_DIR);
  ok(creatorPlaytest?.base === '/creator/', 'creator playtest artifact is based at /creator/ (the proxy prefix)');
  ok(creatorGate?.base === '/', 'creator gate artifact is based at the site root (Firebase Hosting)');
  ok(playPlaytest?.base === '/', 'play-web is based at the site root in both audiences');
  ok(RESERVED_PROXY_PREFIXES.includes('/creator/'), 'the /creator/ proxy prefix is reserved');
}

// ── extractRootRefs ─────────────────────────────────────────────────────────
{
  const refs = extractRootRefs(html({ base: '/creator/' }));
  ok(refs.every((r: string) => r.startsWith('/')), 'only root-absolute refs are returned');
  ok(refs.includes('/creator/assets/index-Ce4z6HcG.js'), 'the module script is found');
  ok(refs.includes('/creator/assets/index-BN5FMiSG.css'), 'the stylesheet is found');
  ok(refs.includes('/creator/manifest.webmanifest'), 'the public-dir manifest link is found');
  ok(refs.includes('/creator/icon.svg'), 'the icon link is found');
  ok(!refs.some((r: string) => r.includes('fonts.googleapis.com')), 'absolute https refs are ignored');
  ok(!refs.some((r: string) => r.includes('og.jpg')), 'meta content= is not an asset ref');

  ok(extractRootRefs('<link href=/creator/a.css rel=stylesheet>').length === 0,
    'unquoted attributes are not matched (Vite always quotes; matching them would risk false positives)');
  ok(extractRootRefs(`<script src='/a.js'></script>`).includes('/a.js'), 'single-quoted attributes are matched');
  ok(extractRootRefs('<link rel="stylesheet" href="/a.css" />').includes('/a.css'), 'self-closing tags are matched');
  ok(extractRootRefs('<SCRIPT SRC="/a.js"></SCRIPT>').includes('/a.js'), 'tag/attribute matching is case-insensitive');
  ok(extractRootRefs('<script src="//cdn.example.com/a.js"></script>').length === 0,
    'protocol-relative refs are ignored (they are not base-prefixed)');
  ok(extractRootRefs('<script src="./assets/a.js"></script>').length === 0, 'relative refs are ignored');
  ok(extractRootRefs('<img src="/a.png">').length === 0, 'only script/link tags are considered');
  ok(extractRootRefs('').length === 0, 'empty input yields no refs');
  ok(extractRootRefs(null as unknown as string).length === 0, 'garbage input yields no refs, never throws');
}

// ── checkBuiltBase — the accepting cases ────────────────────────────────────
{
  const good = checkBuiltBase({ label: 'creator-web/dist-playtest', html: html({ base: '/creator/' }), expectedBase: '/creator/' });
  ok(good.ok === true, `a creator playtest build served at /creator/ passes (${JSON.stringify(codes(good))})`);
  ok(good.problems.length === 0, 'no problems on the accepting creator case');

  const goodPlay = checkBuiltBase({ label: 'play-web/dist', html: html({ base: '/' }), expectedBase: '/' });
  ok(goodPlay.ok === true, `a play-web build served at the root passes (${JSON.stringify(codes(goodPlay))})`);

  ok(good.ok === (good.problems.length === 0), 'ok is exactly "no problems" (creator)');
  ok(goodPlay.ok === (goodPlay.problems.length === 0), 'ok is exactly "no problems" (play)');
}

// ── checkBuiltBase — THE BUG: a base-/ creator build served under /creator/ ──
{
  const res = checkBuiltBase({ label: 'creator-web/dist-playtest', html: html({ base: '/' }), expectedBase: '/creator/' });
  ok(res.ok === false, 'a base-/ creator build served under /creator/ is REJECTED (the blank-page bug)');
  ok(res.problems.some((p) => p.code === 'wrong-base'), 'the wrong-base code is reported');
  const p = res.problems.find((x) => x.code === 'wrong-base');
  ok(typeof p?.ref === 'string' && p.ref.startsWith('/'), 'the offending reference is named');
  ok(p?.expectedBase === '/creator/', 'the expected base is reported');
  ok(typeof p?.message === 'string' && p.message.length > 0, 'the problem carries a human message');
  ok(res.problems.some((x) => x.ref === '/assets/index-Ce4z6HcG.js'), 'the entry script is among the findings');
}

// ── checkBuiltBase — the inverse clobber: /creator/ refs in a root artifact ──
{
  const res = checkBuiltBase({ label: 'play-web/dist', html: html({ base: '/creator/' }), expectedBase: '/' });
  ok(res.ok === false, 'a /creator/-based build sitting in a root-served directory is REJECTED');
  ok(res.problems.some((p) => p.code === 'reserved-prefix'),
    `the reserved-prefix code is reported (${JSON.stringify(codes(res))})`);
}

// ── checkBuiltBase — an empty artifact must not pass vacuously ──────────────
{
  for (const [label, doc] of [['empty string', ''], ['no refs', '<!DOCTYPE html><html><body><div id="root"></div></body></html>'], ['null', null]] as const) {
    const res = checkBuiltBase({ label: 'x', html: doc as string, expectedBase: '/creator/' });
    ok(res.ok === false, `${label}: an artifact with no asset refs is REJECTED`);
    ok(res.problems.some((p) => p.code === 'no-asset-refs'), `${label}: the no-asset-refs code is reported`);
  }
}

// ── checkBuiltBase — a malformed expected base is a failure, not a pass ─────
{
  for (const bad of ['creator/', '/creator', '', null]) {
    const res = checkBuiltBase({ label: 'x', html: html({ base: '/creator/' }), expectedBase: bad as string });
    ok(res.ok === false, `expectedBase ${JSON.stringify(bad)} is REJECTED`);
    ok(res.problems.some((p) => p.code === 'bad-expected-base'), `expectedBase ${JSON.stringify(bad)} reports bad-expected-base`);
  }
}

// ── checkBuiltBase — a partial clobber (one stale ref) is still caught ──────
{
  const mixed = html({ base: '/creator/', extra: '    <link rel="modulepreload" href="/assets/vendor-abc.js">' });
  const res = checkBuiltBase({ label: 'creator-web/dist-playtest', html: mixed, expectedBase: '/creator/' });
  ok(res.ok === false, 'a single non-conforming ref among conforming ones is REJECTED');
  ok(res.problems.length === 1 && res.problems[0].ref === '/assets/vendor-abc.js', 'exactly the offending ref is reported');
}

// ── formatProblems ─────────────────────────────────────────────────────────
{
  const res = checkBuiltBase({ label: 'creator-web/dist-playtest', html: html({ base: '/' }), expectedBase: '/creator/' });
  const text = formatProblems(res.problems);
  ok(typeof text === 'string' && text.includes('/assets/index-Ce4z6HcG.js'), 'formatProblems names the offending refs');
  ok(formatProblems([]) === '', 'formatProblems of no problems is empty');
}

// ── checkPlaytestScriptWiring — synthetic maps ─────────────────────────────
function wiring(over: Record<string, string> = {}) {
  return {
    'creator:build': 'npm run build --workspace=apps/creator-web',
    'play:build': 'npm run build --workspace=apps/play-web',
    'playtest:build': 'npm run shared:build && npm run build --workspace=apps/creator-web -- --mode playtest && npm run build --workspace=apps/play-web -- --mode playtest',
    'playtest:creator:preview': 'npm run preview --workspace=apps/creator-web -- --mode playtest --outDir dist-playtest --port 5180 --host 0.0.0.0',
    'playtest:play:preview': 'npm run preview --workspace=apps/play-web -- --mode playtest --outDir dist-playtest --port 5181 --host 0.0.0.0',
    ...over,
  };
}
{
  const good = checkPlaytestScriptWiring(wiring());
  ok(good.ok === true, `the intended wiring passes (${JSON.stringify(codes(good))})`);

  const gateInPlaytestMode = checkPlaytestScriptWiring(wiring({ 'creator:build': 'npm run build --workspace=apps/creator-web -- --mode playtest' }));
  ok(gateInPlaytestMode.ok === false, 'a gate build that acquired --mode playtest is REJECTED');
  ok(gateInPlaytestMode.problems.some((p) => p.script === 'creator:build'), 'the offending gate script is named');

  const previewOnGateDir = checkPlaytestScriptWiring(wiring({ 'playtest:creator:preview': 'npm run preview --workspace=apps/creator-web -- --mode playtest --port 5180' }));
  ok(previewOnGateDir.ok === false, 'a playtest preview that does not pin --outDir dist-playtest is REJECTED');
  ok(previewOnGateDir.problems.some((p) => p.script === 'playtest:creator:preview'), 'the offending preview script is named');

  const explicitGateDir = checkPlaytestScriptWiring(wiring({ 'playtest:play:preview': 'npm run preview --workspace=apps/play-web -- --outDir dist --port 5181' }));
  ok(explicitGateDir.ok === false, 'a playtest preview explicitly re-pointed at dist is REJECTED');

  const noPlaytestModeInBuild = checkPlaytestScriptWiring(wiring({ 'playtest:build': 'npm run shared:build && npm run build --workspace=apps/creator-web && npm run build --workspace=apps/play-web' }));
  ok(noPlaytestModeInBuild.ok === false, 'a playtest build that lost --mode playtest is REJECTED');

  const oneAppOnly = checkPlaytestScriptWiring(wiring({ 'playtest:build': 'npm run build --workspace=apps/creator-web -- --mode playtest' }));
  ok(oneAppOnly.ok === false, 'a playtest build covering only one app is REJECTED');

  const missing = checkPlaytestScriptWiring({});
  ok(missing.ok === false, 'a missing script is REJECTED, not silently skipped');
  ok(missing.problems.length >= 5, `every required script is reported missing (got ${missing.problems.length})`);

  const noPreviewMode = checkPlaytestScriptWiring(wiring({ 'playtest:creator:preview': 'npm run preview --workspace=apps/creator-web -- --outDir dist-playtest --port 5180' }));
  ok(noPreviewMode.ok === false, 'the creator playtest preview without --mode playtest is REJECTED (base would resolve to /)');

  ok(checkPlaytestScriptWiring(null as unknown as Record<string, string>).ok === false, 'garbage input is REJECTED, never throws');
}

// ── checkPlaytestScriptWiring — the REAL repository wiring ─────────────────
{
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const res = checkPlaytestScriptWiring(pkg.scripts);
  ok(res.ok === true, `the repository's own package.json wiring is intact:\n${formatProblems(res.problems)}`);
}

console.log(`build-artifact-guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
