// Supervisor: keep `npm run playtest:ngrok` UP forever, independent of any editor
// / agent / Claude-Code process. Launched detached (see scripts/playtest-forever.README),
// it survives the parent that started it and stays up as long as the machine is on.
//
// Behavior: run the full playtest stack; if it exits for ANY reason (crash, ngrok
// drop that takes the stack down, transient network), free ports and relaunch after
// a short backoff. A stop-file (or SIGINT) ends the supervisor cleanly.
//
//   node scripts/playtest-forever.mjs            # run the supervisor loop
//   node scripts/playtest-forever.mjs --stop     # ask a running supervisor to stop
//
// Logs → .firebase/playtest-forever.log  ·  PID → .firebase/playtest-forever.pid
// Stop → create .firebase/playtest-forever.stop (the loop notices and exits)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = path.join(ROOT, '.firebase');
const LOG = path.join(STATE_DIR, 'playtest-forever.log');
const PIDF = path.join(STATE_DIR, 'playtest-forever.pid');
const STOPF = path.join(STATE_DIR, 'playtest-forever.stop');
const RESTART_BACKOFF_MS = 4_000;

fs.mkdirSync(STATE_DIR, { recursive: true });

function log(line) {
  const stamp = new Date().toISOString();
  const msg = `[forever ${stamp}] ${line}\n`;
  try { fs.appendFileSync(LOG, msg); } catch { /* ignore */ }
  process.stdout.write(msg);
}

// --stop: signal a running supervisor to exit.
if (process.argv.includes('--stop')) {
  fs.writeFileSync(STOPF, String(Date.now()));
  log('stop requested (wrote .stop file); the supervisor will exit after the current stack tears down.');
  process.exit(0);
}

if (fs.existsSync(STOPF)) fs.rmSync(STOPF, { force: true });
fs.writeFileSync(PIDF, String(process.pid));
log(`supervisor up (pid ${process.pid}). Keeping playtest:ngrok alive until --stop / .stop file / SIGINT.`);

let child = null;
let stopping = false;

function freePorts() {
  return new Promise((resolve) => {
    const p = spawn('node', ['scripts/free-ports.mjs'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
    p.on('exit', () => resolve());
    p.on('error', () => resolve());
  });
}

function runOnce() {
  return new Promise((resolve) => {
    log('launching: npm run playtest:ngrok');
    child = spawn('npm', ['run', 'playtest:ngrok'], {
      cwd: ROOT,
      stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')],
      shell: process.platform === 'win32',
    });
    child.on('exit', (code, signal) => {
      log(`playtest:ngrok exited (code=${code}, signal=${signal}).`);
      child = null;
      resolve();
    });
    child.on('error', (err) => {
      log(`failed to spawn playtest:ngrok: ${err.message}`);
      child = null;
      resolve();
    });
  });
}

async function stop() {
  if (stopping) return;
  stopping = true;
  log('stopping supervisor…');
  if (child) { try { child.kill(); } catch { /* ignore */ } }
  await freePorts();
  try { fs.rmSync(PIDF, { force: true }); } catch { /* ignore */ }
  try { fs.rmSync(STOPF, { force: true }); } catch { /* ignore */ }
  log('supervisor stopped.');
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// Supervisor loop: run the stack, and whenever it dies, clean ports and relaunch.
while (!stopping) {
  if (fs.existsSync(STOPF)) { await stop(); break; }
  await freePorts();                 // start each attempt from clean ports (kills orphan Java)
  await runOnce();                    // blocks until the stack exits
  if (fs.existsSync(STOPF) || stopping) { await stop(); break; }
  log(`restarting in ${RESTART_BACKOFF_MS / 1000}s…`);
  await new Promise((r) => setTimeout(r, RESTART_BACKOFF_MS));
}
