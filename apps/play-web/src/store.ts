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

// ── Language preference (change: play-web-i18n-hebrew) — Hebrew by default ────
export type Lang = 'he' | 'en';
const LANG_KEY = 'rushpoint.lang';

export function loadLang(): Lang {
  try {
    const raw = localStorage.getItem(LANG_KEY);
    return raw === 'en' ? 'en' : 'he';
  } catch {
    return 'he';
  }
}

export function saveLang(lang: Lang) {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
}

// ── Staff session: which run a staff member signed in to (custom-token auth) ──
export interface StaffSession {
  ownerUid: string;
  gameId: string;
  runId: string;
  name: string;
  permissions: string[];
}

const STAFF_KEY = 'rushpoint.staff';

export function loadStaffSession(): StaffSession | null {
  try {
    const raw = localStorage.getItem(STAFF_KEY);
    return raw ? (JSON.parse(raw) as StaffSession) : null;
  } catch {
    return null;
  }
}

export function saveStaffSession(s: StaffSession) {
  localStorage.setItem(STAFF_KEY, JSON.stringify(s));
}

export function clearStaffSession() {
  localStorage.removeItem(STAFF_KEY);
}
