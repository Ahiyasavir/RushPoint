## Why

Announcements are all-or-nothing: `pushAnnouncement` broadcasts to every team, so an
organizer can't nudge ONE team ("Team Falcon — your next station moved") without
spamming the whole run. Worse, `adjustTeamScore` silently changes a team's standing —
the team learns about a +50 bonus only if they happen to squint at the leaderboard.
Both gaps have the same shape: the announcements channel needs a per-team address.

## What Changes

- **`pushAnnouncement` gains an optional `teamId`**: the announcement doc carries
  `teamId` and the play-web `LiveOps` panel shows an item only when it is global
  (`teamId` absent) or addressed to the viewer's own team.
  - Enforcement is **client-side by design**: Firestore rules cannot filter query
    results per-document, and a team-targeted announcement is NOT a secret (it is
    operational copy, never an answer key). This trade-off is documented in the
    rules comment and the type doc.
- **RunConsole composer gains a team picker** — "All teams" (default) or any joined
  team (the team list is already loaded on the page).
- **`adjustTeamScore` becomes visible to the team**: after its existing transactional
  `bonusPenalty` write + audit log, it ALSO writes a team-targeted score notice into
  the same `announcements` collection — `{kind:'score', teamId, delta, reason}` —
  which play-web renders as a toast-style banner: "+50 · Great teamwork". No new
  collection, no new callable, delivery rides the existing announcements listener.
- Announcement docs gain a discriminating `kind` (`'announcement' | 'score'`,
  absent ⇒ `'announcement'` for every pre-existing doc).

## Capabilities

### New Capabilities
- `targeted-announcements`: optional `teamId` on announcements; the pure
  `announcementVisibleTo` predicate + `formatScoreNotice`; the RunConsole team
  picker; the `adjustTeamScore` score-notice write; the play-web per-team filter and
  score toast.

## Non-goals

- No server-side read filtering (rules can't do it; the content is not secret) and
  no per-team subcollections — one collection, one listener, client filter.
- No new callable and no change to `buildRankings` / scoring math —
  `adjustTeamScore`'s scoring mechanism (`bonusPenalty`) is untouched; only a
  notification is added.
- No targeting of flash missions (announcements only, v1).
- No delivery receipts / read-tracking; dismissal stays local-only as today.
- No multi-team ("these 3 teams") addressing — one team or all (v1).

## Surfaces touched

- **shared:** `Announcement` type gains `teamId?`, `kind?`, `delta?`;
  `announcementVisibleTo` + `formatScoreNotice` in
  `packages/shared/src/announcements.ts`.
- **functions:** `pushAnnouncement` (validate + persist `teamId`) and
  `adjustTeamScore` (append the score-notice write) in `functions/src/index.ts` —
  changed callables, **no new callable** (coverage guard list unchanged).
- **creator-web:** RunConsole announcement composer team picker + i18n EN/HE.
- **play-web:** `LiveOps.tsx` visibility filter + score-toast rendering + i18n EN/HE.
- **rules:** none (read stays `isAuthenticated()`; documented comment only).
- **Tests:** `scripts/test-targeted-announcements.ts` (pure); extended assertions in
  the existing e2e announcement + adjust-score flows.
