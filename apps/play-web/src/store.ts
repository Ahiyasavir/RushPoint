import {
  chatSeenStorageKey, parseChatSeen, serializeChatSeen, type ChatSeenMarker,
} from '@rushpoint/shared';

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

// ── Team ↔ HQ chat: last-seen marker (change: team-chat-unread-accuracy) ──
// Unread stays purely client-local, but the marker is now the ID of the last
// message this device saw (see countUnreadChatMessages) rather than a bare
// count — a count is meaningless once the 100-message cap starts evicting, and
// it can't tell the viewer's own lines apart from everyone else's. Keyed per
// run+team via the shared key builder so HQ and participant surfaces agree.
// Legacy bare-number values still parse, so an upgrade doesn't re-flag a thread.
export function loadChatSeen(runId: string, teamId: string): ChatSeenMarker {
  try {
    return parseChatSeen(localStorage.getItem(chatSeenStorageKey(runId, teamId)));
  } catch {
    return {};   // storage blocked ⇒ "nothing seen" ⇒ badge shows; the safe direction
  }
}

export function saveChatSeen(runId: string, teamId: string, marker: ChatSeenMarker) {
  try {
    localStorage.setItem(chatSeenStorageKey(runId, teamId), serializeChatSeen(marker));
  } catch { /* best-effort */ }
}
