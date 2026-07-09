# Design — targeted-announcements

## Data model (packages/shared/src/types/index.ts)

`Announcement` gains three optional fields — every existing doc stays valid:
```ts
export interface Announcement {
  // …existing…
  teamId?: string;            // absent ⇒ global broadcast (all teams see it)
  kind?: 'announcement' | 'score';  // absent ⇒ 'announcement' (back-compat)
  delta?: number;             // kind==='score' only: the applied adjustment
}
```
`teamId` is deliberately **not secret** — Firestore rules cannot filter documents in
a collection read, so visibility is a client courtesy, not an access control. Any
authed run participant could technically read another team's notice; it never
contains answer keys or scoring internals beyond the delta the audit log already
records. Documented on the type and in the rules comment.

## Pure helpers (packages/shared/src/announcements.ts)

```ts
// The single visibility rule both the play client and tests share:
announcementVisibleTo(a: Pick<Announcement,'teamId'>, myTeamId: string): boolean
//   → !a.teamId || a.teamId === myTeamId

// Deterministic score-notice copy (bilingual, sign-aware):
formatScoreNotice(delta: number, reason: string | undefined, lang: 'en' | 'he'): string
//   → "+50 · Great teamwork" / "־25 · איחור לנקודה" (sign always rendered, reason optional)
```

## Server (functions/src/index.ts)

- **`pushAnnouncement`**: destructure optional `teamId`; when present,
  `validate(() => requireString(teamId, 'teamId', 128))` and verify the team doc
  exists at `FIRESTORE_PATHS.team(ownerUid, gameId, runId, teamId)` (one read —
  refuse `not-found` so a typo'd console call can't silently broadcast to nobody).
  Persist `...(cleanTeamId ? { teamId: cleanTeamId } : {})` and `kind:
  'announcement'` on the doc. The `mirrorToChat` Slack/Teams mirror prefixes the
  targeted team's name so the ops channel sees who it addressed.
- **`adjustTeamScore`**: AFTER the existing transaction + `writeAuditLog` (both
  untouched — the scoring mechanism remains `bonusPenalty`, per repo lesson), append
  one plain doc create into the run's `announcements` collection:
  ```ts
  { id, kind: 'score', teamId, delta, reason: cleanReason,
    message: formatScoreNotice(delta, cleanReason, 'en'),
    messageHe: formatScoreNotice(delta, cleanReason, 'he'),
    active: true, createdAt, createdBy: context.auth!.uid }
  ```
  Plain `.set()` on a new doc — no transaction added, no `buildRankings` change, no
  team-doc field change. If this write fails the adjustment has already landed
  (score integrity first); best-effort notification.

## creator-web (RunConsolePage.tsx)

The announcement composer (around `sendAnnouncement`, ~line 312) gains a `<select>`
fed by the page's already-loaded `listRunTeams` result: first option "All teams"
(value `''`), then each team's `displayName`. `sendAnnouncement` passes
`...(teamTarget ? { teamId: teamTarget } : {})`. Strings via `t.runConsole.*` EN+HE.
Typed wrapper `pushAnnouncement` in `apps/creator-web/src/services/calls.ts` gains
the optional `teamId` param (same for the staff-console wrapper if it exposes one).

## play-web (components/LiveOps.tsx)

- The announcements listener already receives every active doc; add
  `.filter((a) => announcementVisibleTo(a, myTeamId))` before rendering
  (`myTeamId` is already a prop).
- `kind === 'score'` renders a distinct toast-style banner (accent ring, `💯`/sign
  icon, `font-mono` delta + reason, `dir="auto"`), dismissible like the rest.
  Client-side, score notices also auto-hide once older than 10 minutes (computed
  from `createdAt` against the existing 1s `now` tick) so stale bonuses don't pile
  up on late joiners; global announcements keep today's persist-until-dismissed
  behavior.

## Rules
No change. Add one comment line under `match /announcements` documenting that
`teamId` filtering is client-side and the field is non-secret.

## Test strategy
- **Pure (TDD RED→GREEN):** `scripts/test-targeted-announcements.ts` —
  `announcementVisibleTo` truth table (no teamId ⇒ visible to anyone; own team ⇒
  visible; other team ⇒ hidden; empty-string teamId treated as global) and
  `formatScoreNotice` (positive/negative sign, with/without reason, en + he output
  is in the right language). Auto-run by `npm test`.
- **Callable (e2e):** extend the existing lifecycle scenario in
  `scripts/e2e-verify.mjs` (no new callable — coverage guard untouched):
  1. `pushAnnouncement` with `teamId` of a joined team ⇒ doc persists
     `teamId`/`kind`; with a bogus `teamId` ⇒ `not-found`; without ⇒ doc has no
     `teamId` (global unchanged).
  2. `adjustTeamScore(+50, 'great teamwork')` ⇒ (existing) `bonusPenalty`
     decremented + audit row, PLUS a new `kind:'score'` announcement with
     `delta: 50`, that team's `teamId`, bilingual messages, `active: true`.
  3. Authz matrix already covers `pushAnnouncement`/`adjustTeamScore` callers —
     re-run unchanged.
- **UI:** preview the composer picker (all-teams default) and the score toast +
  own/other-team filtering on two play sessions; `npm run i18n:check` clean.

## Footguns respected
- `adjustTeamScore`'s transaction and `bonusPenalty` sign convention untouched —
  the notice is written OUTSIDE the transaction, after commit.
- New doc creates only — no `.set({merge})` dotted keys, no array updates.
- No leaderboard math changes; live/final parity (`buildRankings`) unaffected.
