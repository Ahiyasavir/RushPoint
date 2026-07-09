## Why

Communication in a live run is one-way or emergency-only: `pushAnnouncement`
broadcasts HQ→participants (now targetable per team, but teams cannot reply), and
`triggerSOS` raises an alert with a single message field. There is no channel for
"we're stuck at the bridge, is the code box damaged?" ↔ "yes, use 4712" — the kind
of low-stakes back-and-forth every real event needs. Competitor apps ship in-game
chat; RushPoint can add it with zero paid deps: one server-written doc per team,
one new callable, realtime via a single-doc `onSnapshot`.

## What Changes

- **One chat doc per team** at
  `users/{ownerUid}/games/{gameId}/runs/{runId}/chat/{teamId}` holding
  `{ teamId, deviceUids, messages: ChatMessage[], updatedAt }` where
  `ChatMessage = { id, from: 'team' | 'hq', senderName, text, at }`.
  The array is server-capped at the most recent **100** messages and always
  rewritten whole (repo footgun: never dotted-update an array element).
- **One new callable** `sendTeamChatMessage({ ownerUid, gameId, runId, teamId?, text, senderName? })`
  in `functions/src/index.ts` (root domain, beside `pushAnnouncement`):
  - Participants resolve their team via `resolveCallerTeam` — **any attached
    device may chat, not just the controller** (same rationale as `triggerSOS`:
    communication beats role discipline; a viewer phone held by the kid at the
    back of the group is exactly who needs to ask HQ something. The message is
    attributed to the team, so controller exclusivity buys nothing).
  - Staff (run-scoped custom claims) and the owner pass an explicit `teamId`
    (verified to exist, mirroring targeted `pushAnnouncement`) and send as
    `from: 'hq'` with their display name.
  - Validation: trimmed text 1..500 chars (`MAX_MESSAGE_LEN`), control chars
    stripped; rate-limited **10 msgs/min per sender uid** via the existing shared
    fixed-window limiter (`RATE_LIMITS` + `enforceRateLimit`); rejected on a
    `finished` run (`failed-precondition`, same as `joinTeamAsDevice`).
- **firestore.rules**: `chat/{teamId}` readable by the team founder
  (`isOwner(teamId)`), any attached device (`isAttachedDevice()` — the server
  mirrors the team's `deviceUids` onto the chat doc so the existing
  `resource.data.deviceUids` pattern works verbatim), run-scoped staff
  (`isStaffForRun`), and the owner. **All client writes denied.**
- **play-web**: `ChatPanel.tsx` — chat button on `PlayScreen` with an unread dot
  (message count vs a locally stored last-seen count in `store.ts`), single-doc
  `onSnapshot`, send box.
- **StaffConsole + creator RunConsolePage**: per-team thread list with unread
  indicators + reply box (collection `onSnapshot` — staff/owner rules grant it).
- i18n EN+HE for every string; `npm run i18n:check` clean.

## Capabilities

### New Capabilities
- `team-hq-chat`: pure message helpers in `packages/shared/src/chat.ts`
  (`sanitizeChatText`, `appendCapped` — vitest RED-first); the
  `sendTeamChatMessage` callable; chat-doc read rules; play-web `ChatPanel`;
  staff/creator thread consoles; e2e scenario + authz-matrix rows + rules-test
  cases.

## Non-goals

- No team↔team chat (HQ is always one side of the thread).
- No attachments, media, or emoji reactions — text only.
- No push notifications; delivery is the existing realtime `onSnapshot` while the
  app is open.
- No message deletion / moderation UI in v1 — HQ sees every thread, which IS the
  moderation; abusive teams get the existing live-ops tools.
- No typing indicators or read receipts.
- No unread persistence server-side — unread is a client-local count comparison.

## Surfaces touched

- **shared:** `packages/shared/src/chat.ts` (`ChatMessage`, `TeamChatDoc`,
  `sanitizeChatText`, `appendCapped`, `CHAT_MAX_MESSAGES = 100`); export from
  `index.ts`; `FIRESTORE_PATHS.runChat` / `runChatCol`;
  `rateLimit.ts` `RATE_LIMITS.sendTeamChatMessage`.
- **functions:** `sendTeamChatMessage` in `functions/src/index.ts` +
  re-export check (root domain exports directly).
- **firestore.rules:** new `chat/{teamId}` match block under runs.
- **play-web:** `components/ChatPanel.tsx` (new), `PlayScreen.tsx` entry button +
  unread dot, `store.ts` last-seen helpers, `services/calls.ts` wrapper,
  `i18n.ts` EN+HE; StaffConsole thread list + reply.
- **creator-web:** `RunConsolePage.tsx` thread list + reply,
  `services/calls.ts` wrapper, `i18n.ts` EN+HE.
- **Tests:** `scripts/test-chat.ts` (pure lane, RED first); new `team ↔ HQ chat`
  e2e scenario in `scripts/e2e-verify.mjs` (**mandatory** — the callable coverage
  guard goes 66→67 and ships RED without it) + authz-denial-matrix rows;
  chat read/write cases in `scripts/test-rules.mjs`.
