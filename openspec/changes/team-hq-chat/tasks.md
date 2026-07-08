## 1. Shared chat helpers — RED then GREEN (pure logic, TDD)

- [ ] 1.1 RED: `scripts/test-chat.ts` (tsx assertion script, auto-picked-up by the `npm test` aggregator) asserting `sanitizeChatText` (trims; strips control chars but keeps `\n`; non-string ⇒ null; empty/whitespace-only ⇒ null; 501 chars after trim ⇒ null; exactly 500 ⇒ ok) and `appendCapped` (append at <100 grows by one in order; at 100 the OLDEST is dropped and newest kept; input array never mutated; `CHAT_MAX_MESSAGES === 100`). Confirm it fails (module missing).
- [ ] 1.2 GREEN: implement `packages/shared/src/chat.ts` — `ChatMessage`, `TeamChatDoc`, `CHAT_MAX_MESSAGES`, `sanitizeChatText` (reuse `MAX_MESSAGE_LEN` from `validation.ts`), `appendCapped`; export from `packages/shared/src/index.ts`. `npm test` → 1.1 passes.

## 2. Shared paths + rate budget

- [ ] 2.1 Add `FIRESTORE_PATHS.runChat(ownerUid, gameId, runId, teamId)` and `runChatCol(ownerUid, gameId, runId)` in `packages/shared/src/types/index.ts` (beside `runAnnouncement`).
- [ ] 2.2 Add `sendTeamChatMessage: { max: 10, windowMs: MIN }` to `RATE_LIMITS` in `packages/shared/src/rateLimit.ts`. `npm run typecheck`.

## 3. Callable — sendTeamChatMessage (functions/src/index.ts, root domain)

- [ ] 3.1 Implement `sendTeamChatMessage` beside `pushAnnouncement`: `requireAuth` → `enforceRateLimit(uid, 'sendTeamChatMessage')` → `sanitizeChatText` (null ⇒ `invalid-argument`) → role split: HQ (owner/admin/run-scoped staff via `assertStaffOrOwner`, explicit `teamId` required + team-exists check mirroring targeted `pushAnnouncement`, `from:'hq'`, `senderName` = validated optional field ≤64 fallback `'HQ'`) vs participant (`resolveCallerTeam(uid, ctx)` WITHOUT `requireController` — triggerSOS rationale; payload `teamId` ignored; `from:'team'`, `senderName = team.displayName`).
- [ ] 3.2 Run gate: `finished` run ⇒ `failed-precondition` (joinTeamAsDevice wording).
- [ ] 3.3 Transactional append: read `runChat` doc, `appendCapped`, whole-doc `tx.set` with `teamId`, mirrored `deviceUids` (team doc on participant path; previous doc value else `[]` on HQ path), `messages`, `updatedAt`. Server-minted message id + ISO `at`. No dotted keys, no merge. `npm run typecheck`.

## 4. firestore.rules

- [ ] 4.1 New `match /chat/{teamId}` block under runs: read = `isOwner(uid) || isOwner(teamId) || isAttachedDevice() || isStaffForRun(uid, gameId, runId)` (copy of the teams block); `allow write: if false`.
- [ ] 4.2 Rules test cases in `scripts/test-rules.mjs`: founder reads own chat doc; attached-device uid reads; run-scoped staff token reads (incl. collection list); owner reads; stranger denied; other-run staff denied; all client writes denied. `npm run test:rules` under the emulator lane.

## 5. e2e — MANDATORY (callable coverage guard 66→67; ships RED without this)

- [ ] 5.1 New `team ↔ HQ chat` scenario in `scripts/e2e-verify.mjs`: team sends → HQ (owner) replies with `teamId` → staff token replies; assert order, `from`/`senderName` correctness, doc shape.
- [ ] 5.2 Same scenario: cap behavior — drive total >100 messages (spread across sender uids to stay under the per-uid rate window) ⇒ exactly 100 retained, oldest dropped; 501-char text ⇒ `invalid-argument`; whitespace-only ⇒ `invalid-argument`; control chars stripped in the stored message; post-`finalizeRun` send ⇒ `failed-precondition`; 11th send in a minute from one uid ⇒ `resource-exhausted`; a non-controller attached device (via `joinTeamAsDevice`) CAN send.
- [ ] 5.3 Authz-denial-matrix rows in the existing matrix scenario: stranger and other-run staff cannot send into the thread (`not-found`/`permission-denied`); a member of another team sending lands only in their OWN thread (target doc unchanged); client-supplied `from` is ignored.
- [ ] 5.4 `npm run e2e` — green, coverage guard reports 67/67 (batch gate).

## 6. play-web — ChatPanel + PlayScreen + StaffConsole

- [ ] 6.1 `sendTeamChatMessage` typed wrapper in `apps/play-web/src/services/calls.ts`.
- [ ] 6.2 `store.ts`: `loadChatSeen(runId, teamId)` / `saveChatSeen(runId, teamId, n)` localStorage helpers (best-effort try/catch).
- [ ] 6.3 New `apps/play-web/src/components/ChatPanel.tsx`: single-doc `onSnapshot` on `runChat(ctx, teamId)`, message list (`dir="auto"`, team end-aligned / HQ start-aligned, logical RTL classes), send box (Enter, maxLength 500, disabled in flight), saves seen count on open/new-message-while-open.
- [ ] 6.4 `PlayScreen.tsx`: chat button with unread dot (`messages.length > loadChatSeen(...)`) opening the panel.
- [ ] 6.5 StaffConsole: chat thread list (collection `onSnapshot` on `runChatCol`; team names from existing `teams` state; last-message preview + local unread badge) + expandable thread with reply box (`senderName: staff.name`).
- [ ] 6.6 play-web `i18n.ts` keys EN + HE (`chatTitle`, `chatOpen`, `chatSend`, `chatPlaceholder`, `chatEmpty`, `chatHq`, `chatUnread`, `chatFinishedNotice`).

## 7. creator-web — RunConsolePage threads

- [ ] 7.1 `sendTeamChatMessage` wrapper in `apps/creator-web/src/services/calls.ts`.
- [ ] 7.2 `RunConsolePage.tsx`: chat card — per-team thread list via collection `onSnapshot`, unread indicators (local seen map), reply box per thread.
- [ ] 7.3 creator-web `i18n.ts` keys EN + HE (mirror 6.6 set).

## 8. Gates

- [ ] 8.1 `npm run typecheck`
- [ ] 8.2 `npm run lint`
- [ ] 8.3 `npm test`
- [ ] 8.4 `npm run creator:build` + `npm run play:build`
- [ ] 8.5 `npm run e2e` (+ `npm run test:rules` via `verify:emulator`)
- [ ] 8.6 `npm run i18n:check` (clean; zero new PART B warnings — spot-check with `i18n:check:strict`)
