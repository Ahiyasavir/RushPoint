import http from 'http';
import httpProxy from 'http-proxy';

const proxy = httpProxy.createProxyServer({
  ws: true,
  xfwd: true,
});

proxy.on('error', (err, req, res) => {
  console.error(`[Proxy Error] ${err.message} — ${req.method} ${req.url}`);
  if (res && res.writeHead && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Bad Gateway: ${err.message}`);
  }
});

function resolveTarget(url) {
  if (url.includes('/google.firestore'))           return { host: '127.0.0.1', port: 8080, label: 'Firestore' };
  if (url.includes('/identitytoolkit') ||
      url.includes('/securetoken')     ||
      url.includes('/emulator/'))                  return { host: '127.0.0.1', port: 9099, label: 'Auth' };
  if (url.includes(`/rushpoint-pwa-7daaa/us-central1`) ||
      url.includes('/functions'))                  return { host: '127.0.0.1', port: 5001, label: 'Functions' };
  if (url.includes('/v0/b/'))                      return { host: '127.0.0.1', port: 9199, label: 'Storage' };
  return { host: '127.0.0.1', port: 8081, label: 'Mobile PWA' };
}

const server = http.createServer((req, res) => {
  const { host, port, label } = resolveTarget(req.url);
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  console.log(`[${ts}] ${req.method} ${req.url} → ${label} (${host}:${port})`);
  proxy.web(req, res, { target: `http://${host}:${port}` });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log('\n================================================');
  console.log(` Firebase Reverse Proxy  →  http://localhost:${PORT}`);
  console.log('------------------------------------------------');
  console.log(' Firestore   :8080   /google.firestore.*');
  console.log(' Auth        :9099   /identitytoolkit.* /securetoken.*');
  console.log(' Functions   :5001   /rushpoint-pwa-7daaa/us-central1/*');
  console.log(' Storage     :9199   /v0/b/*');
  console.log(' Mobile PWA  :8081   (everything else)');
  console.log('================================================\n');
});

server.on('upgrade', (req, socket, head) => {
  const ts = new Date().toISOString().slice(11, 23);
  if (req.url.includes('/google.firestore')) {
    console.log(`[${ts}] WS  ${req.url} → Firestore (127.0.0.1:8080)`);
    proxy.ws(req, socket, head, { target: 'http://127.0.0.1:8080' });
  } else {
    console.log(`[${ts}] WS  ${req.url} → Mobile PWA (127.0.0.1:8081)`);
    proxy.ws(req, socket, head, { target: 'http://127.0.0.1:8081' });
  }
});
