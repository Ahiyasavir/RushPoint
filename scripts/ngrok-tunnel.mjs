// Fixed-URL tunnel for `npm run playtest:ngrok` — fronts the single-origin proxy
// (scripts/proxy.mjs on :3000) with a *stable* ngrok domain so the creator, play
// and staff links never change between runs.
//
// Config (never committed): repo-root `.tunnel.env`, two lines —
//   NGROK_AUTHTOKEN=xxxxxxxx        (from https://dashboard.ngrok.com — one time)
//   NGROK_DOMAIN=your-name.ngrok-free.app   (your free reserved domain)
// Either may also come from the real environment. The ngrok binary is fetched
// on first use via `npx ngrok`.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { restartDelayMs, isQuickFailure } from './lib/tunnelRestart.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.tunnel.env');
const PORT = 3000;

const isWin = process.platform === 'win32';
const NPX = isWin ? 'npx.cmd' : 'npx';

// Pre-start failures (missing `.tunnel.env`, or an `add-authtoken` that can't
// reach ngrok because the host is offline at boot) used to `process.exit(1)`.
// Under `concurrently --kill-others-on-fail` that non-zero exit collapses the
// ENTIRE playtest stack (emulator + vite + proxy) and traps it in a 4s crash-
// loop. Instead we IDLE and retry the whole boot (re-read config → register →
// start) on a bounded interval, exactly like the post-drop reconnect path —
// the local apps keep serving and the tunnel simply comes up once config/network
// is ready (e.g. the user creates `.tunnel.env`), with no full stack restart.
let shuttingDown = false;
let child = null;
let quickFailures = 0;   // rapid tunnel drops AFTER a successful start
let bootFailures = 0;    // consecutive pre-start (config/registration) failures

// Re-read `.tunnel.env` on every boot attempt so a file created after launch is
// picked up without restarting the process. (.tunnel.env never overrides a value
// already present in the real environment.)
function loadConfig() {
  if (existsSync(ENV_FILE)) {
    for (const raw of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  }
  return { AUTHTOKEN: process.env.NGROK_AUTHTOKEN, DOMAIN: process.env.NGROK_DOMAIN };
}

// Schedule another boot attempt without exiting — keeps the process (and the
// rest of the `concurrently` stack) alive while the tunnel is down.
function retryBoot(reason) {
  if (shuttingDown) return;
  bootFailures += 1;
  const delay = restartDelayMs(bootFailures);
  console.error(`[ngrok] ${reason} — tunnel stays DOWN (local apps keep serving); retrying in ${Math.round(delay / 1000)}s…`);
  setTimeout(boot, delay);
}

function boot() {
  if (shuttingDown) return;
  const { AUTHTOKEN, DOMAIN } = loadConfig();

  // Missing config: don't hard-exit — the user may create `.tunnel.env` while
  // the stack runs, and we should recover on the next retry without a restart.
  if (!AUTHTOKEN || !DOMAIN) {
    console.error('\n[ngrok] Missing config. Create a repo-root `.tunnel.env` with:');
    console.error('  NGROK_AUTHTOKEN=<from https://dashboard.ngrok.com/get-started/your-authtoken>');
    console.error('  NGROK_DOMAIN=<your reserved domain, e.g. your-name.ngrok-free.app>');
    console.error('Get a free static domain at https://dashboard.ngrok.com/domains');
    retryBoot('missing NGROK_AUTHTOKEN/NGROK_DOMAIN');
    return;
  }

  // Register the authtoken once (idempotent, cheap). If this fails (commonly the
  // host is offline at boot so the ngrok binary/config can't be fetched) we
  // retry instead of exiting and taking down the stack.
  const reg = spawnSync(NPX, ['ngrok', 'config', 'add-authtoken', AUTHTOKEN], {
    stdio: 'inherit',
    shell: isWin,
  });
  if (reg.status !== 0) {
    retryBoot(`failed to register authtoken (add-authtoken exit ${reg.status ?? 'n/a'})`);
    return;
  }

  bootFailures = 0; // config good + authtoken registered — reset pre-start backoff

  // --- start the tunnel on the fixed domain ---
  console.log(`\n[ngrok] Tunnelling https://${DOMAIN}  ->  http://localhost:${PORT}`);
  console.log('[ngrok]   creator : https://' + DOMAIN + '/creator/');
  console.log('[ngrok]   play    : https://' + DOMAIN + '/');
  console.log('[ngrok]   staff   : https://' + DOMAIN + '/?staff\n');
  startNgrok(DOMAIN);
}

// Resilient tunnel: a dropped ngrok session (e.g. a transient CRL/IPv6 blip)
// must RECONNECT on the same fixed domain, not exit — exiting would collapse the
// whole `concurrently` playtest stack and strand orphaned emulators. We only
// exit on an intentional stop (Ctrl+C / SIGTERM). Rapid back-to-back failures
// back off (capped); a healthy run that later drops reconnects immediately.
function startNgrok(DOMAIN) {
  const startedAt = Date.now();
  child = spawn(
    NPX,
    ['ngrok', 'http', String(PORT), '--domain', DOMAIN, '--log', 'stdout'],
    { stdio: 'inherit', shell: isWin },
  );
  child.on('exit', (code) => {
    if (shuttingDown) { process.exit(code ?? 0); return; }
    quickFailures = isQuickFailure(Date.now() - startedAt) ? quickFailures + 1 : 0;
    const delay = restartDelayMs(quickFailures);
    console.error(`[ngrok] tunnel exited (code ${code ?? 0}) — reconnecting on ${DOMAIN} in ${Math.round(delay / 1000)}s…`);
    setTimeout(() => { if (!shuttingDown) startNgrok(DOMAIN); }, delay);
  });
}

const stop = () => { shuttingDown = true; try { child?.kill(); } catch {} };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
boot();
