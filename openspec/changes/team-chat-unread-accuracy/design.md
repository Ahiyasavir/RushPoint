# Design — team-chat-unread-accuracy

## Current behavior (verified in the tree, not assumed)

| Surface | File | Seen marker | Persisted? |
|---|---|---|---|
| Participant chat section | `apps/play-web/src/screens/PlayScreen.tsx` `ChatSection` | `useState(() => loadChatSeen(runId, teamId))` — a **number** | ✅ `localStorage` via `apps/play-web/src/store.ts` |
| Participant panel | `apps/play-web/src/components/ChatPanel.tsx` | writes `saveChatSeen(runId, teamId, msgs.length)` on every snapshot | ✅ |
| Staff console | `apps/play-web/src/screens/StaffConsole.tsx` `StaffChatSection` | `useState<Record<string, number>>({})` | ❌ **never written to storage** |
| Creator run console | `apps/creator-web/src/pages/RunConsolePage.tsx` (page state, passed into `ChatConsole`) | `useState<Record<string, number>>({})` | ❌ **never written to storage** |

Every surface computes unread as `messages.length > (seen[teamId] ?? 0)`.

**Root cause of the reported over-report:** the two HQ maps are React state only.
A reload (or a remount of the run console page) reinitializes them to `{}`, and
`(seen[teamId] ?? 0) === 0` makes *every* non-empty thread unread. The
participant side is not affected by reload — it persists — so the recorded
description is accurate but narrower than written: it is an **HQ-console** bug.

Two further defects come from the *shape* of the marker rather than its storage:
own messages are counted (the comparison never looks at who wrote the message),
and a count marker is useless once `appendCapped` starts evicting (past 100
messages `messages.length` is permanently 100).

## The decision, extracted

```ts
// packages/shared/src/chat.ts

/** What a viewer has already seen in one thread. Anchored on the last-seen
 *  message id; `count` is only the legacy/migration fallback. */
export interface ChatSeenMarker {
  lastSeenId?: string | null;
  count?: number | null;
}

/** The marker to persist after showing `messages` to the viewer. */
export function chatSeenMarker(messages: readonly ChatMessage[]): ChatSeenMarker;

/** Messages after the viewer's anchor, excluding the viewer's own. */
export function countUnreadChatMessages(
  messages: readonly ChatMessage[] | null | undefined,
  marker: ChatSeenMarker | null | undefined,
  selfUid: string | null | undefined,
): number;

/** localStorage round-trip; tolerates a bare legacy number and any garbage. */
export function parseChatSeen(raw: string | null | undefined): ChatSeenMarker;
export function serializeChatSeen(marker: ChatSeenMarker): string;

/** One key builder both apps share, so HQ and participant never diverge. */
export function chatSeenStorageKey(runId: string, teamId: string): string;
```

### Algorithm

1. Not an array, or empty ⇒ `0`.
2. Find the cut index:
   - `marker.lastSeenId` is a non-empty string ⇒ `i = messages.findIndex(m => m.id === lastSeenId)`;
     `i >= 0` ⇒ `cut = i + 1`. **`i < 0` ⇒ `cut = 0`** — the anchor has been evicted
     by the 100-cap, therefore every retained message is newer than it.
   - no `lastSeenId` (fresh join, or a legacy numeric marker) ⇒
     `cut = clamp(marker.count ?? 0, 0, messages.length)`.
3. `return messages.slice(cut).filter(m => !isOwn(m, selfUid)).length`, where
   `isOwn` is `!!selfUid && m.senderId === selfUid` — the same `senderId`-wins
   rule `chatMessageSide` already uses (an owner playing their own game is
   stamped `from:'hq'` yet must read as themselves).

**Why not timestamps.** `at` is an ISO string off the *server* clock, written per
send; two sends inside the same millisecond tie, and a transaction retry or a
clock adjustment can emit a value that is not monotonic. A `>` / `>=` comparison
against a stored `at` therefore either double-counts or silently swallows a
message at the boundary. The array is already in append (chronological) order, so
an id anchor gives an exact cut with no comparison at all — the ±1 ms and
out-of-order cases become structurally impossible rather than handled.

**Why the eviction case returns "all".** `appendCapped` only ever drops from the
*front*. If the anchor id is absent, ≥ 1 eviction has happened since the viewer
last looked, so nothing in the retained window predates the anchor. Returning
`messages.length` (minus own) is the truthful answer; a count marker would return
`0` here, which is exactly defect 3.

## Wiring

- **`packages/shared/src/chat.ts`** — add the block above. `packages/shared/src/index.ts`
  already re-exports `./chat` wholesale; nothing else to export.
