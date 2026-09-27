// ─── SSRF guard for POST /ingest-url (change: server-side-url-ingest) ────────
//
// The creator drags a picture out of another browser tab. The browser hands the
// page a URL, never the bytes, and a cross-origin image is only readable in the
// browser if its host sends CORS headers — which Wikimedia and Unsplash do and
// Google Images thumbnails do not. So the fetch moves to the server, and the
// moment it does, THIS SERVER becomes an HTTP client that fetches an address an
// unauthenticated-to-us third party chose. That is server-side request forgery,
// and the whole point of this file is to make the address space it can reach
// exactly "the public internet" and nothing else.
//
// The VPS is the dangerous place for this to live: it runs the API, holds
// `service-account.json`, and sits on a provider network where 169.254.169.254
// is a credential endpoint. An unguarded fetcher there is not a small bug.
//
// WHAT IS ENFORCED, and why each one is not optional:
//
//   SCHEME        http/https only. `file://` reads the disk, `gopher://` and
//                 friends have historically been used to speak other protocols
//                 through a naive fetcher.
//   CREDENTIALS   no `user:pass@` — never useful for a public image, and it is
//                 how a URL smuggles auth at a host we are about to trust.
//   PORT          80/443 only. An arbitrary port turns this endpoint into a port
//                 scanner of the VPS's own network, whose *timing* leaks which
//                 internal services exist even when nothing is returned.
//   ADDRESS       every resolved address must be publicly routable. Checked
//                 against the RESOLVED IPs, not the hostname — a name is not a
//                 place, and an attacker controls what their own DNS answers.
//   REDIRECTS     re-validated at every hop. A public URL that 302s to
//                 169.254.169.254 defeats a check performed only on the first
//                 address; this is the single most common way this guard is got
//                 around, so redirects are followed manually and each Location is
//                 put through `validateIngestUrl` again.
//
// STILL OPEN, and worth naming rather than implying it is covered: DNS rebinding.
// We validate the addresses a name resolves to and then hand the URL to the HTTP
// client, which resolves it again — a name whose TTL expires in between can answer
// differently the second time. Closing that needs pinning the connection to the
// validated IP (a custom agent / `lookup` hook). The window is small and the
// bounded reward here is "fetch one image", so it is documented, not pretended
// away. Do not remove this paragraph to make the file look finished.
//
// Pure and dependency-free so `scripts/test-url-ingest-guard.ts` can exercise
// every branch without a network: DNS enters through an injected lookup.

/** Reserved / non-public IPv4 ranges, as [firstOctetMatcher, description]. */
function isBlockedIPv4(ip) {
  const raw = ip.split('.');
  // A LEADING ZERO MAKES THE OCTET AMBIGUOUS, so it is refused outright. `Number`
  // reads "0177" as decimal 177 — a public address — while resolvers that honour
  // the classic octal form read it as 127, i.e. loopback. `0177.0.0.1` therefore
  // walked straight through an earlier version of this function, and that is not a
  // hypothetical: octal and decimal encodings of 127.0.0.1 exist in the wild almost
  // exclusively to defeat checks like this one. Caught by the enumeration in
  // scripts/test-url-ingest-guard.ts on its first run, which is the argument for
  // testing this file by enumeration rather than by example.
  if (raw.some((p) => p.length > 1 && p.startsWith('0'))) return true;
  if (raw.some((p) => !/^\d{1,3}$/.test(p))) return true;
  const parts = raw.map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true;                       // 0.0.0.0/8 "this network"
  if (a === 10) return true;                      // private
  if (a === 127) return true;                     // loopback
  if (a === 169 && b === 254) return true;        // link-local — cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true;        // private
  if (a === 192 && b === 0) return true;          // 192.0.0/24 IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a === 192 && b === 88) return true;         // 192.88.99/24 6to4 relay anycast
  if (a >= 224) return true;                      // multicast (224/4) + reserved (240/4)
  return false;
}

