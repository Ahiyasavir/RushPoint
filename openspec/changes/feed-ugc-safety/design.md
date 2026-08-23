## Context

The live photo feed shipped with `live-photo-feed`. Current ground truth:

- `functions/src/index.ts`
  - `writeFeedItem(ownerUid, gameId, runId, entry)` (~L689) — best-effort `.set()` of a new
    `FeedItem` with `reactions: {}`, `reactedBy: {}`, `active: true` on **both** photo-approval
    paths (`submitStationPhoto` autoApprove + `reviewStationSubmission` approve). Deliberately
    **not** transactional (hot-path rule: never add a txn to the completeTask path).
  - `reactToFeedItem` (~L719) — `requireAuth` → `enforceRateLimit(uid, 'reactToFeedItem')` →
    run-membership via `resolveCallerTeam`, falling back to `assertStaffOrOwner` → transaction that
    reads the item, rejects `active === false` as `not-found`, applies the pure `applyReaction`
    reducer, and `tx.update`s **whole nested maps** (never dotted `.set({merge})` keys).
  - `hideFeedItem` (~L767) — `assertStaffOrOwner(context, ownerUid, runId)` → `.update({ active:
    false, hiddenAt, hiddenBy: context.auth!.uid })`.
- `packages/shared/src/feedReactions.ts` — the pattern to mirror: a closed constant set
  (`FEED_EMOJIS`), a narrow state interface, a pure `applyReaction(item, uid, emoji)` that throws on
  an invalid input, never mutates, and returns `{ ..., changed }`. Unit-tested by
  `scripts/test-feed-reactions.ts` in the no-emulator lane.
- `packages/shared/src/types/index.ts` — `FeedItem` (~L1007) with `id, taskId, taskTitle, teamId,
  teamName, photoUrl, reactions, reactedBy, active, createdAt, hiddenAt?, hiddenBy?`.
  `photoFeedEnabled?: boolean` appears at ~L500 (Game) and ~L1160 (the participant-facing game
  payload); **absent ⇒ enabled**.
- `packages/shared/src/rateLimit.ts` — `reactToFeedItem: { max: 60, windowMs: MIN }` (~L81).
- `apps/play-web/src/components/FeedPanel.tsx` — snapshot listener with
  `where('active', '==', true)`, client-side sort, `moderate?: boolean` prop gating the staff hide
  button, all copy already routed through `t.feed.*` via `useT()`. Lazy-loaded from `PlayScreen`
  behind `state.game.photoFeedEnabled !== false`.
- `packages/shared/src/ceremony.ts` — `pickCeremonyFeed` filters `active !== false`, so **any**
  hide (staff or auto) already removes an item from the ceremony slideshow. No change needed.
- `firestore.rules` — `feedItems/{docId}`: `read` if owner **or** run-scoped staff **or** run
  participant; `write: if false`. Reads are **not** filtered by `active`, so a staff listener can
  legally read hidden items without a rules change.
- `apps/creator-web/src/pages/LegalPage.tsx` — §5.4 "איסורים על תוכן" / "Content Prohibitions"
  exists in both the HE and EN document bodies, but sits inside §5 (task gallery licensing) and
  never mentions the feed, reporting, or removal.
- `apps/creator-web/src/pages/BuilderPage.tsx` (~L472) — a bare `photoFeedEnabled` checkbox
  (`checked={game.photoFeedEnabled !== false}`), no helper text.
- `scripts/e2e-verify.mjs` — feed scenario around L1948–L2080 (`reactToFeedItem` idempotence /
  switch / invalid emoji / stranger denial / `hideFeedItem` denial + hide), a table-driven
  **authorization denial matrix** (~L5577), a sanitizer allowlist, and a **callable coverage guard**
  that introspects the emulator's callables and fails the run if any was never invoked.

## Goals / Non-Goals

**Goals**
- Satisfy every limb of Google Play's UGC policy for the feed: **report**, **block**, **moderate**,
  **published policy**.
- Keep the reporter protected immediately, without handing a competitive rival a one-tap global
  censor button.
- Make a false-positive auto-hide fully recoverable by staff, and not instantly re-triggerable.
- Keep all new decision logic **pure and unit-tested** in the no-emulator lane, mirroring
  `feedReactions.ts`.

