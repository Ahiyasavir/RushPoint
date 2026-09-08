// The SSRF guard for POST /ingest-url (change: server-side-url-ingest).
//
// This endpoint makes the VPS fetch an address a caller chose, on a box that runs
// the API, holds service-account.json and sits on a provider network where
// 169.254.169.254 hands out credentials. The guard is the only thing between those
// two facts, so it is tested by ENUMERATION rather than by a couple of examples:
// every reserved IPv4 range, the IPv6 forms including v4-mapped, the encodings
// that exist to slip past checks like this, and — the one that actually catches
// people — a redirect from a public host to a private one.
//
// Pure: DNS and fetch are injected, nothing here touches the network.
import { strict as assert } from 'node:assert';
import {
  isBlockedAddress,
  validateIngestUrl,
  assertPublicHost,
} from '../functions/urlIngestGuard.js';
import { fetchGuarded, MAX_REDIRECTS } from '../functions/ingestUrlRoute.js';

let checks = 0;
const pass = (label: string) => { checks++; console.log(`PASS  ${label}`); };

// ── Blocked address space ────────────────────────────────────────────────────
const MUST_BLOCK = [
  '127.0.0.1', '127.1.2.3',            // loopback
  '10.0.0.1', '10.255.255.255',        // private
  '172.16.0.1', '172.31.255.254',      // private
  '192.168.1.1',                       // private
  '169.254.169.254',                   // cloud metadata — the one that matters
  '0.0.0.0',                           // this network
  '100.64.0.1',                        // CGNAT
  '192.0.0.1', '192.88.99.1',          // protocol assignments, 6to4 relay
  '198.18.0.1',                        // benchmarking
  '224.0.0.1', '239.255.255.250',      // multicast
  '240.0.0.1', '255.255.255.255',      // reserved / broadcast
  '::1', '::',                         // IPv6 loopback / unspecified
  'fe80::1',                           // link-local
  'fc00::1', 'fd00::1',                // unique-local
  'ff02::1',                           // multicast
  '::ffff:127.0.0.1',                  // v4-mapped loopback
  '::ffff:169.254.169.254',            // v4-mapped metadata
  '2130706433',                        // decimal-encoded 127.0.0.1
  '0177.0.0.1',                        // octal-encoded loopback
  'not-an-ip', '', '   ',              // unparseable ⇒ refuse, never guess
];
for (const ip of MUST_BLOCK) {
  assert.equal(isBlockedAddress(ip), true, `must block ${JSON.stringify(ip)}`);
}
pass(`every reserved / non-routable address is blocked :: ${MUST_BLOCK.length} address(es)`);

const MUST_ALLOW = ['1.1.1.1', '8.8.8.8', '93.184.216.34', '31.70.107.184', '2606:4700:4700::1111'];
for (const ip of MUST_ALLOW) {
  assert.equal(isBlockedAddress(ip), false, `must allow ${ip}`);
}
pass(`public addresses are allowed :: ${MUST_ALLOW.length} address(es)`);

// The VPS's own public address is allowed by the range check above — worth
// stating, because "block our own box" is a different job (the path/ownership
// check) and conflating them would block a legitimate re-host of our own media.
assert.equal(isBlockedAddress('31.70.107.184'), false);
pass('the VPS public IP is not special-cased here (ownership does that job)');

// ── URL shape ────────────────────────────────────────────────────────────────
const BAD_URLS: Array<[string, string]> = [
  ['file:///etc/passwd', 'scheme'],
  ['gopher://example.com/', 'scheme'],
  ['ftp://example.com/x.png', 'scheme'],
  ['http://user:pass@example.com/x.png', 'credentials'],
  ['http://example.com:22/x.png', 'port'],
  ['http://example.com:8080/x.png', 'port'],
  ['http://127.0.0.1/x.png', 'blocked-address'],
  ['http://[::1]/x.png', 'blocked-address'],
  ['http://169.254.169.254/latest/meta-data/', 'blocked-address'],
  ['http://localhost/x.png', 'blocked-host'],
  ['http://foo.localhost/x.png', 'blocked-host'],
  ['http://db.internal/x.png', 'blocked-host'],
  ['http://printer.local/x.png', 'blocked-host'],
  ['not a url', 'unparseable'],
  ['', 'missing'],
];
for (const [raw, reason] of BAD_URLS) {
  const v = validateIngestUrl(raw);
  assert.equal(v.ok, false, `expected refusal: ${raw}`);
  assert.equal(v.reason, reason, `wrong reason for ${raw}: got ${v.reason}`);
}
pass(`malformed and dangerous URLs are refused with a specific reason :: ${BAD_URLS.length} case(s)`);

