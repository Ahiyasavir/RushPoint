# Post-Game Feedback — design

## Context

FinalScreen ([FinalScreen.tsx](../../../apps/play-web/src/screens/FinalScreen.tsx)) renders once
`team.status === 'finished'`: trophy + score, recap stats, then — until the host finalizes — a
"waiting for the host to finalize" idle state, and after finalize the podium + leaderboard. The
Run Console ([RunConsolePage.tsx](../../../apps/creator-web/src/pages/RunConsolePage.tsx)) already
has a post-run AnalyticsPanel (loads `getRunAnalytics` on demand) and live-updates via `onSnapshot`
on the run doc. Participant-generated run data (SOS alerts, location pings) follows one pattern:
written ONLY by callables, stored in a run subcollection, owner-read-only in `firestore.rules`.
Teams can span multiple phones (shared-team-devices: `deviceUids`, `devices[{uid,name}]`).
There is no notification infra (no email/webhook) — the console IS the creator's surface.

## Goals / Non-Goals

**Goals:**
- A survey players *want* to finish: tap-only, one question per screen, auto-advance, < 45s,
  skippable at every point; free text only at the very end and optional.
- Per-player responses (each attached phone), exactly one per uid per run, server-enforced.
- Creator sees, per run: response rate, averages per dimension, recommend distribution, issue
  counts, all comments, and any individual's full response — auto-loaded once the run finishes.
- Same integrity rules as all run state: clients never write; owner-only reads.

**Non-Goals:** notifications, CSV export, editable responses, configurable question sets,
cross-run aggregation, mid-game surveys.

## Decisions

### D1 — Fixed question set, typed as data (not free-form schema)
Six tap questions + one optional free-text, hardcoded as a typed constant so the client renders
and the server validates from the same shape (`@rushpoint/shared`):

| key | prompt (HE) | input |
|---|---|---|
| `overall` | איך היה לכם? | 5 emoji (😖…🤩) → 1–5 |
| `content` | כמה התוכן והמשימות היו מעניינים? | 5 emoji → 1–5 |
| `bonding` | כמה המשחק גיבש אתכם? | 5 emoji → 1–5 |
| `difficulty` | רמת הקושי? | 3 chips: קל מדי / בדיוק / קשה מדי → 1–3 |
| `smoothness` | איך המשחק רץ טכנית? | 3 chips: חלק / קצת תקלות / הרבה תקלות → 1–3 |
| `recommend` | תמליצו לחברים? | 5 emoji → 1–5 |

When `smoothness < 3` a follow-up multi-select of **issue chips** appears (GPS/מיקום, העלאת
תמונה, קוד תחנה, הבנת משימה, איטיות/טעינה, אחר) → `issues: string[]` from a fixed enum. Last
step: optional free text (`comment`, ≤ 1000 chars) with the prompt "רעיון? באג? משהו לשפר?".
Every answer is optional — skipping a question records nothing for it; the final "שליחה" submits
whatever was answered. *Why fixed?* A survey builder is a product unto itself; a curated set keeps
the aggregation typed, comparable across runs later, and the UX tight.