**Non-Goals**
- No pre-broadcast review queue, no ML/automated image classification.
- No free-text report reason; no appeals UI; no cross-run bans or reputation.
- No change to the `photoFeedEnabled` default (undefined ⇒ enabled).
- No Firestore rules change, no new composite index, no new env var, no new dependency.
- No server-persisted mute state (mute is per-device, `localStorage`, never a client Firestore write).

## Decisions

### D1 — `reportFeedItem` mirrors `reactToFeedItem`'s auth posture exactly

New callable in `functions/src/index.ts`, adjacent to `reactToFeedItem`, re-exported implicitly (it
is declared with `export const` in the root index, same as its neighbours):

```
reportFeedItem({ ownerUid, gameId, runId, itemId, reason })
```

- `requireAuth(context)` → `await enforceRateLimit(uid, 'reportFeedItem')`.
- Membership: `try { await resolveCallerTeam(uid, { ownerUid, gameId, runId }) } catch {
  assertStaffOrOwner(context, ownerUid, runId) }` — identical to `reactToFeedItem`, so a stranger is
  denied and staff/owner may also report.
- Argument validation: `ownerUid`, `gameId`, `runId`, `itemId` required (`invalid-argument`);
  `reason` must be in `FEED_REPORT_REASONS` else `invalid-argument`.
- Body: a `db.runTransaction` reading `FIRESTORE_PATHS.feedItem(...)`, `not-found` if the doc is
  missing. **Unlike `reactToFeedItem`, an already-inactive item is NOT rejected as `not-found`** —
  reporting an item that a rival already got auto-hidden must stay idempotent and cheap; the reducer
  simply records the reporter and returns unchanged `active: false`.
- `tx.update` with **whole nested maps** (`reportedBy`) plus scalars — never dotted `.set({merge})`
  keys, never a dotted update into an array.
- Returns `{ ok: true, reportCount, hidden }` so the client can render "removed pending review" vs
  "reported".

*Why mirror rather than generalize:* the reaction callable is the proven shape for
participant-writable feed state; deviating invites an authz gap.

### D2 — `applyReport` is a pure reducer in `packages/shared/src/feedReports.ts`

