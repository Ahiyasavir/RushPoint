// ═══════════════════════════════════════════════════════════════════════════════
// Team ↔ HQ chat — pure message helpers (change: team-hq-chat).
//
// One chat doc per team at users/{ownerUid}/games/{gameId}/runs/{runId}/chat/{teamId}
// holds the whole thread. These pure helpers are the shared trust boundary: the
// server (sendTeamChatMessage) sanitizes text and caps the array with them; the
// unit lane (scripts/test-chat.ts) exercises them without an emulator. No Firebase
// imports here — the doc is server-write-only, clients only read.
// ═══════════════════════════════════════════════════════════════════════════════

import { MAX_MESSAGE_LEN } from './validation';

/** The whole thread is rewritten on every send, capped to the most recent N. */
export const CHAT_MAX_MESSAGES = 100;
/** Alias for CHAT_MAX_MESSAGES (spec name CHAT_HISTORY_CAP). */
export const CHAT_HISTORY_CAP = CHAT_MAX_MESSAGES;
/** Max length of a single chat message (mirrors MAX_MESSAGE_LEN). */
export const CHAT_TEXT_MAX_LEN = MAX_MESSAGE_LEN;

/** A single chat line. `from` is set by the SERVER (never trusted from a client);
 *  the label is display-only — authz is the claims check, never the name. */
export interface ChatMessage {
  id: string;                 // server-minted (db.collection('_').doc().id)
  from: 'team' | 'hq';
  senderId?: string;          // caller uid (server-set); lets a client tell its OWN
                              //   lines apart from others' regardless of `from` —
                              //   e.g. an owner who plays their own game is stamped
                              //   from:'hq' yet must still read as themselves.
                              //   Optional so legacy messages (pre-field) still render.
  senderName: string;         // team.displayName | staff/owner display name
  text: string;               // sanitized, 1..MAX_MESSAGE_LEN
  at: string;                 // ISO timestamp (server clock)
}

/** Which visual side a chat line belongs to, from the viewer's perspective:
 *  'me' = the viewer authored it, 'hq' = the HQ/staff side, 'other' = another
 *  participant (e.g. a teammate on a shared device). */
export type ChatSide = 'me' | 'hq' | 'other';

/**
 * Pure sender-attribution decision (the display trust boundary, unit-tested without
 * a client). A message is 'me' whenever its server-stamped `senderId` matches the
 * viewer's uid — this WINS over `from`, so an owner who plays their own game (server
 * stamps their line from:'hq' because uid === ownerUid) still reads as themselves
 * instead of every one of their own messages showing as "HQ". Legacy messages with
 * no `senderId` fall back to the `from` flag.
 */
export function chatMessageSide(
  msg: { senderId?: string; from: 'team' | 'hq' },
  myUid: string | null | undefined,
): ChatSide {
  if (myUid && msg.senderId === myUid) return 'me';
  return msg.from === 'hq' ? 'hq' : 'other';
}

// ─────────────────────────────────────────────────────────────────────────────
// Staff ↔ admin channel (change: staff-console-field-ops)
//
// ONE shared thread per RUN between the field marshals and the run's owner —
// distinct from the per-team threads above, and never readable by participants.
//
// WHY A PARALLEL TYPE INSTEAD OF WIDENING ChatMessage['from']
// `chatMessageSide` and every one of its call sites are typed against exactly
// 'team' | 'hq'. Widening that union would force each of them to newly handle two
// values that can never occur there — a silent-footgun risk across the whole chat
// surface for zero benefit. One small duplicated interface is the cheaper trade,
// and the same one this codebase already makes for lazyWithRetry (behaviourally
// matched, deliberately duplicated rather than shared).
//
// The BEHAVIOUR is genuinely shared: sanitizeChatText, appendCapped and the whole
// seen-marker family below operate on these messages unchanged, so the cap, the
// text trust boundary and the unread rule cannot drift between the two channels.
// ─────────────────────────────────────────────────────────────────────────────

/** One line in the run's staff↔admin thread. `from` is set by the SERVER from the
 *  caller's identity (uid === ownerUid ⇒ 'admin'), never trusted from a client. */
export interface StaffChannelMessage {
  id: string;
  from: 'staff' | 'admin';
  senderId?: string;   // caller uid (server-set) — see staffChannelMessageSide
  senderName: string;  // staffName token claim, or the owner's display name
  text: string;        // sanitized, 1..MAX_MESSAGE_LEN
  at: string;          // ISO timestamp (server clock)
}

