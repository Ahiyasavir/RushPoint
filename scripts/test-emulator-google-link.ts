// Tests for unify-email-google-login.
// (a) PURE: buildEmulatorGoogleClaims payload shape (no emulator).
// (b) INTEGRATION: the Auth emulator links a Google sign-in onto an existing password
//     account (same uid) — the platform behavior the DEV bridge relies on. Skipped
//     gracefully when the emulator isn't reachable, so `npm test` stays green without it.
import { buildEmulatorGoogleClaims } from '../apps/creator-web/src/services/authClaims';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── (a) PURE — claims builder ────────────────────────────────────────────────
{
  const full = buildEmulatorGoogleClaims({ uid: 'g123', email: 'a@b.com', displayName: 'Al', photoURL: 'http://p/x.png' });
  ok(full.sub === 'g123', 'sub = uid');
  ok(full.email === 'a@b.com', 'email carried');
  ok(full.email_verified === true, 'email_verified always true');
  ok(full.name === 'Al', 'name included when present');
  ok(full.picture === 'http://p/x.png', 'picture included when present');

  const minimal = buildEmulatorGoogleClaims({ uid: 'g9', email: 'c@d.com' });
  ok(minimal.sub === 'g9' && minimal.email === 'c@d.com' && minimal.email_verified === true, 'minimal has required fields');
  ok(!('name' in minimal), 'name omitted when absent');
  ok(!('picture' in minimal), 'picture omitted when absent');

  // Must serialize to the emulator id_token contract.
  const s = JSON.stringify(buildEmulatorGoogleClaims({ uid: 'x', email: 'e@f.com' }));
  ok(s.includes('"sub":"x"') && s.includes('"email_verified":true'), 'serializes to id_token claims');
}

// ── (b) INTEGRATION — emulator links Google onto an existing password account ──
async function integration() {
  const BASE = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
  const KEY = 'emulator-key';
  const email = `link_${Date.now()}@example.com`;
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${BASE}/${path}?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };

  let reachable = true;
  try {
    const signUp = await post('accounts:signUp', { email, password: 'realPass123', returnSecureToken: true });
    if (signUp.status !== 200 || !signUp.body.localId) { ok(false, `password signUp failed: ${JSON.stringify(signUp.body)}`); return; }
    const pwUid = signUp.body.localId as string;

    const claims = buildEmulatorGoogleClaims({ uid: `google_${pwUid}`, email });
    const idp = await post('accounts:signInWithIdp', {
      postBody: `id_token=${JSON.stringify(claims)}&providerId=google.com`,
      requestUri: 'http://localhost', returnIdpCredential: true, returnSecureToken: true,
    });
    ok(idp.status === 200, 'signInWithIdp for existing email returns 200');
    ok(idp.body.localId === pwUid, 'Google links onto the SAME account (uid matches the password account)');
    ok(!idp.body.needConfirmation, 'no account-exists conflict (needConfirmation falsy)');
  } catch {
    reachable = false;
  }
  if (!reachable) console.log('  … emulator not reachable — integration half skipped (pure half still enforced)');
}

// No top-level await: the tsx aggregator transforms these scripts to CJS.
// Set exitCode (don't call process.exit) — a hard exit while fetch/undici keepalive
// sockets are still closing aborts with a libuv assertion on Windows. Letting the loop
// drain exits cleanly with the right code.
integration().then(() => {
  console.log(failed === 0
    ? `\n✅ ALL EMULATOR-GOOGLE-LINK TESTS PASSED (${passed})`
    : `\n❌ ${failed} failed, ${passed} passed`);
  process.exitCode = failed === 0 ? 0 : 1;
});
