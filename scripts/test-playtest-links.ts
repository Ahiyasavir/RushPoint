// Pure-logic tests for playtest-shareable-links.
// Run by scripts/run-unit-tests.mjs via `npm test`.
import { resolveEmulatorHost, resolveProxyTarget, buildPlaytestLinks, resolvePlayOrigin, EMULATOR_PORTS } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── resolveEmulatorHost ──────────────────────────────────────────────────────
ok(resolveEmulatorHost(undefined) === '127.0.0.1', 'no env → local default');
ok(resolveEmulatorHost({}) === '127.0.0.1', 'empty env → local default');
ok(resolveEmulatorHost({ VITE_EMULATOR_HOST: '192.168.1.5' }) === '192.168.1.5', 'explicit host wins');
ok(resolveEmulatorHost({ VITE_EMULATOR_HOST: '  10.0.0.2  ' }) === '10.0.0.2', 'explicit host trimmed');
ok(resolveEmulatorHost({}, 'http://localhost:5181') === '127.0.0.1', 'local origin → default (dev:all unchanged)');
ok(resolveEmulatorHost({}, 'http://127.0.0.1:5181') === '127.0.0.1', '127.0.0.1 origin → default');
ok(resolveEmulatorHost({ VITE_PLAYTEST: '1' }, 'https://abc.trycloudflare.com') === 'abc.trycloudflare.com', 'playtest flag → origin hostname');
ok(resolveEmulatorHost({}, 'https://abc.trycloudflare.com') === 'abc.trycloudflare.com', 'remote origin auto-detected (no flag needed)');
ok(resolveEmulatorHost({ VITE_PLAYTEST: 'true' }, 'https://x.example.com:3000') === 'x.example.com', 'playtest true → hostname (strips port)');
ok(resolveEmulatorHost({ VITE_PLAYTEST: '1' }) === '127.0.0.1', 'playtest with no origin → default');
ok(resolveEmulatorHost({ VITE_EMULATOR_HOST: 'host', VITE_PLAYTEST: '1' }, 'https://abc.com') === 'host', 'explicit beats everything');

// ── resolveProxyTarget ───────────────────────────────────────────────────────
ok(resolveProxyTarget('/google.firestore.v1.Firestore/Listen') === EMULATOR_PORTS.firestore, 'firestore → 8080');
ok(resolveProxyTarget('/identitytoolkit.googleapis.com/v1/accounts:signUp') === EMULATOR_PORTS.auth, 'auth → 9099');
ok(resolveProxyTarget('/securetoken.googleapis.com/v1/token') === EMULATOR_PORTS.auth, 'securetoken → 9099');
ok(resolveProxyTarget('/rushpoint-pwa-7daaa/us-central1/joinRun') === EMULATOR_PORTS.functions, 'functions → 5001');
ok(resolveProxyTarget('/v0/b/rushpoint.appspot.com/o') === EMULATOR_PORTS.storage, 'storage → 9199');
ok(resolveProxyTarget('/creator') === EMULATOR_PORTS.creatorWeb, '/creator → 5180');
ok(resolveProxyTarget('/creator/') === EMULATOR_PORTS.creatorWeb, '/creator/ → 5180');
ok(resolveProxyTarget('/creator/dashboard') === EMULATOR_PORTS.creatorWeb, '/creator/* → 5180');
ok(resolveProxyTarget('/creator/src/main.tsx') === EMULATOR_PORTS.creatorWeb, 'creator asset under base → 5180 (the routing bug fix)');
ok(resolveProxyTarget('/creator/@vite/client') === EMULATOR_PORTS.creatorWeb, 'creator vite client under base → 5180');
ok(resolveProxyTarget('/') === EMULATOR_PORTS.playWeb, 'root → play 5181');
ok(resolveProxyTarget('/?code=ABC123') === EMULATOR_PORTS.playWeb, 'join path → play 5181');
ok(resolveProxyTarget('/src/main.tsx') === EMULATOR_PORTS.playWeb, 'play asset at root → play 5181');
ok(resolveProxyTarget('/assets/app.js') === EMULATOR_PORTS.playWeb, 'static asset → play 5181 (default)');

// ── buildPlaytestLinks ───────────────────────────────────────────────────────
{
  const l = buildPlaytestLinks('https://abc.trycloudflare.com', 'PLAY01');
  ok(l.creatorUrl === 'https://abc.trycloudflare.com/creator/', 'creator link (trailing slash so assets stay under /creator/)');
  ok(l.joinUrl === 'https://abc.trycloudflare.com/?code=PLAY01', 'join link with code');
}
{
  const l = buildPlaytestLinks('https://abc.trycloudflare.com/'); // trailing slash, no code
  ok(l.creatorUrl === 'https://abc.trycloudflare.com/creator/', 'trailing slash trimmed then creator/ appended');
  ok(l.joinUrl === 'https://abc.trycloudflare.com', 'no code → base play URL');
}
ok(buildPlaytestLinks('https://x.com', 'A B').joinUrl === 'https://x.com/?code=A%20B', 'code is URL-encoded');

// ── resolvePlayOrigin (creator → play cross-links must drop :5181 over a tunnel) ─
ok(resolvePlayOrigin('http://localhost:5180') === 'http://localhost:5181', 'localhost dev → play on :5181');
ok(resolvePlayOrigin('http://127.0.0.1:5180') === 'http://127.0.0.1:5181', '127.0.0.1 dev → play on :5181');
ok(resolvePlayOrigin('https://abc.trycloudflare.com') === 'https://abc.trycloudflare.com', 'tunnel → same origin (no :5181 port)');
ok(resolvePlayOrigin('https://foo.ngrok-free.app') === 'https://foo.ngrok-free.app', 'ngrok tunnel → same origin');
ok(resolvePlayOrigin(null) === 'http://127.0.0.1:5181', 'no origin → local default');

console.log(failed === 0
  ? `\n✅ ALL PLAYTEST-LINKS TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