> **DESIGN AMENDMENT (supersedes the reducer's original `uid`-keyed shape below):**
> `reportedBy` is keyed by the caller's **teamId**, not their `uid`. RushPoint supports shared team
> devices (multiple `uid`s attached to one team via `deviceUids`), so per-`uid` distinctness would
> let a single team with two phones reach `FEED_AUTO_HIDE_REPORTS` on its own and hide a rival
> team's photo — exactly the griefing the threshold-of-2 exists to prevent. The reducer stays pure
> and caller-agnostic: its second parameter is renamed `reporterKey` (never `uid` inside the pure
> module), and `functions/src/index.ts`'s `reportFeedItem` resolves it to the caller's `teamId` (via
> the same `resolveCallerTeam` used by `reactToFeedItem`), or the sentinel `staff:<uid>` for a
> staff/owner reporter, who has no team. `reportCount` is therefore the number of distinct **teams**,
> not distinct devices/uids. This resolves the "Per-uid vs per-team distinctness" Open Question
> below in favor of per-team, shipped in the initial implementation rather than deferred.

```ts
export const FEED_REPORT_REASONS = ['inappropriate', 'harassment', 'privacy', 'other'] as const;
export type FeedReportReason = (typeof FEED_REPORT_REASONS)[number];
export const FEED_AUTO_HIDE_REPORTS = 2;

export interface FeedReportState {
  reportedBy?: Record<string, string>;  // reporterKey (teamId, or `staff:<uid>`) → reason
  reportCount?: number;
  active?: boolean;
  hiddenAt?: string;
  hiddenBy?: string;
  reportsCleared?: boolean;
}

export interface FeedReportResult {
  reportedBy: Record<string, string>;
  reportCount: number;
  active: boolean;
  hiddenAt?: string;
  hiddenBy?: string;
  changed: boolean;   // false when this reporterKey already reported with the same reason
  hidden: boolean;    // true when THIS call flipped active → false
}

export function applyReport(item, reporterKey, reason, now?): FeedReportResult
```

Behavior:
- Throws on a reason outside `FEED_REPORT_REASONS` (server maps to `invalid-argument`).
- Idempotent per reporterKey: `reportedBy[reporterKey] = reason`; a repeat with the **same** reason
  returns `changed: false`; a repeat with a **different** reason updates the stored reason but does
  **not** raise `reportCount`. Because `reporterKey` is a **teamId** (see amendment above), a second
  device on the SAME team re-reporting is exactly this idempotent case — it can never count as a
  second distinct reporter.
- `reportCount === Object.keys(reportedBy).length` — **distinct reporterKeys (teams)**, always
  recomputed, never incremented blindly (so a replay can't inflate it).
- Auto-hide: when `reportCount >= FEED_AUTO_HIDE_REPORTS` **and** `item.active !== false` **and**
  `item.reportsCleared !== true`, set `active: false`, `hiddenBy: 'auto:reports'`, `hiddenAt: now`,
  and report `hidden: true`.
- Never mutates its input (clone `reportedBy` first) and injects `now` for deterministic tests.

*Why threshold 2, not 1:* teams in a run are competitive rivals. A one-report instant global hide is
trivially griefable — a rival deletes your celebratory photo (and your ceremony slide) with one tap.
Two **distinct teams** is the minimum that isn't a solo weapon (see the amendment above — distinct
*uids* was not actually sufficient once shared team devices existed). The reporter's own exposure is
closed immediately by D3's local suppression, so nobody is forced to keep looking at content they
objected to while the second report is pending. Staff can always hide on report #1 via the
moderation view.

*Why `hiddenBy: 'auto:reports'` (a sentinel, not a uid):* it keeps the existing `hiddenBy` field
shape (a string) while letting the moderation UI and any audit read distinguish an automated hide
from a named staff hide, without a second field.

### D3 — Mute is per-device and pure: `packages/shared/src/feedMute.ts`

```ts
export interface FeedMuteState { items: string[]; teams: string[] }
export const EMPTY_FEED_MUTE: FeedMuteState;
export function addMutedItem(state, itemId): FeedMuteState;
export function addMutedTeam(state, teamId): FeedMuteState;
export function isFeedItemMuted(state, item: { id: string; teamId: string }): boolean;
export function parseFeedMute(raw: string | null): FeedMuteState;   // tolerant of junk/legacy
export function serializeFeedMute(state): string;
```

- Pure, immutable, deduped, order-stable. `parseFeedMute` never throws on malformed
  `localStorage` — it returns `EMPTY_FEED_MUTE` (a corrupted key must not white-screen the feed).
- play-web persists under a run-scoped key (e.g. `rp.feedMute.<runId>`) so a mute doesn't leak
  across unrelated events; the state is read once into React state and written on each change.
- `FeedPanel` filters the rendered list through `isFeedItemMuted` **after** the snapshot, so muting
  never touches Firestore and works offline.
- Reporting an item calls `addMutedItem` **optimistically, before/regardless of** the callable
  resolving — the reporter's suppression must not depend on the network.

*Why local, not server:* participants are anonymous (`uid == teamId`), so there is no account to
carry a block list; and a client-written mute list would violate the server-write-only rule.
Per-device is also what "block" means for a single-session participant app.

*Naming honesty (call this out in the ToS clause):* "mute this team" is **team-level suppression on
this device**, not identity-level blocking — that is the only thing anonymity permits, and the
policy text says so plainly rather than over-promising.

### D4 — `hideFeedItem` gains `restore?: boolean`; moderate view sees hidden items

- `hideFeedItem({ ..., restore: true })` → `.update({ active: true, hiddenAt:
  FieldValue.delete(), hiddenBy: FieldValue.delete(), reportsCleared: true })`. Authz is
  **unchanged** (`assertStaffOrOwner` at the top, before any branch) — restore is staff/owner-only
  and must appear in the e2e denial matrix.
- `reportsCleared: true` makes `applyReport` skip auto-hide forever after for that item, so a
  restored item cannot be immediately re-auto-hidden by the same two rivals. New reports still
  accumulate in `reportedBy`/`reportCount` (staff keep seeing the pressure and may hide manually) —
  only the **automatic** flip is disarmed.
- `FeedPanel` in `moderate` mode drops the `where('active','==',true)` clause (rules already allow
  staff/owner to read hidden docs) and renders hidden items visually distinct with a report-count
  badge + reason summary, plus a **Restore** action. Non-moderate (participant) listeners keep the
  `active == true` filter unchanged.
- **Query-shape note:** the participant listener keeps its existing single-field filter; the
  moderate listener has *fewer* constraints. No new composite index is required either way.

### D5 — Types: three additive optional fields on `FeedItem`

`reportedBy?: Record<string, string>`, `reportCount?: number`, `reportsCleared?: boolean`. All
optional so existing feed docs are valid without a migration (`applyReport` defaults them). Nothing
in the feed payload is participant-secret, but `reportedBy` maps **reporterKey → reason** — per the
**DESIGN AMENDMENT** in D2, `reporterKey` is a **teamId** (or the sentinel `staff:<uid>` for a
staff/owner reporter) — and is **only** read by the moderation view; the participant listener never
renders it. (Feed docs are read directly from Firestore by participants under the existing rule —
`reportedBy` is therefore visible to run participants. That is acceptable: a teamId here is already
displayed elsewhere in the feed (`FeedItem.teamId`), and the alternative — a separate subcollection —
is a rules + index change for no safety gain. Call it out so it is a decision, not an accident.)

### D6 — Rate limit

Add `reportFeedItem: { max: 20, windowMs: MIN }` to `packages/shared/src/rateLimit.ts`, below the
`reactToFeedItem` entry. Lower than reactions (60) because a report is a moderation-weight action,
high enough that a participant sweeping a busy feed isn't throttled.

### D7 — Published policy + creator disclosure (bilingual, `t.*`-routed)

- `LegalPage.tsx`: a **new** clause explicitly naming the live photo feed — placed as its own
  numbered sub-clause in the participant/content section of **both** the HE and EN document bodies,
  covering: (a) what participants may not upload, (b) that uploaded photos are visible to **all
  teams in the run**, (c) that **any participant may report** content, (d) that reported content is
  **removed pending review**, (e) that the organizer and RushPoint may remove content and that mute
  is device-local team suppression. §5.4 stays where it is (it governs the gallery); the new clause
  cross-references it rather than replacing it.
- `BuilderPage.tsx`: helper text under the `photoFeedEnabled` checkbox — photos are visible to every
  team in the run; the organizer is responsible for their participants' content. The **default stays
  ON** (`game.photoFeedEnabled !== false`); this change must not touch that expression.
- Both apps: every new string goes into **both** the `en` and `he` maps in the app's `i18n.ts` and is
  read via `t.*`. Long legal prose in `LegalPage.tsx` follows whatever the file already does for its
  two document bodies — the addition must not introduce a hardcoded switchable string.

## Test strategy

**Lane 1 — pure logic, no emulator (`npm test`, via `scripts/run-unit-tests.mjs`).**
- `scripts/test-feed-reports.ts` (mirrors `scripts/test-feed-reactions.ts`) — asserts:
  first report records `reportedBy[uid]` and `reportCount === 1`, item stays `active: true`;
  the same uid reporting again is `changed: false` and does **not** raise `reportCount`;
  the same uid with a different reason updates the reason, `reportCount` unchanged;
  a **second distinct** uid hits `FEED_AUTO_HIDE_REPORTS` → `active: false`,
  `hiddenBy === 'auto:reports'`, `hiddenAt` set, `hidden: true`;
  a third report on an already-hidden item is idempotent (`hidden: false`, still inactive);
  `reportsCleared: true` suppresses auto-hide even at/above the threshold while still counting;
  an invalid reason **throws**; the input object is **not mutated** (deep-equal a frozen copy).
- `scripts/test-feed-mute.ts` — `addMutedItem`/`addMutedTeam` are immutable, deduped;
  `isFeedItemMuted` matches by item id **and** by team id; `parseFeedMute(null)` and
  `parseFeedMute('{{not json')` both return the empty state without throwing; round-trip
  `serializeFeedMute` → `parseFeedMute` is identity.

**Lane 2 — callable behavior (`npm run e2e`, `scripts/e2e-verify.mjs`).** Extend the existing feed
scenario (around L1948–L2080) and the authz matrix (~L5577):
- a run participant calls `reportFeedItem` with a valid reason → `{ ok: true, reportCount: 1 }`,
  the doc is still readable with `active === true`;
- the **same** participant reports again → `reportCount` still 1 (idempotent);
- an invalid reason (e.g. `'because'`) → rejected `invalid-argument`;
- a **stranger** (not in the run) → denied — add `reportFeedItem` to the **allowed** column for the
  participant party and the denial matrix for the stranger party;
- a **second distinct** participant reports the same item → `hidden: true`, the doc reads
  `active === false`, `hiddenBy === 'auto:reports'`, and a subsequent `reactToFeedItem` on it is
  rejected `not-found` (existing behavior must still hold);
- `hideFeedItem({ restore: true })` by a **participant** → denied (`assertStaffOrOwner`), by the
  **owner** → `active === true` again with `hiddenAt`/`hiddenBy` cleared and `reportsCleared === true`;
- after restore, a **third** distinct reporter does **not** re-hide it (`hidden: false`,
  `active === true`) while `reportCount` still climbs.
- **Callable coverage guard:** `reportFeedItem` is a new callable, so the guard fails the whole run
  until at least one scenario invokes it. This is why the e2e task is not optional and is sequenced
  before the gate task.

**Lane 3 — UI (no component runner).** Verify via the preview tools on a live run:
participant feed shows a report control per card → choosing a reason removes the card **immediately**
on that device; "mute this team" removes all of that team's cards and survives a reload; the staff
console (`?staff`) in moderate mode lists hidden items with a report badge and restores one.
Then, mandatory: `npm run i18n:check` clean (PART A hard gate) and `npm run i18n:check:strict` adding
**zero** new PART B findings — every new string in both apps present in **both** `en` and `he`.

**Gates:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` ·
`npm run play:build` · `npm run e2e` · `npm run i18n:check`.

## Risks / Trade-offs

- **Threshold 2 leaves a window where a second participant still sees objectionable content.**
  Accepted and mitigated: the reporter is suppressed instantly, staff see the report immediately in
  moderate mode and can hide on report #1, and `active: false` propagates to the ceremony slideshow
  for free. A threshold of 1 trades this for a one-tap griefing weapon between rival teams.
- **Report brigading by one team's multiple devices** is closed by the **DESIGN AMENDMENT** in D2:
  `reportedBy` is keyed by teamId, not uid, so a team's extra devices can never count as more than
  one reporter. Staff `restore` + `reportsCleared` remain the backstop for any other false positive.
- **`reportsCleared` is a permanent auto-hide disarm** for that item. Deliberate: it is the only way a
  restore isn't undone in seconds. Staff retain the manual hide, so nothing is unremovable.
- **Local-only mute is lost on storage clear / new device.** Acceptable for an anonymous,
  single-event participant app; the alternative is a client-written server doc (forbidden) or an
  account system (out of scope).
- **`reportedBy` is readable by run participants** under the existing rule (see D5). Documented as a
  decision; contains no secret beyond a teamId already shown in the feed.
- **Legal copy is long bilingual prose** — the highest-probability source of an i18n PART A failure.
  Add HE and EN in the same edit and run `i18n:check` before declaring anything done.
- **Moderate listener without the `active` filter reads more docs** on a long run. Bounded by the
  existing feed size and only for staff/owner; keep the existing result cap/sort.

## Migration Plan

Purely additive; no data migration and no backfill. Existing `FeedItem` docs lack
`reportedBy`/`reportCount`/`reportsCleared` — `applyReport` defaults each, and the moderation UI
renders a missing `reportCount` as 0. Deploy order is irrelevant (an old client simply never calls
`reportFeedItem`). Rollback = revert the commits; leftover report fields on existing docs are inert.

## Open Questions

- **Per-uid vs per-team distinctness for the auto-hide count** — RESOLVED by the **DESIGN
  AMENDMENT** in D2/D5: shipped as per-**team** (keyed by `reporterKey` = teamId), not per-uid,
  precisely because shared team devices mean two uids can be one team. Not deferred.
- **Should an auto-hide notify staff** (an alert/announcement, or a badge on the staff console)?
  Out of scope here; the moderate view surfaces it on open. Worth a follow-up if organizers report
  they missed hides.
- **Report the reporter's own team's photo?** Currently allowed (no self-exclusion). Harmless, but if
  we later want it, it belongs in `applyReport` as a pure rule, not in the callable.
- **Where exactly the new ToS clause is numbered** — depends on how `LegalPage.tsx`'s HE/EN bodies
  are structured at implementation time; the requirement is that it exists, names the feed, and is
  bilingual, not that it takes a specific number.