- **`apps/play-web/src/store.ts`** — `loadChatSeen(runId, teamId): ChatSeenMarker`
  (`parseChatSeen(localStorage.getItem(chatSeenStorageKey(...)))`, best-effort
  try/catch, legacy bare numbers still parse) and
  `saveChatSeen(runId, teamId, marker: ChatSeenMarker)`. The prefix constant is
  replaced by the shared key builder so both apps write the same namespace.
- **`ChatSection` (PlayScreen)** — the cheap listener already runs while
  collapsed; it now keeps the `ChatMessage[]` instead of only its length, holds
  the marker in state, and derives
  `unread = countUnreadChatMessages(messages, marker, myUid) > 0`. Opening, and
  any arrival while open, persists `chatSeenMarker(messages)`. `myUid` comes from
  `uid()` in `services/firebase` (same source `ChatPanel` already uses).
- **`ChatPanel`** — persists `chatSeenMarker(msgs)` on each snapshot (replacing
  `saveChatSeen(..., msgs.length)`); no visual change.
- **`StaffChatSection` (play-web StaffConsole)** — seed the map from storage on
  mount (`useState(() => …)` reading each thread's key lazily is not possible
  before the threads arrive, so the map is read per-thread through a small
  `readMarker(teamId)` memo backed by a `useRef` cache) and write through on
  expand / while expanded. Unread per thread = `countUnreadChatMessages(...) > 0`
  with the staffer's `uid()`.
- **`RunConsolePage` + `ChatConsole` (creator-web)** — same treatment; identity is
  `auth.currentUser?.uid` (the owner's uid), which is what `senderId` holds for
  owner replies. The page-level `unreadChatThreads` badge keeps counting
  *threads*, now via the shared function.

Storage namespace stays `rushpoint.chatSeen.<runId>.<teamId>` (unchanged for
participants; new for HQ, whose consoles run on a different origin anyway).

## Test strategy

**Pure lane — `scripts/test-chat.ts`** (existing tsx assertion script, already
wired into the `npm test` aggregator; no emulator). RED first: the new asserts
reference `countUnreadChatMessages` before it exists, so the script fails to
resolve the import. Cases:

| # | Case | Expectation |
|---|---|---|
| 1 | Empty chat, any marker | `0` |
| 2 | Fresh join — no marker at all, 3 messages from HQ | `3` |
| 3 | Fresh join where 1 of the 3 is the viewer's own | `2` |
| 4 | Reload with no new messages (marker = last id) | `0` |
| 5 | Reload with 2 new messages | `2` |
| 6 | Reload where the only new message is the viewer's own | `0` |
| 7 | Boundary: the anchored message itself is never counted; the message immediately after it always is | `1` for a thread of anchor+1 |
| 8 | ±1 ms / identical `at`: three messages sharing one `at`, anchor in the middle | `1` (position, not time) |
| 9 | Clock skew: `at` strictly decreasing down the array | anchor still cuts exactly |
| 10 | Multi-device: teammate's message (different `senderId`, `from:'team'`) counts; this device's own does not | `1` of 2 |
| 11 | Cap eviction: anchor id absent from the retained window | all retained non-own messages |
| 12 | Legacy numeric marker (`{count:2}`, no id) | messages after index 2 |
| 13 | Legacy count larger than the array | `0`, never negative |
| 14 | `parseChatSeen` round-trip; bare `"5"` → `{count:5}`; `null`/garbage → `{}` | as stated |
| 15 | `chatSeenMarker([])` | no `lastSeenId` |
| 16 | Input array never mutated | length + identity unchanged |

**Callable lane:** none. No callable, doc shape, or rule changes — the chat doc is
written by `sendTeamChatMessage` exactly as before and unread never leaves the
client. `scripts/e2e-verify.mjs` therefore gains **no** assertions and the
callable-coverage guard is unaffected.

**UI:** the three surfaces render the same elements with the same i18n keys
(`chatUnread`, `chatTitle`, …) — no new or changed user-facing strings. Because
components are edited, `npm run i18n:check` is still run and must be clean, with
zero new PART B findings (`npm run i18n:check:strict`).

**Gates:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run play:build`,
`npm run creator:build`, `npm run i18n:check`. The emulator-backed gates
(`npm run e2e`, `npm run test:rules`, `verify:emulator`) are **not** run in this
change — a live playtest stack owns the emulator — and nothing in this change
touches server behavior that they cover.

## Footguns respected

- No Firestore write of any kind; the chat doc stays server-write-only.
- No dotted keys, no array-element updates — the doc is not written here at all.
- `localStorage` access stays inside try/catch (private mode / storage off ⇒
  degrade to "everything unread", the safe direction).
- Pure module keeps zero Firebase imports, so the tsx pure lane can import it.
- Tailwind classes untouched; no new strings, so RTL/i18n surface is unchanged.
