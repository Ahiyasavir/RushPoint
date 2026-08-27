// Build-artifact guard (change: playtest-build-isolation) — PURE decisions.
//
// Two things must hold about the static bundles this repo produces, and both of
// them fail SILENTLY when they stop holding:
//
//  1. The asset base baked into a built index.html must match the path that
//     artifact is served from. The always-on playtest fronts creator-web and
//     play-web behind ONE origin via scripts/proxy.mjs, which routes `/creator*`
//     to creator-web (:5180) and EVERYTHING ELSE to play-web (:5181). So a
//     creator build whose index.html references `/assets/index-*.js` has its
//     JavaScript routed to play-web, which answers 200 with its own SPA HTML.
//     The creator console renders a BLANK PAGE while every process is healthy
//     and every request succeeds. There is no error to find.
//
//  2. The playtest build and the gate build must not write the same directory.
//     `npm run verify` runs creator:build/play:build (mode `production`), the
//     playtest serves `--mode playtest` builds. Beyond the base above, mode also
//     selects the BACKEND: isEmulatorBuild (packages/shared/src/env.ts) is
//     `DEV || MODE === 'playtest'`, so a production-mode bundle dropped into the
//     served directory points real participants' phones at real Firebase, where
//     anonymous auth is disabled. Also silent, and worse.
//
// The structural fix is the separate outDir (see the vite configs). This module
// is the loud tripwire for the day a refactor undoes it.
//
// Pure: no fs, no child_process, no network. Callers supply the bytes.
//   • scripts/test-build-artifact-guard.ts — synthetic fixtures + the real package.json
//   • scripts/check-build-base.mjs         — the built index.html files (`npm run base:check`)

/** Output directory the verification gate writes (and Firebase Hosting deploys). */
export const GATE_OUT_DIR = 'dist';
/** Output directory the always-on playtest builds and serves. Never the gate's. */
export const PLAYTEST_OUT_DIR = 'dist-playtest';

/**
 * Path prefixes the single-origin playtest proxy routes away from play-web
 * (scripts/proxy.mjs → resolveProxyTarget). An artifact served at the site root
 * must never emit an asset URL under one of these: it would be handed to a
 * different app. Mirrors the proxy's routing table; keep the two in step.
 */
export const RESERVED_PROXY_PREFIXES = ['/creator/'];

/**
 * The DECLARED contract: which output directory each app writes for each
 * audience, and the base its assets must carry there. Declared and not inferred
 * on purpose (same reasoning as scripts/lib/callableHardening.mjs) — a contract
 * read back out of the build can never fail, because whatever the build did
 * becomes the expectation.
 */
export const ARTIFACT_CONTRACT = [
  // Gate / Firebase Hosting: creator-web is its own origin, so base is the root.
  { app: 'creator-web', outDir: GATE_OUT_DIR, base: '/', audience: 'gate' },
  // Playtest: one tunnel origin for both apps, creator lives under the proxy prefix.
  { app: 'creator-web', outDir: PLAYTEST_OUT_DIR, base: '/creator/', audience: 'playtest' },
  // play-web is the origin root in BOTH audiences (the proxy's fall-through).
  { app: 'play-web', outDir: GATE_OUT_DIR, base: '/', audience: 'gate' },
  { app: 'play-web', outDir: PLAYTEST_OUT_DIR, base: '/', audience: 'playtest' },
  // The marketing site (change: marketing-site) is its own Hosting origin, so
  // base is the root. It has NO playtest audience on purpose: it is static
  // output with no emulator wiring and nothing to point at a local backend, so
  // there is no second build of it that could diverge from this one.
  //
  // `entries` because this artifact has NO root index.html: `/` is a Hosting
  // redirect to a language home, so the documents that carry asset references
  // are the two language homes. Without naming them the guard finds no
  // index.html, reports "not built", and skips an artifact that is very much
  // built, which is a silent hole rather than a failure.
  {
    app: 'marketing',
    outDir: GATE_OUT_DIR,
    base: '/',
    audience: 'gate',
    entries: ['he/index.html', 'en/index.html'],
  },
];

/**
 * The documents to read for an artifact. Defaults to the single root
 * `index.html` that a Vite app emits; an artifact that has none names its own.
 */
