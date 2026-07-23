// Pure backoff / quick-failure logic for the resilient playtest tunnel
// (changes: playtest-tunnel-auto-restart, playtest-durability). No Date.now(),
// no I/O, no spawn, no os.* — uptimes, failure counts, log text, hostname and
// dataset markers are all passed in so this is fully unit-testable.

/**
 * Capped exponential backoff before the next tunnel restart:
 * `min(maxMs, baseMs * 2 ** consecutiveQuickFailures)`. First restart is quick
 * (~baseMs); grows only while the tunnel keeps failing immediately.
 */
export function restartDelayMs(consecutiveQuickFailures, { baseMs = 1000, maxMs = 30000 } = {}) {
  const n = Math.max(0, consecutiveQuickFailures | 0);
  return Math.min(maxMs, baseMs * 2 ** n);
}

/**
 * Whether a tunnel exit counts as a "quick" failure (rapid back-to-back drop)
 * vs a healthy-then-dropped run. A run that stayed up at least `thresholdMs`
 * resets the backoff so a single late drop reconnects immediately.
 */
export function isQuickFailure(uptimeMs, thresholdMs = 10000) {
  return uptimeMs < thresholdMs;
}

// ─── Failure classification (playtest-durability) ─────────────────────────────
//
// Why this exists: the tunnel supervisor used to have exactly ONE failure model
// — "it dropped, back off, retry". That is wrong for a whole class of failures
// that retrying can NEVER fix. On 2026-07-22 a second computer held the same
// reserved ngrok domain; ngrok free allows one online agent per domain, so this
// machine's tunnel crash-looped for hours printing only a generic reconnect
// line. Meanwhile the shared URL kept serving the OTHER machine's emulator —
// and because each machine runs its own Auth emulator, the same Google account
// resolves to a different uid per machine, so the creator signed in, saw an
// empty account, and concluded their game had been deleted. It had not.
//
// Ordered most-specific first: a permanent cause must win over transient noise
// that happens to co-occur in the same output tail, because the permanent one
// is the only one the operator can act on.
const FAILURE_SIGNALS = [
  ['domain-contention', /ERR_NGROK_334|is already online/i],
  ['auth', /ERR_NGROK_10[57]|authentication failed|invalid\s+authtoken/i],
  ['network', /ECONNREFUSED|dial tcp|no such host|context deadline exceeded/i],
];

/**
 * Classify a tunnel child's captured stderr/stdout tail.
 *   'domain-contention' — another ngrok agent holds this reserved domain
 *   'auth'              — bad/missing authtoken
 *   'network'           — transient connectivity
 *   'unknown'           — anything else (including empty/nullish input)
 * Never throws: non-string input classifies as 'unknown'.
 */
export function classifyTunnelFailure(text) {
  const s = typeof text === 'string' ? text : '';
  if (!s) return 'unknown';
  for (const [kind, re] of FAILURE_SIGNALS) {
    if (re.test(s)) return kind;
  }
  return 'unknown';
}

/**
 * Whether a failure kind is PERMANENT — retrying alone will never clear it, so
 * the supervisor must keep re-announcing it rather than saying it once and
 * letting it scroll away. That silence is exactly how this went unnoticed.
 */
export function isPermanentTunnelFailure(kind) {
  return kind === 'domain-contention' || kind === 'auth';
}

/**
 * Build the operator-facing block for a failure kind. Pure — returns the lines
 * instead of printing them, so the WORDING is unit-testable and can't be
 * quietly watered down later. A contention block must always state the cause,
 * the consequence, and the fix.
 *   returns { permanent, headline, lines[] }
 */
export function tunnelFailureReport(kind, { domain = '', identity = '' } = {}) {
  const permanent = isPermanentTunnelFailure(kind);
  if (kind === 'domain-contention') {
    return {
      permanent,
      headline: `⛔ TUNNEL DOMAIN CONFLICT — ${domain || 'this reserved domain'} is held by ANOTHER ngrok agent`,
      lines: [
        `   ${identity}`,
        '   Cause: ngrok free allows ONE online agent per reserved domain, and',
        '          another machine currently owns this one.',
        `   Consequence: https://${domain} is serving a DIFFERENT computer's data`,
        '          — NOT this machine. Each machine has its own Auth emulator, so the',
        '          same account resolves to a different uid there and games created',
        '          here will look missing.',
        '   Fix: stop the tunnel on the other machine (Ctrl+C once, let it export).',
        '        This tunnel reclaims the domain automatically on its next retry.',
      ],
    };
  }
  if (kind === 'auth') {
    return {
      permanent,
      headline: '⛔ TUNNEL AUTH FAILURE — ngrok rejected the authtoken',
      lines: [
        `   ${identity}`,
        '   Fix: set a valid NGROK_AUTHTOKEN in .tunnel.env. Retrying will not help.',
      ],
    };
  }
  return {
    permanent,
    headline: kind === 'network'
      ? '… tunnel network blip — reconnecting'
      : '… tunnel exited — reconnecting',
    lines: identity ? [`   ${identity}`] : [],
  };
}

/**
 * One-line "which computer is this?" marker: hostname + the dataset actually
 * imported. Printed at emulator boot and embedded in every contention block so
 * the question that took a forensic sweep to answer is answerable from the
 * terminal. Pure — the caller injects os.hostname() and the resolved import.
 */
export function machineIdentity({ hostname, importSource, importMs } = {}) {
  const host = hostname || 'unknown-host';
  const src = importSource || 'fresh (no import)';
  const when = Number.isFinite(importMs) ? new Date(importMs).toISOString() : 'unknown time';
  return `this machine: ${host} · dataset: ${src} @ ${when}`;
}
