// Lightweight session persistence: which run this device joined.
export interface Session {
  ownerUid: string;
  gameId: string;
  runId: string;
  code: string;
  displayName: string;
}

const KEY = 'rushpoint.session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSession() {
  localStorage.removeItem(KEY);
}