/** Viewer-relative side of a staff-channel line. 'admin' is the organizer's side. */
export type StaffChannelSide = 'me' | 'admin' | 'other';

/** One thread doc per RUN (singleton). Server-write-only. */
export interface StaffChannelDoc {
  runId: string;
  messages: StaffChannelMessage[];  // append order; capped at CHAT_MAX_MESSAGES
  updatedAt: string;
}

/**
 * Pure sender-attribution for the staff channel — the exact rule `chatMessageSide`
 * uses, with the two role strings swapped.
 *
 * The server-stamped `senderId` WINS over `from` for the same reason it does in team
 * chat: an owner may also hold a staff PIN (and a marshal may be the owner), so
 * labelling purely by role would show a viewer their own instructions as if someone
 * else had written them. Legacy/defensive messages with no `senderId` fall back to
 * `from` and can never be claimed as the viewer's own.
 */
export function staffChannelMessageSide(
  msg: { senderId?: string; from: 'staff' | 'admin' },
  myUid: string | null | undefined,
): StaffChannelSide {
  if (myUid && msg.senderId === myUid) return 'me';
  return msg.from === 'admin' ? 'admin' : 'other';
}

/** Seen-marker storage namespace for the staff channel. RUN-scoped with no team
 *  component — there is exactly one thread per run — so two runs open on the same
 *  device cannot clobber each other's unread state. */
export function staffChannelSeenStorageKey(runId: string): string {
  return `rushpoint.staffChannelSeen.${runId}`;
}

/** One thread doc per team. `deviceUids` is MIRRORED from the team doc on every
 *  server write so firestore.rules can reuse isAttachedDevice() verbatim (a free
 *  resource.data check, no rules get()). */
export interface TeamChatDoc {
  teamId: string;
  deviceUids?: string[];
  messages: ChatMessage[];    // append order == chronological; capped at CHAT_MAX_MESSAGES
  updatedAt: string;
}

/**
 * Trim; strip ASCII control characters (newline kept, tab normalized to a space);
 * return null when the value is not a string, is empty after trim, or exceeds
 * MAX_MESSAGE_LEN after trim. The caller maps null → invalid-argument.
 */
export function sanitizeChatText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/\t/g, ' ')                      // tab → space (keep on one visual line)
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '') // strip control chars, KEEP \n (\x0A)
    .trim();
  if (!cleaned) return null;
  if (cleaned.length > MAX_MESSAGE_LEN) return null;
  return cleaned;
}

/**
 * Pure append-and-cap: returns a NEW array of the most recent CHAT_MAX_MESSAGES
 * (append then slice(-N)). Never mutates its input.
 *
 * Generic over the message shape so the staff↔admin channel
 * (`StaffChannelMessage`) shares this exact cap rather than re-deriving it — the
 * two channels must not be able to drift on how much history a doc retains.
 */
export function appendCapped<T>(messages: readonly T[], msg: T): T[] {
  return [...messages, msg].slice(-CHAT_MAX_MESSAGES);
}

// ─────────────────────────────────────────────────────────────────────────────
// Unread bookkeeping (change: team-chat-unread-accuracy)
//
// Unread stays purely client-local (no server read state), but the DECISION is
// shared so the participant section, the staff console and the creator run
// console can never drift apart — they all used to re-implement
// `messages.length > seenCount`, which is wrong three ways:
//   1. a count says nothing about WHO wrote the new lines, so a viewer's own
//      message counted as unread the moment the marker fell out of step;
//   2. a count is meaningless once appendCapped starts evicting — past the cap
//      `messages.length` is pinned at CHAT_MAX_MESSAGES forever, so a stored
//      count of 100 can never be exceeded and the badge silently dies;
//   3. HQ never persisted the count at all, so a reload re-flagged every thread.
//
// The marker therefore anchors on the last-seen message ID. Timestamps are
// deliberately NOT used: `at` is a server-clock string that can tie (two sends
// in the same millisecond) or move backwards (transaction retry, clock
// adjustment), so a `>`/`>=` comparison would double-count or swallow a message
// at the boundary. The array is already in append order, so an ID anchor gives
// an exact cut with no comparison at all.
// ─────────────────────────────────────────────────────────────────────────────