assert.equal(validateIngestUrl('https://upload.wikimedia.org/a/b.png').ok, true);
assert.equal(validateIngestUrl('http://example.com:80/a.png').ok, true);
assert.equal(validateIngestUrl('https://example.com:443/a.png').ok, true);
pass('ordinary public image URLs pass, including explicit default ports');

assert.equal(validateIngestUrl('https://example.com/' + 'a'.repeat(3000)).reason, 'too-long');
pass('an absurdly long URL is refused before it is parsed into anything');

// Top-level await is not available in this repo's tsx/cjs transform, so the
// async half runs inside main().
async function main() {
  // ── DNS ──────────────────────────────────────────────────────────────────────
  const lookupOf = (...addresses: string[]) => async () => addresses.map((address) => ({ address }));

  assert.equal((await assertPublicHost('example.com', lookupOf('93.184.216.34'))).ok, true);
  pass('a name resolving to a public address is allowed');

  assert.equal((await assertPublicHost('evil.test', lookupOf('127.0.0.1'))).ok, false);
  pass('a name resolving to loopback is blocked (DNS says where, not the name)');

  // The coin-flip case: one public answer and one private one. Round-robin means the
  // attacker picks which the connection uses, so ANY private answer must refuse.
  const mixed = await assertPublicHost('evil.test', lookupOf('93.184.216.34', '169.254.169.254'));
  assert.equal(mixed.ok, false, 'a mixed answer set must be refused, not sampled');
  pass('a name resolving to BOTH public and private addresses is refused');

  assert.equal((await assertPublicHost('nx.test', async () => { throw new Error('NXDOMAIN'); })).ok, false);
  assert.equal((await assertPublicHost('empty.test', async () => [])).ok, false);
  pass('a DNS failure or empty answer is a refusal, never a pass-through');

  // ── Redirects: the bypass this guard exists for ──────────────────────────────
  function response({ status = 200, location = '', type = 'image/png' } = {}) {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (h: string) => (h.toLowerCase() === 'location' ? location : h.toLowerCase() === 'content-type' ? type : null) },
      body: null,
    };
  }

  const publicLookup = lookupOf('93.184.216.34');

  {
    // A perfectly public first hop that redirects to the metadata service.
    const seen: string[] = [];
    const fetchImpl = async (u: string) => {
      seen.push(u);
      return seen.length === 1
        ? response({ status: 302, location: 'http://169.254.169.254/latest/meta-data/' })
        : response();
    };
    let reason = '';
    try {
      await fetchGuarded('https://example.com/pic.png', { lookupAll: publicLookup, fetchImpl });
    } catch (e) { reason = (e as { reason?: string }).reason ?? ''; }
    assert.equal(reason, 'blocked-address', 'a redirect to link-local must be blocked');
    assert.equal(seen.length, 1, 'the blocked hop must never be requested');
    pass('a public URL that redirects to cloud metadata is blocked at the hop');
  }

  {
    // Redirect chains must terminate.
    const fetchImpl = async () => response({ status: 302, location: 'https://example.com/next.png' });
    let reason = '';
    try {
      await fetchGuarded('https://example.com/a.png', { lookupAll: publicLookup, fetchImpl });
    } catch (e) { reason = (e as { reason?: string }).reason ?? ''; }
    assert.equal(reason, 'too-many-redirects');
    pass(`a redirect loop terminates :: cap ${MAX_REDIRECTS}`);
  }

  {
    // A redirect with no Location is a refusal, not a crash.
    const fetchImpl = async () => response({ status: 302, location: '' });
    let reason = '';
    try {
      await fetchGuarded('https://example.com/a.png', { lookupAll: publicLookup, fetchImpl });
    } catch (e) { reason = (e as { reason?: string }).reason ?? ''; }
    assert.equal(reason, 'redirect-no-location');
    pass('a 302 with no Location is refused rather than throwing');
  }

  {
    // The happy path still works, and asks for manual redirects.
    let opts: Record<string, unknown> = {};
    const fetchImpl = async (_u: string, o: Record<string, unknown>) => { opts = o; return response(); };
    const res = await fetchGuarded('https://example.com/pic.png', { lookupAll: publicLookup, fetchImpl });
    assert.equal(res.status, 200);
    assert.equal(opts.redirect, 'manual', 'redirect:manual is what makes per-hop validation possible');
    pass('a public image is fetched, with redirect:manual so every hop is re-checked');
  }

  {
    // A non-2xx upstream is a refusal (and must not be written to disk).
    const fetchImpl = async () => response({ status: 404 });
    let reason = '';
    try {
      await fetchGuarded('https://example.com/missing.png', { lookupAll: publicLookup, fetchImpl });
    } catch (e) { reason = (e as { reason?: string }).reason ?? ''; }
    assert.equal(reason, 'status');
    pass('a 404 upstream is a refusal');
  }

  // ── The handler: refusals must happen in the right ORDER ────────────────────
  //
  // Order is the security property here, not a detail. A caller who may not write
  // to the target folder must be refused BEFORE this server makes any outbound
  // request — otherwise the endpoint is a fetch-anything proxy for anyone with an
  // account, and ownership merely decides who keeps the file. The injected fetch
  // throws, so reaching it fails the test.
  const { createIngestUrlHandler } = await import('../functions/ingestUrlRoute.js');

  const mkRes = () => {
    const o: any = { code: 0, payload: null };
    o.status = (c: number) => { o.code = c; return o; };
    o.json = (pl: any) => { o.payload = pl; return o; };
    return o;
  };
  const handler = createIngestUrlHandler({
    verifyIdToken: async () => ({ uid: 'creator-A' }),
    uploadDir: '/tmp/rushpoint-test-never-written',
    resolveOrigin: () => 'https://api.example',
    lookupAll: async () => [{ address: '93.184.216.34' }],
    fetchImpl: async () => { throw new Error('outbound request must not happen'); },
  });
  const call = async (body: unknown, withAuth = true) => {
    const res = mkRes();
    await handler({ headers: withAuth ? { authorization: 'Bearer t' } : {}, body } as any, res as any);
    return res;
  };

  assert.equal((await call({}, false)).code, 401);
  pass('no bearer token means 401, before anything else');

  const idor = await call({ url: 'https://ok.example/a.png', path: 'gameMedia/creator-B/games/g/t.png' });
  assert.equal(idor.code, 403);
  assert.equal(idor.payload.error.status, 'PERMISSION_DENIED');
  pass("another creator's folder means 403, and NO outbound request is made");

  const meta = await call({ url: 'http://169.254.169.254/latest/meta-data/', path: 'gameMedia/creator-A/games/g/t.png' });
  assert.equal(meta.code, 400);
  assert.equal(meta.payload.error.message, 'URL not allowed');
  pass('the cloud metadata service is refused, with a message that names no address');

  assert.equal((await call({ url: 'file:///etc/passwd', path: 'gameMedia/creator-A/games/g/t.png' })).code, 400);
  pass('file scheme is refused');

  assert.equal((await call({ url: 'https://ok.example/a.png', path: '../../etc/passwd' })).code, 400);
  pass('a path outside the upload namespace is refused');

  console.log(`\nALL URL INGEST GUARD TESTS PASSED :: ${checks} checks`);
}

void main().catch((e) => { console.error(e); process.exit(1); });
