// Slack / Microsoft-Teams outbound webhook payloads (change: chat-integrations).
// Pure builders + URL guard — no network I/O here (the server does the POST). Kept
// pure so the payload shape and the SSRF allow-list are unit-tested without a socket.

export type WebhookPlatform = 'slack' | 'teams';

// A normalized broadcast event, platform-agnostic. The server maps a pushed
// announcement / flash mission / leaderboard refresh into this shape, then a
// per-platform builder renders the wire body.
export interface WebhookEvent {
  kind: 'announcement' | 'flashMission' | 'leaderboard';
  gameTitle: string;
  title?: string;                 // flash-mission / leaderboard heading
  message?: string;               // announcement text or mission description
  bonusPoints?: number;           // flash mission
  leaders?: { rank: number; teamName: string; score: number }[]; // leaderboard top N
}

// ── SSRF guard ────────────────────────────────────────────────────────────────
// An owner supplies the webhook URL and the SERVER fetches it, so we must refuse
// anything that isn't a real Slack / Teams incoming-webhook endpoint (no loopback,
// no internal hosts, https only). Host must end with one of the allowed suffixes.
const ALLOWED_HOST_SUFFIXES = [
  'hooks.slack.com',
  'webhook.office.com',       // Teams incoming webhook
  'office.com',               // Teams / Power Automate variants
  'logic.azure.com',          // Power Automate (Teams) flows
];

export function isAllowedWebhookUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false;
  let u: URL;
  try { u = new URL(url.trim()); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  // Reject IP-literal / loopback / internal explicitly.
  if (host === 'localhost' || /^\d/.test(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }
  return ALLOWED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

/** Detect the platform from the webhook URL (best-effort; defaults to slack). */
export function detectPlatform(url: string): WebhookPlatform {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith('slack.com')) return 'slack';
    return 'teams';
  } catch { return 'slack'; }
}

// ── Plain-text rendering (shared by both platforms) ──
function eventLines(e: WebhookEvent): { heading: string; body: string } {
  switch (e.kind) {
    case 'announcement':
      return { heading: `📢 ${e.gameTitle}`, body: e.message ?? '' };
    case 'flashMission': {
      const pts = typeof e.bonusPoints === 'number' && e.bonusPoints > 0 ? ` (+${e.bonusPoints} pts)` : '';
      return { heading: `⚡ ${e.title ?? 'Flash mission'}${pts}`, body: e.message ?? '' };
    }
    case 'leaderboard': {
      const rows = (e.leaders ?? []).slice(0, 5)
        .map((l) => `${l.rank}. ${l.teamName} — ${l.score}`)
        .join('\n');
      return { heading: `🏆 ${e.title ?? e.gameTitle} — leaderboard`, body: rows };
    }
  }
}

// ── Slack incoming webhook ({ text }) ──
export function buildSlackPayload(e: WebhookEvent): { text: string } {
  const { heading, body } = eventLines(e);
  return { text: body ? `*${heading}*\n${body}` : `*${heading}*` };
}

// ── Teams incoming webhook (legacy MessageCard) ──
export function buildTeamsPayload(e: WebhookEvent): Record<string, unknown> {
  const { heading, body } = eventLines(e);
  const themeColor = e.kind === 'flashMission' ? 'FF7043' : e.kind === 'leaderboard' ? 'F59E0B' : '3B82F6';
  return {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    themeColor,
    summary: heading,
    title: heading,
    text: body,
  };
}

/** Build the correct wire body for the platform (auto-detected if not given). */
export function buildWebhookPayload(e: WebhookEvent, platform?: WebhookPlatform): Record<string, unknown> {
  const p = platform ?? 'slack';
  return p === 'teams' ? buildTeamsPayload(e) : buildSlackPayload(e);
}
