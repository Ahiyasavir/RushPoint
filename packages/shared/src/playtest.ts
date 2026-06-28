// Local playtest with shareable links (change: playtest-shareable-links). Pure
// helpers shared by the client firebase config, the reverse proxy, and the
// link-printing script. No Firestore, no DOM.

/** Emulator ports behind the single-origin reverse proxy. */
export const EMULATOR_PORTS = {
  firestore: 8080,
  auth: 9099,
  functions: 5001,
  storage: 9199,
  creatorWeb: 5180,
  playWeb: 5181,
} as const;

type EnvLike = Record<string, unknown> | undefined | null;

/**
 * The Firebase emulator host a client should connect to. An explicit
 * `VITE_EMULATOR_HOST` wins; otherwise in playtest mode (`VITE_PLAYTEST`) the
 * page origin's hostname is used so remote devices reach the backend through the
 * tunnel; otherwise the local default `127.0.0.1` (normal `dev:all` unchanged).
 */
export function resolveEmulatorHost(env: EnvLike, origin?: string | null): string {
  const explicit = env?.['VITE_EMULATOR_HOST'];
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();

  let originHost = '';
  if (origin) { try { originHost = new URL(origin).hostname; } catch { originHost = ''; } }

  const pt = env?.['VITE_PLAYTEST'];
  const playtestFlag = pt === '1' || pt === 'true' || pt === true;
  const isLocal = !originHost || originHost === 'localhost' || originHost === '127.0.0.1';

  // Use the page origin's host when explicitly in playtest, OR whenever the page
  // is served from a remote origin (a tunnel) — so no env flag is required.
  if (originHost && (playtestFlag || !isLocal)) return originHost;
  return '127.0.0.1';
}

/**
 * Route a request path under the single proxy origin to the right local port:
 * the emulator services by their SDK path signatures, `/creator*` to creator-web,
 * everything else to play-web.
 */
export function resolveProxyTarget(path: string): number {
  const p = String(path);
  if (p.includes('/google.firestore') || p.includes('/firestore')) return EMULATOR_PORTS.firestore;
  if (p.includes('/identitytoolkit') || p.includes('/securetoken') || p.includes('/emulator/') || p.includes('/accounts:')) return EMULATOR_PORTS.auth;
  if (p.includes('/rushpoint-pwa-7daaa/') || p.includes('cloudfunctions') || p.includes('/functions')) return EMULATOR_PORTS.functions;
  if (p.includes('/v0/b/') || p.includes('/storage')) return EMULATOR_PORTS.storage;
  if (p === '/creator' || p.startsWith('/creator/') || p.startsWith('/creator?')) return EMULATOR_PORTS.creatorWeb;
  return EMULATOR_PORTS.playWeb;
}

export interface PlaytestLinks { creatorUrl: string; joinUrl: string; }

/**
 * Build the two shareable links from the public base URL (e.g. the tunnel URL):
 * the creator console (`/creator`) and the participant join link
 * (`/?code=<accessCode>`, or just the base play URL when no code is known yet).
 */
export function buildPlaytestLinks(baseUrl: string, accessCode?: string | null): PlaytestLinks {
  const base = String(baseUrl).replace(/\/+$/, '');
  return {
    creatorUrl: `${base}/creator`,
    joinUrl: accessCode ? `${base}/?code=${encodeURIComponent(accessCode)}` : base,
  };
}
