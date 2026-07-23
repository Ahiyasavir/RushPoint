## Why

The team ↔ HQ chat (change: `team-hq-chat`) tracks "unread" with a **message
count** compared against a per-thread last-seen count. Three defects fall out of
that model, and one of them is the recorded bug:

1. **HQ-side unread is not persisted (the reported "over-reports after a page
   reload").** In `apps/creator-web/src/pages/RunConsolePage.tsx` the seen map is
   `useState<Record<string, number>>({})`, and in `apps/play-web/src/screens/
   StaffConsole.tsx` (`StaffChatSection`) it is `useState<Record<string, number>>({})`
   too. Neither ever reaches storage. Reloading the console — or merely
   unmounting/remounting the page — resets the map to `{}`, so **every thread that
   holds at least one message re-flags as unread**, including threads HQ has read
   and threads whose only messages are HQ's own replies. The folded
   moderation-group badge then reports that inflated number. Confirmed by reading
   the code: nothing writes those maps to `localStorage`, and nothing seeds them
   on mount. (The participant side in `apps/play-web/src/store.ts`
   `loadChatSeen`/`saveChatSeen` *does* persist, so the reload defect is
   HQ-console-only.)
2. **Unread is identity-blind.** The comparison is `messages.length > seen`, so a
   viewer's **own** message counts as unread the moment the seen marker is not
   perfectly in step (exactly what a reload produces). HQ replies to a team and,
   after a reload, that team's thread is "unread" because of HQ's own reply.
3. **A count marker is meaningless once the thread hits the cap.** `appendCapped`
   holds the newest `CHAT_MAX_MESSAGES` (100) and drops the oldest, so past 100
   `messages.length` is pinned at 100 forever. A stored seen count of 100 means
   new messages can **never** raise the count again — the badge silently stops
   working (an under-report, the mirror of defect 1).

## What Changes

- **The unread decision becomes one pure, shared function.** New
  `countUnreadChatMessages(messages, marker, selfUid)` in
  `packages/shared/src/chat.ts`, alongside a `ChatSeenMarker` value and its
  storage (de)serializer. Unread is defined as *the messages that come after the
  last message this viewer saw, excluding the ones this viewer wrote*.
- **The marker anchors on the last-seen message id, not a count.** A count cannot
  survive cap eviction; an id can — and when the anchor id is no longer in the
  retained window, every retained message is by definition newer than it, so the
  correct answer is "all of them". Timestamps are deliberately **not** used:
  `at` is a server clock string that can tie or go backwards, and ordering is
  already carried by the array (server append order).
- **Both HQ consoles persist their seen markers** under a shared key builder
  (`chatSeenStorageKey(runId, teamId)`), so a reload restores what was read.
- **All three surfaces (participant `ChatSection`, play-web `StaffChatSection`,
  creator `ChatConsole`) call the one shared function** instead of each
  re-implementing `length > seen`.
- **Legacy markers migrate silently**: an existing `localStorage` value that is a
  bare number is read as a count marker, so participants who already have
  `rushpoint.chatSeen.*` numbers do not see their whole thread light up once.

## Capabilities

### New Capabilities
- `team-chat-unread`: an exact, viewer-relative unread count for a chat thread
  that survives a page reload, never counts the viewer's own messages, is stable
  under the 100-message history cap, and does not depend on message timestamps.

## Non-goals

- **No server-side read state.** Unread stays client-local (the `team-hq-chat`
  non-goal stands); no new callable, no new Firestore field, no rules change.
- **No cross-device read sync.** Two devices on one team each keep their own
  marker — a message read on the phone stays unread on the tablet. That is the
  intended shared-team-devices semantic (each device is a separate reader).
- **No per-message read receipts**, no "mark all as read" affordance, no unread
  count badges beyond the existing ones (the participant side keeps a dot, HQ
  keeps a thread count).
- **No change to `sendTeamChatMessage`**, `appendCapped`, `sanitizeChatText`, or
  `chatMessageSide`.

## Surfaces touched

- **shared:** `packages/shared/src/chat.ts` — `ChatSeenMarker`,
  `chatSeenMarker()`, `countUnreadChatMessages()`, `parseChatSeen()`,
  `serializeChatSeen()`, `chatSeenStorageKey()`; re-export via
  `packages/shared/src/index.ts` (the file is already exported wholesale).
- **play-web:** `src/store.ts` (`loadChatSeen`/`saveChatSeen` now marker-based),
  `src/screens/PlayScreen.tsx` (`ChatSection`), `src/components/ChatPanel.tsx`,
  `src/screens/StaffConsole.tsx` (`StaffChatSection` — now persisted).
- **creator-web:** `src/pages/RunConsolePage.tsx` (page-level `chatSeen` map now
  persisted + identity-aware; `ChatConsole` uses the shared function).
- **No callable, no rules, no index, no env var.** The chat doc shape is
  unchanged, so `scripts/e2e-verify.mjs` needs no new assertions — the callable
  under test is untouched and the callable-coverage guard stays at its current
  count.
- **Tests:** `scripts/test-chat.ts` (existing pure-lane script) gains the unread
  suite.
