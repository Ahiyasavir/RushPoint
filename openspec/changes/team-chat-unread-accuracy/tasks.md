## 1. Confirm the defect before fixing it

- [x] 1.1 Read the four chat surfaces and record where the seen marker lives and whether it is persisted: `apps/creator-web/src/pages/RunConsolePage.tsx` (`chatSeen`), `apps/play-web/src/screens/StaffConsole.tsx` (`StaffChatSection.seen`), `apps/play-web/src/screens/PlayScreen.tsx` (`ChatSection`), `apps/play-web/src/store.ts`. Confirm the reload path: HQ maps are `useState({})` with no storage read/write ⇒ reload ⇒ every non-empty thread re-flags unread. State plainly if the recorded description is wrong.

## 2. Unread decision — RED then GREEN (pure logic, TDD)

- [x] 2.1 RED: extend `scripts/test-chat.ts` with the unread suite — empty chat; fresh join (no marker); own message never counted; reload with no new messages; reload with N new; only-own-new ⇒ 0; anchor boundary (anchor not counted, next one is); identical `at` on three messages with the anchor in the middle; strictly decreasing `at` (clock skew); multi-device (teammate counted, this device's own not); cap eviction (anchor id gone ⇒ all retained non-own); legacy `{count}` marker; legacy count past the end ⇒ 0; `parseChatSeen`/`serializeChatSeen` round-trip incl. bare-number and garbage input; `chatSeenMarker([])`; input array not mutated. Run `npm test` and confirm it fails for the right reason (the new exports do not exist).
- [x] 2.2 GREEN: implement `ChatSeenMarker`, `chatSeenMarker`, `countUnreadChatMessages`, `parseChatSeen`, `serializeChatSeen`, `chatSeenStorageKey` in `packages/shared/src/chat.ts` (id-anchored cut; absent anchor ⇒ cut 0; `count` fallback clamped; own = `senderId === selfUid`). `npm test` → 2.1 passes.

## 3. Participant surfaces use the shared decision

- [x] 3.1 `apps/play-web/src/store.ts`: `loadChatSeen(runId, teamId): ChatSeenMarker` / `saveChatSeen(runId, teamId, marker)` over `chatSeenStorageKey`, parsing legacy bare numbers; keep the best-effort try/catch.
- [x] 3.2 `ChatSection` in `apps/play-web/src/screens/PlayScreen.tsx`: hold the message array (not just its length), derive `unread` from `countUnreadChatMessages(messages, marker, uid())`, persist `chatSeenMarker(messages)` on open and on arrivals while open.
- [x] 3.3 `apps/play-web/src/components/ChatPanel.tsx`: persist `chatSeenMarker(msgs)` instead of the raw length.

## 4. HQ surfaces persist and become identity-aware

- [x] 4.1 `StaffChatSection` in `apps/play-web/src/screens/StaffConsole.tsx`: seed each thread's marker from storage, write through on expand and while expanded, and compute unread with `countUnreadChatMessages(..., uid())`.
- [x] 4.2 `apps/creator-web/src/pages/RunConsolePage.tsx`: same for the page-level `chatSeen` map (persisted per run+team) and `ChatConsole`; the folded moderation badge counts threads via the shared function; identity is the signed-in owner's uid.

## 5. Refactor / de-duplication

- [x] 5.1 Remove the now-dead `CHAT_SEEN_PREFIX` and every remaining inline `messages.length > seen` comparison; all four surfaces go through `countUnreadChatMessages`. No behavior change beyond tasks 2–4.

## 6. Gates (emulator-free lane — a live playtest stack owns the emulator)

- [x] 6.1 `npm run typecheck`
- [x] 6.2 `npm run lint`
- [x] 6.3 `npm test`
- [x] 6.4 `npm run play:build` + `npm run creator:build`
- [x] 6.5 `npm run i18n:check` clean (UI files touched) and no new PART B findings (`npm run i18n:check:strict`)
- [x] 6.6 Record explicitly that `npm run e2e` / `npm run test:rules` / `verify:emulator` were NOT run, and why they are not needed here (no callable, doc-shape or rules change).
