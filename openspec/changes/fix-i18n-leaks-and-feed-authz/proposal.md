## Why

Two independent correctness defects surfaced in a senior review, grouped here because both are
"a string/permission that should be governed by our existing machinery but bypasses it":

**A. Hardcoded UI strings that break the Hebrew↔English switch.** Several user-facing strings are
written as literals in components instead of coming from each app's `i18n.ts` (`t.*`). They stay
in one language no matter the selected UI language — the recurring "English in the Hebrew app" (or
the inverse) bug the i18n gate exists to catch:
- `apps/creator-web/src/pages/DashboardPage.tsx` — a creator-name fallback `'יוצר'` (line 113),
  the `'ציבורי'`/`'פרטי'` visibility badge labels (line 197), and the `'אין תיאור עדיין.'`
  empty-description placeholder (line 202) are hardcoded Hebrew — they never become English on the
  Settings→English switch.
- `apps/creator-web/src/pages/BuilderPage.tsx` — `blankStage()` defaults a new stage's title to
  the English literal `` `Stage ${order + 1}` `` (line 38). Worse than a display leak: this string
  is **persisted into stored game data** via the save payload, so a Hebrew-UI creator silently gets
  English stage titles baked into their game.
- `apps/play-web/src/screens/JoinScreen.tsx` — inline `lang === 'he' ? … : …` ternaries for the
  language-toggle aria-label (line 186) and the remove-member aria-label (line 387) hand-roll
  translation in the component instead of going through the `t.*` dictionary. They are bilingually
  *correct* today but bypass the single source of truth, so they drift and are invisible to the
  i18n tooling.

**B. Cross-tenant read exposure of the live photo feed.** `firestore.rules` lets **any
authenticated user** read a run's `feedItems`, `announcements`, and `flashMissions`
(`allow read: if isAuthenticated()`, lines ~71/76/84). `feedItems` docs carry participant
**`photoUrl`s** (written by `writeFeedItem` in `functions/src/index.ts`, ~lines 622-642) and team
names. Because the collection path is `users/{ownerUid}/games/{gameId}/runs/{runId}/feedItems` and
`FeedPanel.tsx` reads it with a direct client `onSnapshot`, a user who knows or guesses another
tenant's `ownerUid/gameId/runId` can subscribe to that run's live photo feed — a PII leak across
tenants. The rule's own comment says the feed is meant for "the run", but the rule never enforces
run membership.

## What Changes

- **Route every leaked string through `t.*`.** Add the missing keys to each app's `i18n.ts`
  (both HE and EN dictionaries) and replace the literals/ternaries in `DashboardPage.tsx`,
  `BuilderPage.tsx`, and `JoinScreen.tsx` with `t.*` lookups. The BuilderPage stage-title default
  becomes a localized dictionary function; **existing stored stage titles are untouched** — only
  the default applied to *newly created* stages changes, so no existing game is rewritten.
- **Tighten the `feedItems` read rule to run participants + run-scoped staff + owner only.** Add an
  `isRunParticipant(uid, gameId, runId)` rules helper that confirms the requester owns a team doc
  in *that* run (`exists(.../runs/{runId}/teams/{request.auth.uid})`), and require
  `isOwner(uid) || isStaffForRun(...) || isRunParticipant(...)` to read `feedItems`. Apply the same
  scoping to `announcements` and `flashMissions` (defense-in-depth; they are lower-severity
  operational copy with no PII, but there is no legitimate cross-tenant reader — see design for the
  justification and the shared-device trade-off).
- **No new callable, no schema change, no client-write path.** `feedItems`/`announcements`/
  `flashMissions` stay CF-write-only and are still read client-side via the existing listeners; only
  the read *predicate* narrows.

## Capabilities

### New Capabilities
- `run-content-access` — a small cross-cutting capability that captures two standing guarantees this
  change makes concrete: (1) all user-facing text is switchable via `t.*`, and (2) a run's live
  content feed is readable only by that run's participants/staff/owner.

### Modified Capabilities
(none — this hardens existing surfaces rather than adding a feature; the `live-photo-feed`
capability's read audience is narrowed, not changed in shape.)

## Impact

- `apps/creator-web/src/i18n.ts` — add dashboard keys (`creatorFallback`, `visPublic`,
  `visPrivate`, `noDescription`) and a builder key (`stageDefaultTitle(n)`) to both HE and EN maps.
- `apps/creator-web/src/pages/DashboardPage.tsx` — replace 3 hardcoded literals with `d.*`.
- `apps/creator-web/src/pages/BuilderPage.tsx` — `blankStage()` reads the localized default title.
- `apps/play-web/src/i18n.ts` — add `join.langToggleAria` and `join.removeMember(name)` to both maps.
- `apps/play-web/src/screens/JoinScreen.tsx` — replace 2 inline `lang === 'he' ? …` ternaries with
  `t.join.*`; the language-name switcher literal (`'English'`/`'עברית'`, line 189) is a deliberate
  target-language-in-its-own-script label and gets a `// i18n-ignore` with reason (see design).
- `firestore.rules` — **a security-rule change** (per config, called out explicitly): add
  `isRunParticipant(...)` helper; narrow the `feedItems` (and `announcements`/`flashMissions`) read
  rules. No other collection's rules change.
- Test surface: `npm run i18n:check` / `:strict` (UI), and an extension of the e2e authz coverage
  in `scripts/e2e-verify.mjs` proving a stranger is DENIED reading run X's `feedItems` while a
  participant/staff/owner of run X is ALLOWED.

## Non-goals

- Does NOT convert the feed read to a callable (`getRunFeed`) — the fix stays a rules tightening on
  the existing client listener.
- Does NOT change what `feedItems` store or how they are written; no change to `writeFeedItem`.
- Does NOT re-scope the other broadly-readable run subcollections named in the rules
  (`trackables`, `zones`, `benchmarks`, `accessCodes`) — those render live/public data with no
  per-run PII and are out of scope here (notable as possible follow-ups, not part of this change).
- Does NOT retranslate or migrate any already-stored game data (existing stage titles stay as saved).
- Does NOT touch scoring, routing, or any callable behavior.
