// Lightweight session persistence: which run this device joined.
export interface Session {
  ownerUid: string;
  gameId: string;
  runId: string;
  code: string;
  displayName: string;
  // Shared team devices: the team this phone belongs to. Absent on sessions
  // saved before the feature — those are founding devices, so teamId == uid.
  teamId?: string;
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
  // Guard setItem (Safari private mode / quota-exceeded throws) — a persistence
  // failure must NOT bubble into the join flow and block a participant who has
  // already joined server-side. Matches saveLang's defensive handling.
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* session is best-effort */ }
}

export function clearSession() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
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
  try { localStorage.setItem(STAFF_KEY, JSON.stringify(s)); } catch { /* best-effort */ }
}

export function clearStaffSession() {
  try { localStorage.removeItem(STAFF_KEY); } catch { /* ignore */ }
}
