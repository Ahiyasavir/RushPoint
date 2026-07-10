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
  // Test-drive (rehearsal) run flag (change: test-drive-mode): drives the
  // persistent "TEST RUN" banner. Absent on normal runs → treated as false.
  isTestDrive?: boolean;
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

// Colorblind / high-contrast preference (change: accessibility-colorblind). When on,
// status indicators add a non-color cue (shape/icon/number) so meaning survives without
// color. Persisted like the language preference; defaults off.
const COLORBLIND_KEY = 'rushpoint.colorblind';

export function loadColorblind(): boolean {
  try { return localStorage.getItem(COLORBLIND_KEY) === '1'; } catch { return false; }
}

export function saveColorblind(on: boolean) {
  try { localStorage.setItem(COLORBLIND_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}

// Sound / haptic feedback preference (change: audio-haptic-feedback). One toggle
// governs both the synthesized cue sounds and their paired vibration. Persisted
// like the language / colorblind preferences; defaults ON.
const SOUND_KEY = 'rushpoint.sound';

export function loadSound(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== '0'; } catch { return true; }
}

export function saveSound(on: boolean) {
  try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch { /* ignore */ }
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

// ── Team ↔ HQ chat: last-seen message count (change: team-hq-chat) ──
// Unread is a purely client-local comparison: messages.length vs the count last
// seen when this device opened the chat panel. Keyed per run+team so multiple
// runs / teams on one device don't clobber each other. Best-effort like the rest.
const CHAT_SEEN_PREFIX = 'rushpoint.chatSeen.';

export function loadChatSeen(runId: string, teamId: string): number {
  try {
    const raw = localStorage.getItem(`${CHAT_SEEN_PREFIX}${runId}.${teamId}`);
    const n = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveChatSeen(runId: string, teamId: string, n: number) {
  try { localStorage.setItem(`${CHAT_SEEN_PREFIX}${runId}.${teamId}`, String(n)); } catch { /* best-effort */ }
}
