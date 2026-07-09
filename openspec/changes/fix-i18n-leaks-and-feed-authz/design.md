## Context

Two hardening fixes from a senior review, bundled because they share a theme (bypassing the
project's own machinery) and a single verification pass:

**A. i18n leaks.** RushPoint's i18n contract (config.yaml §"i18n correctness", INSTRUCTIONS.md
§3.D) is that *every* user-facing string comes from `apps/*/src/i18n.ts` via `t.*`, so a HE↔EN
switch flips the whole UI. `scripts/check-i18n.ts` enforces this: PART A (dictionary parity/purity)
is a hard gate; PART B (`:strict`) flags hardcoded component strings. The sites below currently
either hardcode a literal or hand-roll a `lang === 'he' ? … : …` ternary inside the component.
Verified against the real code:
- `DashboardPage.tsx` L113 `?? 'יוצר'`, L197 `g.visibility === 'public' ? 'ציבורי' : 'פרטי'`,
  L202 `g.description || 'אין תיאור עדיין.'`.
- `BuilderPage.tsx` L38 `title: \`Stage ${order + 1}\`` inside `blankStage()`, whose output is
  persisted through `buildSavePayload` → `updateGame` (so the leak reaches stored data, not just
  the screen).
- `JoinScreen.tsx` L186 aria-label ternary, L189 language-name switcher (`'English'`/`'עברית'`),
  L387 remove-member aria-label ternary.

**B. feedItems cross-tenant read.** `firestore.rules` currently gates the live-ops subcollections
with `allow read: if isAuthenticated()` (L71 announcements, L76 flashMissions, L84 feedItems).
`feedItems` are written by `writeFeedItem()` (`functions/src/index.ts` L622-642) with
`photoUrl`, `teamName`, `taskTitle` — participant PII. `apps/play-web/src/components/FeedPanel.tsx`
L27-37 reads them with a **direct client** `onSnapshot(query(collection(…feedItems), where('active','==',true)))`.
Firestore evaluates a list/get read against the `allow read` predicate, and rules *may* call
`exists()`/`get()` in a read rule (charged as one extra document read for the query). The existing
`isStaffForRun(uid, gameId, runId)` helper already encodes the staff-token claims model
(`token.staff == true` + `ownerUid/gameId/runId`). What's missing is a "this authed user is a
participant of *this* run" predicate. The `.../teams/{teamId}` docs are keyed by the founder uid
(`uid == teamId`), so run membership for the founding device is exactly
`exists(.../runs/{runId}/teams/{request.auth.uid})`.

## Goals / Non-Goals

**Goals:**
- Every touched user-facing string flips language via `t.*`; `npm run i18n:check` PART A stays clean
  and `:strict` gains **zero** new PART B findings; the three named leaks disappear.
- The BuilderPage default is localized *without* rewriting any already-saved stage title.
- A non-participant of run X cannot read run X's `feedItems`; a participant/staff/owner of run X can.
- Reuse the existing staff-claims model and the existing team-doc identity; add no new callable.

**Non-Goals:**
- No `getRunFeed` callable; the client listener stays, only the rule narrows.
- No change to `writeFeedItem`, feed shape, or reactions/hide callables.
- No re-scoping of `trackables`/`zones`/`benchmarks`/`accessCodes` (live/public data, no per-run PII).
- No migration of stored game data.

## Decisions

### D1 — creator-web i18n keys (exact)
Add to **both** the HE and EN `dashboard` maps in `apps/creator-web/src/i18n.ts`:
- `creatorFallback: 'יוצר'` / `'Creator'` — used for the display-name fallback at DashboardPage L113.
- `visPublic: 'ציבורי'` / `'Public'` and `visPrivate: 'פרטי'` / `'Private'` — L197 badge.
- `noDescription: 'אין תיאור עדיין.'` / `'No description yet.'` — L202 placeholder.

Add to **both** the HE and EN `builder` (`b`) maps:
- `stageDefaultTitle: (n: number) => \`שלב ${n}\`` / `(n: number) => \`Stage ${n}\`` — L38.

