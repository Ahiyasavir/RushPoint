# Design — team-hq-chat

## Data model

**One doc per team** — `users/{ownerUid}/games/{gameId}/runs/{runId}/chat/{teamId}`
(add `FIRESTORE_PATHS.runChat(ownerUid, gameId, runId, teamId)` +
`runChatCol(ownerUid, gameId, runId)` beside `runAnnouncement`; never hardcode).

```ts
// packages/shared/src/chat.ts
export const CHAT_MAX_MESSAGES = 100;

export interface ChatMessage {
  id: string;                 // server-minted (db.collection('_').doc().id)
  from: 'team' | 'hq';
  senderName: string;         // team.displayName | staff/owner display name
  text: string;               // sanitized, 1..500
  at: string;                 // ISO timestamp (server clock)
}

export interface TeamChatDoc {
  teamId: string;
  deviceUids?: string[];      // MIRRORED from the team doc on every server write —
                              // lets rules reuse isAttachedDevice() verbatim (free,
                              // resource.data check, no rules get())
  messages: ChatMessage[];    // append order == chronological; capped at 100
  updatedAt: string;
}
```

Whole-doc `tx.set` on every send — the `messages` array is ALWAYS rewritten as a
complete array inside a real nested object (repo footgun: dotted array-element
updates coerce the array to a map; `.set({merge})` with dotted keys writes literal
"a.b" fields). One doc per team keeps realtime cheap: each participant snapshots
exactly 1 doc; HQ snapshots one small collection.

## Pure helpers (packages/shared/src/chat.ts) — TDD RED first

```ts
// Trim; strip ASCII control characters (regex /[\x00-\x08\x0B-\x1F\x7F]/g
// — newline kept, tab normalized to space); return null when non-string, empty
// after trim, or > MAX_MESSAGE_LEN (500) after trim — caller maps null to invalid-argument.
export function sanitizeChatText(raw: unknown): string | null;

// Pure append-and-cap: returns a NEW array of the most recent CHAT_MAX_MESSAGES
// (slice(-100) after push). Never mutates its input.
export function appendCapped(messages: ChatMessage[], msg: ChatMessage): ChatMessage[];
```

Test lane: `scripts/test-chat.ts` (tsx assertion script, picked up by `npm test`
via the aggregator — same shape as `scripts/test-gating.ts`): sanitize
(trim / control-strip / empty→null / 501-chars→null / exactly-500 ok / non-string→null),
cap (100+1 drops the OLDEST, order preserved, input not mutated, append at <100
grows by one).

## Callable — sendTeamChatMessage (functions/src/index.ts, root domain)

Placed beside `pushAnnouncement`; exported directly from the root file (root-domain
callables need no re-export step). Signature:
`{ ownerUid, gameId, runId, teamId?, text, senderName? }`.