### D2 — Per-player doc keyed by uid: `runs/{runId}/feedback/{uid}`
`RunFeedback = { uid, teamId, teamName, memberName?, ratings: Partial<Record<RatingKey, number>>,
issues?: FeedbackIssue[], comment?: string, lang, createdAt }`. Doc id = caller uid makes
duplicate-prevention a transaction on one doc (create-only), and shared-team-devices gives us the
respondent's display name from `team.devices`. New `FIRESTORE_PATHS.feedback(ownerUid, gameId,
runId, uid)` + `feedbackCol(...)`. *Alternative rejected:* per-team doc — loses the whole point of
multiple players per team; the user explicitly wants "כל מי ששיחק".

### D3 — `submitRunFeedback` (participant callable)
`{ ...ctx|code, ratings, issues?, comment?, lang }` → resolve the caller's team via
`resolveCallerTeam` (any attached device — viewers included, **no** controller gate: feedback is
personal); require `team.status === 'finished'` OR `run.status === 'finished'` (the survey shows
during the waiting-for-finalize window); validate ratings against the fixed keys/ranges, issues
against the enum, comment length-capped and required non-empty ratings∪comment (an all-empty
submit is `invalid-argument`); create-only transaction on `feedback/{uid}` — a second submit
returns `{ok:true, already:true}` without changing the stored doc. Rate budget
`submitRunFeedback: {max:3, windowMs:MIN}` (retry headroom; the doc-level create-only guard is
the real once-only lock).

### D4 — `getRunFeedbackSummary` (owner-only callable), aggregation as pure logic
Owner-gated exactly like `getRunAnalytics`. Reads all `feedback` docs + team count, and returns
`{ summary, responses }` where `summary = computeFeedbackSummary(responses, participantCount)`
— a **pure function** in `functions/src/runs/feedbackSummary.ts`:
- `responseCount`, `participantCount`, `responseRate` (guard ÷0)
- per rating key: `{ avg, count, distribution: number[] }` (skip-aware: avg over answered only;
  never NaN — omit keys with zero answers)
- `recommendScore`: % of recommend answers ≥ 4 (simple promoter share, honest at playtest N)
- `issueCounts: Record<FeedbackIssue, number>`, `commentCount`
Individual responses ride along in the same payload (runs cap at ≤50 participants — one read
burst, no pagination needed), so drill-down costs no extra callable. *Why pure?* It's the TDD
vitest lane, and it keeps the callable a thin shell.

### D5 — play-web `PostGameSurvey` (new component, mounted in FinalScreen)
Mounted right after the score/recap card — visible in BOTH the waiting-for-finalize state and the
post-podium state (the wait is the highest-attention slot). A warm card, not a modal: big emoji
buttons (tap → subtle pop animation → auto-advance after ~250ms), progress dots, a small "דלגו"
per question and "לא עכשיו" to dismiss the card entirely. After submit (or `already:true`) →
compact thank-you ("🙏 תודה! זה עוזר לנו להשתפר") and the card collapses. Local dismissal/completion
is remembered in localStorage (`rushpoint.feedback.<runId>`) so the card never re-nags across
reloads — the server guard stays authoritative. All strings via `t.final.survey*` (HE+EN);
`dir="auto"` on the free text.

### D6 — creator-web FeedbackPanel in RunConsolePage
A sibling card to AnalyticsPanel that mounts once `run.status === 'finished'` and fetches
automatically (no click — this is the "summary that runs to me at every game end"): header with
response rate ring ("7/12 ענו"), a row of dimension tiles (emoji + avg, e.g. "😍 4.4 חוויה"),
difficulty/smoothness chip breakdowns, issue-count chips (highlighting anything > 0 as a bug
signal), then the comments list (team + name + text). Clicking any respondent row opens a small
modal with their complete response. Empty state: "עדיין אין תשובות — השאלון מוצג לשחקנים במסך
הסיום". Strings via `t.runConsole.feedback*` (HE+EN).

### D7 — Rules + retention
`firestore.rules`: `match /feedback/{docId} { allow read: if isOwner(uid); allow write: if false; }`
(participants don't read each other's feedback; the thank-you state needs no read-back). The
90-day PII prune deletes run subcollections wholesale — feedback (which contains free text)
correctly dies with the run; no prune changes needed, but the e2e prune scenario must not break.

## Test strategy (TDD lanes)

1. **Pure (RED first)** — `functions/src/runs/feedbackSummary.test.ts` (vitest, co-located):
   `validateFeedbackPayload` (unknown rating key / out-of-range value / bad issue / oversized or
   empty payload → typed errors; partial ratings OK) and `computeFeedbackSummary` (empty → zeroed
   summary with no NaN; skip-aware averages; distributions; responseRate incl. participantCount=0
   guard; recommendScore; issueCounts). Written first, must fail (module missing).
2. **Callable (RED first)** — new `scenario('post-game feedback', …)` in `scripts/e2e-verify.mjs`
   using the smart-suite helpers (`check`/`expectError`): submit before the team finishes →
   `failed-precondition`; controller submits after finish → ok; **viewer device** submits its own
   → ok (two responses, one team); duplicate submit → `already:true`, stored doc unchanged;
   garbage ratings → `invalid-argument`; owner summary → responseCount 2, correct avg, comment
   visible, respondent identities present; non-owner calls `getRunFeedbackSummary` →
   `permission-denied`.
3. **UI** — preview on :5181 (finish a mini-run → survey card in the waiting state → tap through
   → thank-you; duplicate-block on reload) and :5180 (console shows the summary + drill-down
   modal); `npm run i18n:check` + `npm run i18n:check:strict` — zero new findings. Note the
   ui-text-standards no-dashes rule for every new string.

## Risks / Trade-offs

- [Survey fatigue / feels like a chore] → tap-only, ≤7 steps, skippable everywhere, shown once,
  and parked in dead waiting time rather than blocking anything.
- [Sparse data at small N] → show counts next to every average; responseRate front and center so
  the creator reads "4.5 מתוך 3 תשובות" honestly.
- [Free text is PII-ish] → owner-only reads; dies in the standard 90-day prune.
- [Same uid, two runs] → doc is per-run (path-scoped), localStorage key is per-runId; rate budget
  is per-minute so back-to-back runs still work.
- [e2e file contention] → `scripts/e2e-verify.mjs` is co-owned by the in-flight e2e-smart-suite
  work; the new block must be added on top of the current working-tree harness (scenario style),
  not the old linear style.

## Migration Plan

Purely additive (new subcollection, new callables, new UI). Deploy functions + rules in any
order; old clients simply never call the new endpoints. Rollback = hide the two UI panels.

## Open Questions

None blocking. (Cross-run feedback trends and CSV export are natural v2s; a creator-authored
custom question could be added to the fixed set later without schema upheaval.)