/** What a viewer has already read in one thread. `count` is only the legacy
 *  (pre-upgrade) fallback for devices that stored a bare message count. */
export interface ChatSeenMarker {
  lastSeenId?: string | null;
  count?: number | null;
}

/** The minimum a message must expose for the unread rule to work. Both
 *  `ChatMessage` and `StaffChannelMessage` satisfy it structurally, so the two
 *  channels share one unread implementation. */
interface SeenTrackableMessage {
  id: string;
  senderId?: string;
}

/** The marker to persist once `messages` has been shown to the viewer. */
export function chatSeenMarker(
  messages: readonly SeenTrackableMessage[] | null | undefined,
): ChatSeenMarker {
  const list = Array.isArray(messages) ? messages : [];
  const last = list[list.length - 1];
  return { lastSeenId: last?.id ?? null, count: list.length };
}

/** True when `msg` was written by this viewer. Mirrors chatMessageSide's rule:
 *  the server-stamped `senderId` wins over `from` (an owner playing their own
 *  game is stamped from:'hq' yet must still read as themselves). */
function isOwnChatMessage(msg: SeenTrackableMessage, selfUid: string | null | undefined): boolean {
  return !!selfUid && msg.senderId === selfUid;
}

/**
 * How many messages in `messages` this viewer has not read yet: everything after
 * the marker's anchor, minus the viewer's own lines.
 *
 * - no anchor (fresh join, or a legacy count-only marker) → fall back to `count`,
 *   clamped into range; absent ⇒ 0 ⇒ the whole thread is unread.
 * - anchor present but NOT found in `messages` → the cap has evicted it, and
 *   appendCapped only ever drops from the front, so every retained message is
 *   newer than the anchor: cut at 0.
 */
export function countUnreadChatMessages(
  messages: readonly SeenTrackableMessage[] | null | undefined,
  marker: ChatSeenMarker | null | undefined,
  selfUid: string | null | undefined,
): number {
  if (!Array.isArray(messages) || messages.length === 0) return 0;

  const anchor = marker?.lastSeenId;
  let cut: number;
  if (typeof anchor === 'string' && anchor) {
    const idx = messages.findIndex((m) => m?.id === anchor);
    cut = idx >= 0 ? idx + 1 : 0;         // evicted anchor ⇒ everything is newer
  } else {
    const count = marker?.count;
    cut = typeof count === 'number' && Number.isFinite(count)
      ? Math.min(Math.max(Math.floor(count), 0), messages.length)
      : 0;
  }

  let unread = 0;
  for (let i = cut; i < messages.length; i++) {
    if (!isOwnChatMessage(messages[i], selfUid)) unread++;
  }
  return unread;
}

/** Serialize a marker for device-local storage. */
export function serializeChatSeen(marker: ChatSeenMarker): string {
  return JSON.stringify({ lastSeenId: marker.lastSeenId ?? null, count: marker.count ?? 0 });
}

/**
 * Parse a stored marker. Tolerates (a) a bare number — the legacy format written
 * by the first team-hq-chat release, so upgrading does not light up an
 * already-read thread — and (b) any garbage, which degrades to "nothing seen"
 * (the safe direction: a spurious badge beats a silently missed message).
 */
export function parseChatSeen(raw: string | null | undefined): ChatSeenMarker {
  if (typeof raw !== 'string' || !raw) return {};
  const legacy = Number.parseInt(raw, 10);
  if (raw.trim() === String(legacy) && Number.isFinite(legacy) && legacy >= 0) return { count: legacy };
  try {
    const parsed = JSON.parse(raw) as { lastSeenId?: unknown; count?: unknown };
    if (!parsed || typeof parsed !== 'object') return {};
    const out: ChatSeenMarker = {};
    if (typeof parsed.lastSeenId === 'string' && parsed.lastSeenId) out.lastSeenId = parsed.lastSeenId;
    if (typeof parsed.count === 'number' && Number.isFinite(parsed.count) && parsed.count >= 0) {
      out.count = Math.floor(parsed.count);
    }
    return out;
  } catch {
    return {};
  }
}

/** One storage namespace for every surface, scoped per run + team so several
 *  runs / teams on one device cannot clobber each other. */
export function chatSeenStorageKey(runId: string, teamId: string): string {
  return `rushpoint.chatSeen.${runId}.${teamId}`;
}
