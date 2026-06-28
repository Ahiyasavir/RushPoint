// Single-origin reverse proxy for `npm run playtest` — fronts the v2 creator-web
// + play-web dev servers and the Firebase emulator services so a tunnel exposes
// one URL. Routing lives in the pure resolveProxyTarget (playtest-shareable-links).
import http from 'http';
import httpProxy from 'http-proxy';
import { resolveProxyTarget, EMULATOR_PORTS } from '@rushpoint/shared';

const HOST = '127.0.0.1';
const PORT_LABELS = {
  [EMULATOR_PORTS.firestore]: 'Firestore',
  [EMULATOR_PORTS.auth]: 'Auth',
  [EMULATOR_PORTS.functions]: 'Functions',
  [EMULATOR_PORTS.storage]: 'Storage',
  [EMULATOR_PORTS.creatorWeb]: 'creator-web',
  [EMULATOR_PORTS.playWeb]: 'play-web',
};

const proxy = httpProxy.createProxyServer({ ws: true, xfwd: true });

proxy.on('error', (err, req, res) => {
  console.error(`[Proxy Error] ${err.message} — ${req.method} ${req.url}`);
  if (res && res.writeHead && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Bad Gateway: ${err.message}`);
  }
});

const server = http.createServer((req, res) => {
  const port = resolveProxyTarget(req.url);
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  console.log(`[${ts}] ${req.method} ${req.url} → ${PORT_LABELS[port]} (${HOST}:${port})`);
  proxy.web(req, res, { target: `http://${HOST}:${port}` });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log('\n================================================');
  console.log(` RushPoint playtest proxy  →  http://localhost:${PORT}`);
  console.log('------------------------------------------------');
  console.log(' Firestore   :8080   /google.firestore.* /firestore');
  console.log(' Auth        :9099   /identitytoolkit.* /securetoken.*');
  console.log(' Functions   :5001   /rushpoint-pwa-7daaa/us-central1/*');
  console.log(' Storage     :9199   /v0/b/*');
  console.log(' creator-web :5180   /creator*');
  console.log(' play-web    :5181   (everything else)');
  console.log('================================================\n');
});

server.on('upgrade', (req, socket, head) => {
  const port = resolveProxyTarget(req.url);
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] WS  ${req.url} → ${PORT_LABELS[port]} (${HOST}:${port})`);
  proxy.ws(req, socket, head, { target: `http://${HOST}:${port}` });
});