1. `requireAuth(context)`; `await enforceRateLimit(uid, 'sendTeamChatMessage')`
   (new `RATE_LIMITS.sendTeamChatMessage: { max: 10, windowMs: MIN }` in
   `packages/shared/src/rateLimit.ts` — keyed per sender uid, so one spamming
   device can't starve teammates or HQ).
2. `const text = sanitizeChatText(data.text)`; `null` ⇒ `invalid-argument`.
3. **Resolve sender role** (mirror of the existing split):
   - **HQ path** — caller is the owner, platform admin, or run-scoped staff:
     detect via a non-throwing probe (`uid === ownerUid || token.admin ||
     (token.staff && token.ownerUid === ownerUid && token.runId === runId)`), then
     `assertStaffOrOwner(context, ownerUid, runId)` to enforce. Requires an
     explicit `teamId`; validate + verify the team doc exists (`not-found`
     otherwise — exact pattern of targeted `pushAnnouncement`). `from: 'hq'`,
     `senderName` = validated optional `data.senderName` (≤ 64 chars; staff
     consoles pass the staff invite name / owner display name) falling back to
     `'HQ'`. The label is display-only — authz is the claims check, never the name.
   - **Participant path** — everyone else:
     `const { teamId, team } = await resolveCallerTeam(uid, { ownerUid, gameId, runId })`
     — **no `requireController`**. Decision: any attached device may chat, exactly
     like `triggerSOS` ("safety beats role discipline") — chat is the pre-SOS
     valve, messages are attributed to the team not the phone, and gating on the
     controller would silence the very devices most likely to need HQ. A supplied
     `data.teamId` is ignored on this path (server-resolved identity only — same
     stance as `completeTask` ignoring payload teamId). `from: 'team'`,
     `senderName = team.displayName`.
4. **Run gate**: read the run doc; `status === 'finished'` ⇒ `failed-precondition`
   ("This race has already finished." — wording of `joinTeamAsDevice`).
5. **Append in a transaction** (two teammates or team+HQ sending concurrently must
   not lose messages):
   ```ts
   const chatRef = db.doc(FIRESTORE_PATHS.runChat(ownerUid, gameId, runId, teamId));
   await db.runTransaction(async (tx) => {
     const snap = await tx.get(chatRef);
     const prev = (snap.data() as TeamChatDoc | undefined)?.messages ?? [];
     const msg: ChatMessage = { id: db.collection('_').doc().id, from, senderName, text, at: new Date().toISOString() };
     tx.set(chatRef, {
       teamId,
       deviceUids: team?.deviceUids ?? [],   // HQ path: preserve snap's existing mirror
       messages: appendCapped(prev, msg),
       updatedAt: msg.at,
     });
   });
   return { messageId };
   ```
   Whole-doc set (not merge) — the doc IS the thread; nothing else lives there.
   On the HQ path (`team` not fetched) keep the previously mirrored `deviceUids`
   from `snap`, defaulting `[]` on first write.

No writes to the team doc, no touch of scoring, no new indexes (single-doc get +
collection listen only).

## firestore.rules

New block under `match /runs/{runId}`, copying the `teams/{teamId}` clause list
one-for-one (the doc mirrors `deviceUids` precisely so `isAttachedDevice()` — a
free `resource.data` check — carries over):

```
// ── TEAM ↔ HQ CHAT (team-hq-chat) ──────────────────────────────────
//    One thread doc per team. Same read surface as the team doc itself:
//    founder, attached devices, run-scoped staff, owner. deviceUids is
//    mirrored onto this doc by sendTeamChatMessage so isAttachedDevice()
//    works without a rules get(). All writes are CF-only.
match /chat/{teamId} {
  allow read:  if isOwner(uid) || isOwner(teamId)
                || isAttachedDevice()
                || isStaffForRun(uid, gameId, runId);
  allow write: if false;
}
```

List semantics fall out for free: the staff/owner clauses hold for every doc in
the collection, so the HQ consoles' collection `onSnapshot` is permitted; a
participant's clauses depend on doc id / `resource.data`, so participants can only
`get`/listen to their own doc — which is all `ChatPanel` does.

## Client wrappers

`sendTeamChatMessage` typed wrapper in BOTH `apps/play-web/src/services/calls.ts`
and `apps/creator-web/src/services/calls.ts` (standard `callable<Req, Res>` shape).

## UI

- **play-web `ChatPanel.tsx`** (new component, modeled on `FeedPanel.tsx`):
  floating chat button on `PlayScreen` with an **unread dot** when
  `messages.length > lastSeenCount`; `lastSeenCount` persisted via new `store.ts`
  helpers `loadChatSeen(runId, teamId)` / `saveChatSeen(runId, teamId, n)`
  (localStorage, best-effort try/catch like `loadStaffSession`). Panel:
  single-doc `onSnapshot` on `chat/{session.teamId}`, message list (`dir="auto"`
  on message text — user content renders RTL correctly), send box (Enter sends;
  disabled while in-flight; 500-char maxLength), team bubbles end-aligned / HQ
  start-aligned with static Tailwind classes + logical (`ms-`/`text-start`)
  spacing. Opening the panel saves the seen count.
- **StaffConsole (play-web)**: a "Chat" section beside the announcement composer —
  collection `onSnapshot` on `chat`, thread rows (team name from the already-
  subscribed `teams` state + last message preview + unread badge via a per-thread
  local seen map), tap to expand thread + reply box
  (`sendTeamChatMessage({ ...ctx, teamId, senderName: staff.name, text })`).
- **creator RunConsolePage**: same thread-list pattern as a console card
  (RunConsole already holds run-scoped `onSnapshot`s + team rows from
  `listRunTeams`); reply as `senderName: 'HQ'` (or the creator's display name).
- **i18n**: all new strings through `t.*` in both apps' `i18n.ts`, EN + HE (keys:
  `chatTitle`, `chatSend`, `chatPlaceholder`, `chatEmpty`, `chatUnread`,
  `chatHq`, `chatOpen`, `chatFinishedNotice`…). Zero new PART B warnings —
  verify with `npm run i18n:check:strict`.

## Test strategy

- **Pure (RED→GREEN):** `scripts/test-chat.ts` as specified above — write it
  first, confirm it fails (module missing), then implement `chat.ts`.
- **Callable (e2e — MANDATORY, coverage guard 66→67):** new
  `team ↔ HQ chat` scenario in `scripts/e2e-verify.mjs`:
  1. Lifecycle: create/launch/join; team sends → doc holds 1 msg
     (`from:'team'`, senderName == team name); owner replies with `teamId` →
     2 msgs, `from:'hq'`; order chronological; staff token replies too.
  2. **Cap**: send until >100 total (batched sends; raise past the 10/min rate
     window by minting extra device uids via `joinTeamAsDevice`, or send HQ-side
     from owner + staff identities — cap is per-sender so HQ can carry the
     volume) → doc holds exactly 100, oldest dropped, newest intact.
  3. **Validation**: 501-char text ⇒ `invalid-argument`; whitespace-only ⇒
     `invalid-argument`; control chars stripped from a stored message.
  4. **Rate limit**: 11th send inside a minute from one uid ⇒
     `resource-exhausted`.
  5. **Finished run**: after `finalizeRun`, send ⇒ `failed-precondition`.
  6. **Attached device**: a second device joined via `joinTeamAsDevice`
     (non-controller) CAN send; message attributed to the team.
  7. **Authz-denial-matrix rows** (extend the existing matrix scenario):
     stranger uid, staff of ANOTHER run, and a member of a DIFFERENT team
     cannot send into this team's thread (stranger/other-staff ⇒ `not-found`
     from resolveCallerTeam; other-team member ⇒ lands in their OWN thread,
     never this one — assert the target doc is untouched); participant passing
     `from`-forging fields changes nothing (server sets `from`).
- **Rules (read-side):** `scripts/test-rules.mjs` (`npm run test:rules`, runs in
  `verify:emulator`) — chat doc readable by founder uid, an attached-device uid,
  a run-scoped staff token, and the owner; NOT readable by a stranger or an
  other-run staff token; client write/update/delete denied for everyone.
- **UI:** preview tools — send/receive both directions, unread dot appears and
  clears, RTL message rendering; `npm run i18n:check` clean.

## Footguns respected

- `messages` always rewritten whole inside a transaction — no dotted array
  updates, no `.set({merge})` dotted keys, no lost concurrent appends.
- Server-write-only doc; clients never write (rules `allow write: if false`).
- `deviceUids` mirror keeps rules `get()`-free (same cost profile as team-doc
  reads).
- No new transaction in any scoring hot path — chat is fully off to the side.
- Rate limit uses the existing pure `rateLimit` + `enforceRateLimit` store —
  no new limiter code.
- `FIRESTORE_PATHS` everywhere; no hardcoded path strings.
- Static Tailwind classes; logical RTL classes; `dir="auto"` on user text.