export function entryDocuments(artifact) {
  const entries = artifact && Array.isArray(artifact.entries) ? artifact.entries : null;
  return entries && entries.length > 0 ? entries : ['index.html'];
}

// <script …> / <link …> with a quoted src= or href=. Vite always emits quoted
// attributes; matching unquoted ones would invite false positives on hand-written
// markup for no gain.
const TAG_RE = /<(script|link)\b([^>]*)>/gi;
const ATTR_RE = /\s(?:src|href)\s*=\s*("([^"]*)"|'([^']*)')/i;

/**
 * Every ROOT-ABSOLUTE (`/…`) src/href on a <script> or <link> in the document.
 *
 * Root-absolute is the whole filter: those are exactly the references Vite
 * rewrites with the configured base (the module script, the stylesheet, and the
 * public-dir manifest/icon links). Everything else in these index.html files is
 * hand-authored and deliberately untouched — `https://fonts.googleapis.com`
 * preconnects, absolute og:image URLs — and a protocol-relative `//host/…` is
 * likewise never base-prefixed. Never throws; garbage in yields [].
 */
export function extractRootRefs(html) {
  if (typeof html !== 'string' || html.length === 0) return [];
  const refs = [];
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(html)) !== null) {
    const attrs = m[2] || '';
    const a = ATTR_RE.exec(attrs);
    if (!a) continue;
    const value = a[2] !== undefined ? a[2] : a[3];
    if (typeof value !== 'string') continue;
    // `/…` but not `//host/…` (protocol-relative).
    if (!value.startsWith('/') || value.startsWith('//')) continue;
    refs.push(value);
  }
  return refs;
}

/**
 * Does this built document's asset base match the path it will be served from?
 *
 * Problem codes:
 *   bad-expected-base — the caller's base is not `/…/`-shaped (fail, never pass vacuously)
 *   no-asset-refs     — the document carries NO root-absolute asset refs at all. An empty
 *                       or truncated index.html must not satisfy an "every ref matches"
 *                       predicate by having no refs to check.
 *   wrong-base        — a ref does not start with the expected base. THE blank-page bug.
 *   reserved-prefix   — the artifact is served at the root yet emits a ref under a
 *                       reserved proxy prefix: a playtest build landed in a gate directory.
 *
 * @param {{label?: string, html: string, expectedBase: string}} input
 * @returns {{ok: boolean, label: string, expectedBase: string, refs: string[], problems: Array<{code: string, label: string, message: string, ref?: string, expectedBase?: string}>}}
 */
export function checkBuiltBase({ label = 'artifact', html, expectedBase } = {}) {
  const problems = [];
  const push = (code, message, extra = {}) => problems.push({ code, label, message, ...extra });

  if (typeof expectedBase !== 'string' || !expectedBase.startsWith('/') || !expectedBase.endsWith('/')) {
    push('bad-expected-base', `${label}: expected base ${JSON.stringify(expectedBase)} is not "/…/"-shaped.`, { expectedBase });
    return { ok: false, label, expectedBase, refs: [], problems };
  }

  const refs = extractRootRefs(html);
  if (refs.length === 0) {
    push('no-asset-refs', `${label}: no root-absolute <script>/<link> references found. An empty or truncated index.html cannot be verified, and must not pass.`, { expectedBase });
    return { ok: false, label, expectedBase, refs, problems };
  }

  for (const ref of refs) {
    if (!ref.startsWith(expectedBase)) {
      push('wrong-base', `${label}: asset "${ref}" is not under the base "${expectedBase}" this artifact is served from. Served through the playtest proxy this request is routed to the OTHER app, which answers 200 with its own HTML, and the page renders blank.`, { ref, expectedBase });
      continue;
    }
    if (expectedBase === '/') {
      const reserved = RESERVED_PROXY_PREFIXES.find((p) => ref.startsWith(p));
      if (reserved) {
        push('reserved-prefix', `${label}: asset "${ref}" sits under the reserved proxy prefix "${reserved}" but this artifact is served at the site root. A playtest-mode build was written into a gate output directory.`, { ref, expectedBase });
      }
    }
  }

  return { ok: problems.length === 0, label, expectedBase, refs, problems };
}

// ── package.json wiring ──────────────────────────────────────────────────────
// The bytes-only check above cannot see the other half of the failure: a preview
// re-pointed at `dist` serves a perfectly well-formed artifact — the WRONG one.
// So the wiring is asserted directly, and (as everywhere else in this file) the
// expectation is DECLARED here rather than read back out of the scripts.