DashboardPage edits: `?? d.creatorFallback`; `{g.visibility === 'public' ? d.visPublic : d.visPrivate}`;
`{g.description || d.noDescription}`. BuilderPage: `blankStage` calls the current dictionary
(`t.builder.stageDefaultTitle(order + 1)`). `blankStage` is a module-level helper today; it will
either take the localized title as an argument from its React caller, or read the active dictionary
through the same `getT()`/`useT()` accessor the file already uses — whichever keeps `blankStage`
pure-testable. Either way the default is resolved at stage-creation time in the creator's current
language.

### D2 — BuilderPage default must not break existing games
The persisted-string concern is bounded: only *new* stages created after this change pick up the
localized default. Existing games keep whatever titles are already stored (the save payload only
writes what's in state; it does not recompute titles). So there is no data migration and no risk to
existing runs. This is called out as a task check and an explicit test-strategy note.

### D3 — play-web i18n keys (exact) + one justified literal
Add to **both** HE and EN `join` maps in `apps/play-web/src/i18n.ts`:
- `langToggleAria: 'החלף שפה'` / `'Switch language'` — replaces the L186 aria ternary
  (`aria-label={t.join.langToggleAria}`). An action-describing aria label in the current UI language
  is correct and avoids naming a target language.
- `removeMember: (name: string) => \`הסר ${name}\`` / `(name) => \`Remove ${name}\`` — replaces the
  L387 aria ternary (`aria-label={t.join.removeMember(m)}`).

The L189 button *text* `lang === 'he' ? 'English' : 'עברית'` names the language you switch **to**,
each written in its own script — this is a deliberate, non-switchable literal (the standard
language-switcher idiom). It gets a trailing `// i18n-ignore — language switcher shows the target
language in its own script` rather than a `t.*` key. This keeps `:strict` clean without pretending
the label is translatable.

### D4 — firestore.rules: `isRunParticipant` helper + narrowed reads (THE RULE CHANGE)
Add a helper next to `isStaffForRun`:
```
function isRunParticipant(uid, gameId, runId) {
  return request.auth != null
      && exists(/databases/$(database)/documents/users/$(uid)/games/$(gameId)/runs/$(runId)/teams/$(request.auth.uid));
}
```
Change the `feedItems` read rule from `allow read: if isAuthenticated();` to:
```
allow read: if isOwner(uid)
             || isStaffForRun(uid, gameId, runId)
             || isRunParticipant(uid, gameId, runId);
```
Apply the identical predicate to `announcements` and `flashMissions`.

**Why also announcements/flashMissions (justification):** they carry no PII (operational broadcast
copy), so their severity is low — but the rules' own comments already describe them as readable "by
any authenticated participant *in the run*"; the loose `isAuthenticated()` was simply broader than
the documented intent. There is no legitimate use case for a non-participant of run X to read run
X's live-ops. Since the `isRunParticipant` helper is already being added and its cost is one
document read per subscription, tightening all three aligns the rule with its stated intent for a
negligible cost. (feedItems is the priority — it is the only one leaking PII — but scoping the trio
together avoids leaving two half-open doors.)

**Shared-team-devices trade-off (explicit):** a run's *founder* has a team doc keyed by their uid,
so `isRunParticipant` matches them. A *secondary attached phone* (shared-team-devices) has a
different uid than the team-doc id (it appears in the team doc's `deviceUids`, not as the doc key),
so `exists(.../teams/{deviceUid})` is false — an attached device would lose feed/announcement read
access. Options weighed:
- **(a, chosen)** Accept that the founding device sees the feed; secondary devices don't read the
  raw collection. This is a minor, safe regression for a rare configuration and needs no schema
  change. It is recorded as an Open Question for follow-up.
- **(b)** Extend `isRunParticipant` to also allow when the requested team doc's `deviceUids`
  contains the caller — but a *list* query has no single `resource.data` to test `deviceUids`
  against, so this can't be expressed for the collection listener without per-doc constraints.
- **(c)** Mirror a run-membership marker readable by device uid, or move the read behind a
  `getRunFeed` callable that resolves device→team server-side. Bigger change; deferred (Non-Goal).

The rule change is the security-sensitive part of this proposal and is flagged again under
Risks/Trade-offs per config.

## Test Strategy

**A. i18n (UI lane — no runtime tests, preview + gate):**
- `npm run i18n:check` — PART A must stay clean (new keys added to both HE and EN maps with matching
  shapes; the `(n)`/`(name)` function keys must exist in both).
- `npm run i18n:check:strict` — must add **zero** new PART B findings; the three leak sites no
  longer appear, and the one intentional literal (JoinScreen L189) is silenced by `// i18n-ignore`.
- Preview verification: on creator-web, toggle Settings→English and confirm the dashboard
  visibility badges, the name-fallback, and the empty-description placeholder all switch; create a
  new stage in the Builder in each language and confirm the default title is localized while an
  existing game's saved stage titles are unchanged. On play-web, toggle language on the Join screen
  and confirm the toggle/remove aria-labels are present in the active language (the switcher text
  intentionally stays language-named).

**B. feedItems authz (emulator lane — extend the existing e2e authz coverage):**
`scripts/e2e-verify.mjs` already drives the feed end-to-end (§13, the "live photo feed" scenario)
using real anonymous participant tokens, a real staff/owner identity, a `feedStranger` party, and a
direct-Firestore `getColAt(feedCol)` helper (which reads subject to `firestore.rules`). Extend that
scenario with an authz block:
1. **RED first:** add an assertion that `feedStranger.getColAt(feedCol)` is **DENIED** — the read
   throws `permission-denied` (or yields no docs). Against today's `isAuthenticated()` rule the
   stranger read *succeeds*, so this assertion fails first (proves the hole exists).
2. Add the positive assertions: the run's participant (`fp.getColAt(feedCol)`) and the owner
   (`creator.getColAt(feedCol)`) **still return** the feed items (regression guard that the tighter
   rule didn't lock out legitimate readers). Wrap the stranger read in the suite's `expectError`/
   deny helper so a denial passes and an allow fails.
3. `npm run e2e` must be green (this scenario plus the untouched authz-denial-matrix,
   station-contention, and leaderboard-invariant scenarios).

This repo verifies rules through the emulator + e2e (there is no separate `@firebase/rules-unit-testing`
lane today), so the authz proof lives in `e2e-verify.mjs` alongside the other cross-identity denial
assertions.

## Risks / Trade-offs

- **[Rule change — security-sensitive]** Narrowing `feedItems`/`announcements`/`flashMissions` reads
  could over-block if `isRunParticipant` is wrong. Mitigation: the e2e scenario asserts BOTH the
  deny (stranger) and the allow (participant/owner) paths, so an over-tight rule fails CI as loudly
  as an over-loose one.
- **[Trade-off] Secondary attached devices lose raw feed/announcement reads** (D4). Accepted as a
  minor regression for a rare multi-phone setup; recorded as an Open Question. No PII is exposed by
  this trade-off — it only removes access, never grants it.
- **[Cost] One extra document read per feed/announcement listener** from the `exists()` in the rule.
  Negligible against the value of closing a cross-tenant PII leak.
- **[Risk] BuilderPage default change touching stored data.** Mitigation (D2): only new stages get
  the localized default; existing titles are never recomputed — verified by preview and noted as a
  task check.

## Migration Plan

Pure rules-and-strings change; no data migration. Rollout: deploy `firestore.rules` and the client
builds together (the client already reads the same collection; only the permission narrows). Rollback
is a straight revert of `firestore.rules` (and the i18n/UI edits) with no persisted-state cleanup.

## Open Questions

- Should shared-team secondary devices regain feed/announcement read access via a `getRunFeed`
  callable (or a device-keyed membership marker), or is founder-device-only acceptable long term?
  (Deferred — Non-Goal here; see D4 option c.)
- Should the remaining `isAuthenticated()`-scoped run subcollections (`trackables`, `zones`) also be
  narrowed for consistency even though they carry no PII? (Out of scope; flagged as a follow-up.)