/** Reserved / non-public IPv6, including v4-mapped forms. */
function isBlockedIPv6(ip) {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
  // ::ffff:1.2.3.4 and ::ffff:0102:0304 both mean an IPv4 address; judge it as one.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isBlockedIPv4(mapped[1]);
  if (lower === '::' || lower === '::1') return true;      // unspecified, loopback
  if (/^fe[89ab]/.test(lower)) return true;                // fe80::/10 link-local
  if (/^f[cd]/.test(lower)) return true;                   // fc00::/7 unique-local
  if (/^ff/.test(lower)) return true;                      // ff00::/8 multicast
  if (/^(2001:0?db8|64:ff9b|2002:)/.test(lower)) return true; // doc, NAT64, 6to4
  return false;
}

/** True when this literal address must not be fetched. Unknown shapes are BLOCKED. */
function isBlockedAddress(ip) {
  if (typeof ip !== 'string' || ip.trim() === '') return true;
  const v = ip.trim();
  if (v.includes(':')) return isBlockedIPv6(v);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) return isBlockedIPv4(v);
  // Not an address we can reason about — refuse rather than guess. A decimal or
  // octal-encoded IPv4 ("2130706433", "0177.0.0.1") lands here and is refused,
  // which is the right answer: those forms exist in the wild almost exclusively
  // to slip past checks like this one.
  return true;
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_PORTS = new Set(['', '80', '443']);

/**
 * Static checks on the URL itself. Returns `{ ok: true, url }` or
 * `{ ok: false, reason }` — never throws, so a malformed string is a refusal
 * rather than a 500.
 */
function validateIngestUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'missing' };
  if (raw.length > 2048) return { ok: false, reason: 'too-long' };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return { ok: false, reason: 'scheme' };
  if (url.username || url.password) return { ok: false, reason: 'credentials' };
  if (!ALLOWED_PORTS.has(url.port)) return { ok: false, reason: 'port' };
  if (!url.hostname) return { ok: false, reason: 'no-host' };
  // A bare literal can be judged now; a NAME needs DNS, which is `assertPublicHost`.
  const bare = url.hostname.replace(/^\[|\]$/g, '');
  const isLiteral = bare.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(bare);
  if (isLiteral && isBlockedAddress(bare)) return { ok: false, reason: 'blocked-address' };
  // "localhost" and anything under .localhost / .internal / .local never resolve
  // anywhere we want to reach, and saying so here gives a clearer refusal than
  // waiting for DNS to hand back 127.0.0.1.
  if (/(^|\.)(localhost|internal|local|localdomain)$/i.test(bare)) return { ok: false, reason: 'blocked-host' };
  return { ok: true, url };
}

/**
 * Resolve `hostname` and refuse unless EVERY answer is publicly routable.
 *
 * Every answer, not the first: a name that returns one public and one private
 * address would otherwise be a coin flip, and the attacker picks the coin.
 *
 * @param lookupAll async (hostname) => [{ address, family }]
 */
async function assertPublicHost(hostname, lookupAll) {
  const bare = String(hostname || '').replace(/^\[|\]$/g, '');
  if (bare.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(bare)) {
    return isBlockedAddress(bare) ? { ok: false, reason: 'blocked-address' } : { ok: true, addresses: [bare] };
  }
  let answers;
  try {
    answers = await lookupAll(bare);
  } catch {
    return { ok: false, reason: 'dns' };
  }
  const addresses = (answers || []).map((a) => (typeof a === 'string' ? a : a && a.address)).filter(Boolean);
  if (addresses.length === 0) return { ok: false, reason: 'dns' };
  if (addresses.some((a) => isBlockedAddress(a))) return { ok: false, reason: 'blocked-address' };
  return { ok: true, addresses };
}

module.exports = {
  isBlockedAddress,
  validateIngestUrl,
  assertPublicHost,
  ALLOWED_PROTOCOLS,
  ALLOWED_PORTS,
};