const PLAYTEST_MODE_FLAG = '--mode playtest';
const PLAYTEST_OUT_DIR_FLAG = `--outDir ${PLAYTEST_OUT_DIR}`;

const WIRING_RULES = [
  {
    script: 'creator:build',
    why: 'the gate build must stay a real production build',
    check: (cmd) => (cmd.includes('playtest')
      ? `must not mention "playtest" — a gate build in playtest mode wires the local emulator into a bundle that gets deployed.`
      : null),
  },
  {
    script: 'play:build',
    why: 'the gate build must stay a real production build',
    check: (cmd) => (cmd.includes('playtest')
      ? `must not mention "playtest" — a gate build in playtest mode wires the local emulator into a bundle that gets deployed.`
      : null),
  },
  {
    script: 'playtest:build',
    why: 'both apps must be built in playtest mode',
    check: (cmd) => {
      const n = cmd.split(PLAYTEST_MODE_FLAG).length - 1;
      return n >= 2 ? null : `must pass "${PLAYTEST_MODE_FLAG}" for BOTH apps (found ${n}).`;
    },
  },
  {
    script: 'playtest:creator:preview',
    why: 'the live creator console is served from here',
    check: (cmd) => {
      if (!cmd.includes(PLAYTEST_MODE_FLAG)) return `must pass "${PLAYTEST_MODE_FLAG}" or the base resolves to "/" and every asset URL is proxied to play-web (blank page).`;
      if (!cmd.includes(PLAYTEST_OUT_DIR_FLAG)) return `must pin "${PLAYTEST_OUT_DIR_FLAG}" so it can never serve the directory the verification gate overwrites.`;
      return null;
    },
  },
  {
    script: 'playtest:play:preview',
    why: 'the live participant app is served from here',
    check: (cmd) => {
      if (!cmd.includes(PLAYTEST_MODE_FLAG)) return `must pass "${PLAYTEST_MODE_FLAG}" to match the bundle it serves.`;
      if (!cmd.includes(PLAYTEST_OUT_DIR_FLAG)) return `must pin "${PLAYTEST_OUT_DIR_FLAG}" so it can never serve the directory the verification gate overwrites.`;
      return null;
    },
  },
];

// Any playtest preview naming the gate directory outright is a hard error, even
// if it ALSO names the playtest one (last flag would win, unpredictably).
const GATE_OUT_DIR_FLAG = `--outDir ${GATE_OUT_DIR}`;

/**
 * Assert the repository's build/serve wiring. Pure over a `scripts` map (the
 * `scripts` object of package.json).
 *
 * @param {Record<string, string>} scripts
 * @returns {{ok: boolean, problems: Array<{code: string, script: string, message: string}>}}
 */
export function checkPlaytestScriptWiring(scripts) {
  const problems = [];
  const map = scripts && typeof scripts === 'object' ? scripts : {};

  for (const rule of WIRING_RULES) {
    const cmd = map[rule.script];
    if (typeof cmd !== 'string' || cmd.length === 0) {
      problems.push({ code: 'missing-script', script: rule.script, message: `package.json script "${rule.script}" is missing — ${rule.why}.` });
      continue;
    }
    const failure = rule.check(cmd);
    if (failure) {
      problems.push({ code: 'bad-wiring', script: rule.script, message: `package.json script "${rule.script}" ${failure} (${rule.why})` });
    }
    if (rule.script.startsWith('playtest:') && rule.script.endsWith(':preview')) {
      // `--outDir dist-playtest` also contains `--outDir dist` as a substring, so
      // match the flag as a whole token.
      const servesGateDir = new RegExp(`${GATE_OUT_DIR_FLAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(cmd);
      if (servesGateDir) {
        problems.push({ code: 'serves-gate-dir', script: rule.script, message: `package.json script "${rule.script}" serves "${GATE_OUT_DIR}" — that is the directory \`npm run verify\` overwrites, which silently breaks the live playtest.` });
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

/** One line per problem, for a runner's stderr. Empty string when there are none. */
export function formatProblems(problems) {
  if (!Array.isArray(problems) || problems.length === 0) return '';
  return problems.map((p) => `  ✗ [${p.code}] ${p.message}`).join('\n');
}
