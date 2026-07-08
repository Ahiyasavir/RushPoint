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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.tunnel.env');
const PORT = 3000;

// --- load config (.tunnel.env overrides nothing already in process.env) ---
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

const AUTHTOKEN = process.env.NGROK_AUTHTOKEN;
const DOMAIN = process.env.NGROK_DOMAIN;

if (!AUTHTOKEN || !DOMAIN) {
  console.error('\n[ngrok] Missing config. Create a repo-root `.tunnel.env` with:');
  console.error('  NGROK_AUTHTOKEN=<from https://dashboard.ngrok.com/get-started/your-authtoken>');
  console.error('  NGROK_DOMAIN=<your reserved domain, e.g. your-name.ngrok-free.app>');
  console.error('Get a free static domain at https://dashboard.ngrok.com/domains\n');
  process.exit(1);
}

const isWin = process.platform === 'win32';
const NPX = isWin ? 'npx.cmd' : 'npx';

// --- register the authtoken once (idempotent, cheap) ---
const reg = spawnSync(NPX, ['ngrok', 'config', 'add-authtoken', AUTHTOKEN], {
  stdio: 'inherit',
  shell: isWin,
});
if (reg.status !== 0) {
  console.error('[ngrok] Failed to register authtoken.');
  process.exit(reg.status ?? 1);
}

// --- start the tunnel on the fixed domain ---
console.log(`\n[ngrok] Tunnelling https://${DOMAIN}  ->  http://localhost:${PORT}`);
console.log('[ngrok]   creator : https://' + DOMAIN + '/creator/');
console.log('[ngrok]   play    : https://' + DOMAIN + '/');
console.log('[ngrok]   staff   : https://' + DOMAIN + '/?staff\n');

const child = spawn(
  NPX,
  ['ngrok', 'http', String(PORT), '--domain', DOMAIN, '--log', 'stdout'],
  { stdio: 'inherit', shell: isWin },
);

const stop = () => { try { child.kill(); } catch {} };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
