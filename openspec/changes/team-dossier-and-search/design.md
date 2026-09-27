## Context: where each piece already is

| Team page section | Source already streamed by the console | Notes |
|---|---|---|
| Members, phones, sender | team doc: `memberNames`, `devices`, `controllerUid`, `registrationData` | keep the full doc instead of projecting two fields |
| Current mission + time on it | team doc: active stage record `assigned` + `startedAt` | titles from the game doc already loaded |
| Timeline | team doc `stages[].tasks[]` (`status`, `startedAt`, `completedAt`, `earnedScore`, `skipCause` after `skip-keeps-the-stage`) | |
| Answers given | `RunTaskRecord.answerLog` (owner-only by the participant sanitizer, present in the owner's direct read) | reuse `runPlayerReport` helpers for formatting |
| Media | `taskSubmissions` + `mediaGalleryRows` | approve/reject/undo reuse the photo-review actions |
| Chat | run chat stream, filtered to the team | reuse `ChatPanel`'s thread renderer |
| Location | `LiveTeamMap`'s `teamLocations` stream | lift the listener to the page so the map and the team page share one stream |
| Score reasons | **missing** | D2 |

## Decisions

### D1: one view-model, no markup decisions

`lib/teamDossier.ts` (pure, total): `buildTeamDossier({ teamDoc, game, submissions, chatThread,
location, nowMs, rank })` → a plain object the component renders. Unknown fields never reach the
screen (the `galleryTaskDetail.ts` copy-out pattern). Clock injected, like `teamAttention`.

The console's teams listener keeps the full `RunTeam` in a `Map<teamId, RunTeam>` (memory only; the
bytes already arrive). The existing projections derive from it.

### D2: the score ledger

`RunTeam.scoreLedger?: { at: string; delta: number; kind: 'adjust' | 'hint' | 'skipAward' | 'reversal'; reason?: string; by?: string; taskId?: string }[]`,
appended inside the transaction that already moves the score (`adjustTeamScore`, `requestTaskHint`,
`skipTaskForTeam`, `skipStage`, the approval reversal), capped at the latest 100 entries (whole-array
rewrite, never a dotted array update). `by` is the operator's display name (`staffName` claim or
"organizer"), never a uid. Earned mission points are NOT duplicated here: the timeline already shows
them per mission. Participant sanitizer: not allow-listed (organizer-facing reasons can be blunt;
showing players their own ledger is a separate decision).

Read cost: zero (the team doc is already streamed). Write cost: none added (same transaction, same doc).
Size: 100 × ~150 B ≈ 15 KB worst case, far below the 1 MiB document limit even with answer logs.

### D3: drawer, sheet, URL

Desktop (`lg`): a right-side (RTL: left) drawer, 480 px, over the console; the list stays visible and
clicking another row swaps the drawer. Phone: a full-screen sheet with a back button. The open team
lives in the URL (`?team=`), so browser back closes it. Focus trap, Esc closes.

### D4: search, filter, sort

`lib/teamSearch.ts` (pure): `searchTeams(rows, { query, filter, sort })`. Query matches, case-folded
and trimmed: team name, member names, device names, `deviceJoinCode`. Hebrew has no case; the
`staffTeamFilter` note applies. Filters reuse existing verdicts (`teamAttention` stuck/watch,
pending reviews count, launched, finished). Sort keeps a stable order while typing (the staff
console's lesson: rows must not jump under the thumb). Search box appears when there are more than
6 teams; always available via `/`.

### D5: actions in the page

Each action calls the SAME function the console already uses (`adjustScore`, `skipTeamTask`,
`letTeamBackIn`, review, chat send), so there is one code path per action. The chat composer sends
with `sendTeamChatMessage` (existing).

## Test strategy

- Pure (vitest, `apps/creator-web/src/lib/__tests__/teamDossier.test.ts` + `teamSearch.test.ts`):
  dossier from a realistic team doc (every section), from a malformed doc (never throws, unknown
  fields absent), current-mission timer from an injected clock; search across the four fields,
  Hebrew and Latin, filters, stable sort.
- e2e (`scripts/e2e-verify.mjs`): after `adjustTeamScore` with a reason, the team doc carries one
  ledger entry with `delta`, `reason`, `by`; after a paid hint, a `hint` entry; after
  `skipTaskForTeam`, a `skipAward` entry equal to the consolation; ledger capped at 100 (loop);
  `getMyTeamState` does NOT include `scoreLedger` (sanitizer).
- UI via preview at 375 and 1400: open a team from the list, every section renders for a team with
  media, answers and chat; approve from inside the page; search "דנ" finds a team by member name;
  refresh keeps the page open (`?team=`). `i18n:check:strict`, tap-target guard green.
