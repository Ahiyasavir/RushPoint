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
  senderName: string;         // team.displayName | staff/owner display name
  text: string;               // sanitized, 1..MAX_MESSAGE_LEN
  at: string;                 // ISO timestamp (server clock)
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
 */
export function appendCapped(messages: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  return [...messages, msg].slice(-CHAT_MAX_MESSAGES);
}
