# UX/UI Continuous Improvement Queue

Single-agent autonomous loop. Pick top item → refactor → gate → mark DONE → next.
**Gate for every item:** `npm run verify` (typecheck · lint · test · both builds · bundle · base ·
origin · i18n:check:strict). Add `npm run e2e` when a callable changes.

## Audit baseline (2026-08-21)
- i18n strict gate: GREEN (PART A + PART B clean).
- creator-web physical-direction classes: 5 (all decorative `absolute` positioning — not RTL bugs).
- creator-web unlabelled icon buttons: 0.
- creator-web `onClick` on non-interactive elements: 25 (mostly modal backdrops; several of the
  flagged "cards" already carry `role="button"` + `tabIndex` + `onKeyDown`, so the scanner
  over-reports here — see item 3).
- creator-web reversed-`zinc` colour usages: 32 → now 12, all on FIXED-LIGHT legacy surfaces.

### The finding that reframed the contrast work
`tailwind.config.js` REVERSES the zinc scale (`text-zinc-700` = `#d6d3d1`), and `useDarkMode()`
in `App.tsx` defaults to the OS setting — so **dark mode is the default for any creator whose OS
is dark**, no opt-in. Every `text-zinc-*` sitting on a THEMED (`--surface-*`) surface is therefore
near-black on near-black for those creators. The legacy `bg-app-*` / `bg-glass-*` surfaces do NOT
flip, so zinc on those is fine and was deliberately left alone.

## Queue

### 1. [DONE] P0 — Landing page hero mockup rendered near-invisible text
`components/AuthGate.tsx`. `text-zinc-800` (#e7e5e4) and `text-zinc-700` (#d6d3d1) on `bg-white`
= ~1.1:1 and ~1.3:1 — the two bold labels were unreadable, and `bg-zinc-200` (#292524) painted
the *incomplete* progress segment near-BLACK so it read as complete. First thing every
prospective creator sees. Fixed with theme-independent literals (NOT `--ink-*`: the mockup's
surfaces are hardcoded light, so a token would re-break it under `html.dark`).

### 2. [DONE] P0+P2 — Contrast sweep of every reversed-zinc text site (merged item 6)
`TaskLibrary.tsx` metadata row was `text-zinc-600` (#a8a29e ≈ 2.4:1) — migrated, with the rest of
that panel, to `--ink-*`. Also migrated the sites on themed surfaces: `dialog.tsx` (**every
confirm/alert dialog's message body was invisible in dark mode**), `QuizChoicesEditor.tsx`, and
four `BuilderPage.tsx` sites. The 12 remaining are on non-flipping legacy surfaces and clear AA.

### 3. [DONE] P0 (user request) — "בדיקה" now opens the GAME, not the organizer console
> *"instead of the בדיקה button … it should bring you straight to your game play (exactly how it
> looks when you play the game) instead of showing a QR code and the regular admin panel which is
> no different than doing a run"*

Three parts:
- **`functions/src/runs/index.ts` — `joinRun` self-starts a test-drive run.** Previously a team
  joining ANY run was written `launched: false` and sat on "waiting for the organizer to start"
  until the creator went back to the console and pressed Start — a dead end for a rehearsal.
  Gated on `run.isTestDrive` (written by exactly one place), and guardian consent still falls back
  to the normal wait rather than bypassing the check.
- **`apps/play-web`** — `?code=X&testdrive` resolves to a join route flagged `autoJoin`
  (`lib/playRoute.ts`); `lib/testDriveAutoJoin.ts` is the pure decision; `JoinScreen` joins on the
  creator's behalf behind a short "opening your game" state. The URL flag carries NO authority —
  the SERVER's `isTestDrive` is the gate, so forging it on a real code does nothing.
- **`apps/creator-web/src/pages/BuilderPage.tsx`** — the test-drive branch opens the participant
  app in a new tab (parked pre-await so Safari/Firefox don't block it, closed on every bail-out
  path, falls back to same-tab navigation if blocked) and leaves the Builder where it was.

Tests: `scripts/test-test-drive-autojoin.ts` (new, auto-discovered by `npm test`).
`npm run verify` GREEN · `npm run e2e` ALL PASS (107/107 callables covered).
**VERIFIED LIVE** against the local emulator stack: pressing בדיקה landed straight on the
playable game — test-run banner, first mission already assigned, no QR, no registration form,
no "waiting for the organizer". Answering it scored 0→100 and routed to the next mission.
Server state confirmed: run `isTestDrive:true, billingType:'test', maxParticipants:2`;
team `launched:true, status:'active', activeTaskId:'task-1'`.

### 4. [DONE] P1 — No a11y regression gate for creator-web
play-web has `scripts/test-play-a11y-scan.ts`; creator-web (34k lines vs 15k) has none, so items
1-2 can silently come back. Added `scripts/lib/creatorContrastScan.ts` (pure) + `scripts/test-creator-a11y-scan.ts`. The
zinc rule is a BAN with two declared escapes (a static-light `bg-app-*`/`bg-glass-*` in the same
class literal, or a 3-entry file allowlist that each state why). Proved non-vacuous: run against
`git show HEAD:` it reports all 17 pre-fix defects. The generic markup scanners are reused from
play-web so the two apps cannot drift, with a ratchet-down baseline of 25 for clickable
non-interactive elements.

### 5. [DONE] P1 — Builder spotlight step counter read "5/2", and could never be dismissed
Found by hand while verifying item 3. `last` is captured from a render, so a burst of taps (an
impatient double-tap, a laggy phone) all took the "not last" branch and each ran `i + 1`, walking
`index` past the end — the step itself was clamped, so the visible symptom was just a wrong
counter, but the real damage was that no further tap could reach `finish()`. Clamped the
increment inside the updater; regression assertions added to `scripts/test-builder-spotlight.ts`.
`CreatorTour` was checked for the same class and is safe (a proper reducer, already clamped).

### 6. [DONE] P1 — Keyboard reachability of the clickable non-interactive elements
Audited all 25 individually. The scanner over-reports here, and the honest breakdown is:
- **3 are already correct** — `TaskLibrary` rows, `GalleryPage` x2 carry `role="button"` +
  `tabIndex` + `onKeyDown` (a `<div>` on purpose: they contain nested interactive controls, and
  nested interactives inside a `<button>` are invalid HTML and unreachable in Safari).
- **2 are dnd-kit drag handles** (`StageRail`, `TaskCard`) — the spread `{...attributes}` supplies
  `role`/`tabIndex`, and dnd-kit's keyboard sensor drives them.
- **20 are modal backdrops.** For a backdrop, the keyboard equivalent is not a focusable scrim —
  it is **Escape**. So that became the real question, and the answer was bad: of ten dismissible
  overlays, **six had no Escape handler at all**, including the delete-game confirms on BOTH the
  dashboard and the trash page. `ExclusiveGroupsModal` called it "the modal conventions the rest
  of creator-web already follows" — but the convention was copy-pasted into four components and
  simply missing from the rest.

Added `hooks/useModalDismiss.ts` (Escape + optional focus capture/restore) and wired the seven
gaps: ShareSheet, TaskLibrary, TaskWizard's expanded map, BuilderSpotlight, RunConsole's feedback
drill-down, TrashPage's purge confirm, and BOTH DashboardPage modals.

Gated by a new `findOverlayWithoutEscape` scanner in the creator a11y suite. Proved non-vacuous
against `git show HEAD:` — and that check earned its keep: the first regex matched only
`fixed inset-0` and silently reported 0 findings for BuilderSpotlight, whose scrim is an
`absolute inset-0` child. Widened, then re-confirmed it catches all 7.

**Verified live**: opening the new-game modal and dispatching a real `keydown`/Escape on `window`
closes it. (The browser harness's own key press never reaches the page — `keysSeen: []` — because
the pane isn't focused; that is a harness limitation, not a result.)

*Known limitation, deliberately not solved:* nesting is the caller's job via the `active` flag
(TaskLibrary passes `detail === null`). A shared modal-stack registry would remove the class, but
effect order runs child-before-parent, so a stack would pick the wrong "top" for two overlays
mounted in the same commit — worse than an explicit flag. Documented in the hook.

### 7. [DONE] P1 — Immediate visual feedback on every async action
Swept both apps. Mostly a clean bill of health — the codebase is disciplined here (`useAsyncAction`
or a local `busy` driving `loading`/`disabled`; `FeedPanel`'s react/report/mute are optimistic,
which is better than a spinner). ONE real gap: `FeedPanel`'s `hide`/`restore` waited on the server
with no pending state AND swallowed the failure. Both problems bit hardest in the exact situation
those buttons exist for — a photo on a screen that should not be up: a slow tap looked ignored, so
the moderator tapped again onto a second confirm dialog over an in-flight call; and a FAILED hide
said nothing at all, so they walked away believing the photo was gone while it was still live.
Added per-item pending state (per item, so one card can't freeze the rest) and localized failure
copy in HE+EN.

**Bundle budget:** these additions put play-web's entry chunk 45 B (0.005%) over the raw budget.
Lazy boundaries all held and gzip was still under, so per the ratchet rule in
`scripts/check-bundle-budget.mjs` the raw number moved 975,000 → 980,000 **with a note**. Recorded
there: the gzip lines are now the tight ones (entry ~1 KB, initial ~166 B of headroom), and the
next size increase should be answered by splitting the entry chunk (the Hebrew/English
dictionaries both ship in it), not by another ratchet.

### 8. [DONE] P2 — Empty / error states audit -> became a systemic token-contrast fix
The empty states themselves are in good shape: every creator-facing `EmptyState` has a title, a
body, and an action where one makes sense (Gallery offers "clear search", Runs offers "build a
game"). The only thin ones are `AdminUsersPage` / `AdminTemplatesPage` — admin-only, left alone.

But reading `EmptyState` led somewhere much bigger. Its body renders in `--ink-3`, so I measured
the token, and then all of them:

| token | light (was -> now) | dark (was -> now) | bar |
|---|---|---|---|
| `--ink-1` | 19.44 | 16.79 | AA 4.5 ✓ |
| `--ink-2` | 9.90 | 6.40 | AA 4.5 ✓ |
| **`--ink-3`** | **3.79 -> 5.75** | **2.42 -> 5.54** | AA 4.5 |
| **`--ink-4`** | **2.28 -> 3.82** | **1.82 -> 3.73** | 3:1 non-text |

`--ink-3` carries nearly all the secondary copy in the product — help lines, hints, metadata,
empty-state bodies — and it failed AA in BOTH themes, worst in dark, which is the default for
anyone whose OS is dark. 16 token/surface pairs were below bar.

Fixed by darkening/lightening each along its own hue (`#7B82A0`->`#60657D`, `#464D6E`->`#81869C`)
so the palette's character is unchanged. `--ink-4` is deliberately held to the **3:1 non-text**
bar, not 4.5 — at AA it would be indistinguishable from `--ink-3` and the token would have no
reason to exist; its contract (a count or glyph beside an already-labelled control, never prose)
is now written beside it in `index.css`.

**Why it drifted:** play-web's a11y scan asserts AA over the tokens in its *tailwind config*, and
creator-web keeps its ink in `index.css` — so nothing ever read them. The new gate parses that
stylesheet directly. Proved non-vacuous: it flags all 16 pre-fix violations.

**Verified live** in the running app, both themes: `--ink-3` reads 5.75:1 light / 5.54:1 dark.

## Remaining
- **P2** `AdminUsersPage` empty state has no body and no "clear search" action when a query is
  active (Gallery does this well). Admin-only, so low value.
- **P2** The `--ink-4` contract is documented but not enforced — nothing stops someone putting a
  sentence on it. A scanner could flag `text-[--ink-4]` on an element with long text content.
- **P3** `dialog.tsx`'s alert/confirm opening on top of another overlay means one Escape closes
  both. Needs a modal-stack registry to solve properly; see the note on `useModalDismiss`.

### 9. [DONE] P0 (user request) — ONE rehearsal control for every mission type
> *"you need to make it available for them to answer all missions even if they are not in their
> location or if they need to wait for admin's approval"* — and then: one button, top of screen,
> "act as I'm here" / "approve" / "fill answer", **with the creator still pressing submit**.

The user was right that the first pass only solved half of it. Location WAS covered (three
scattered GPS bypasses already existed). **Approval was a genuine dead end**: a photo mission
without `smart.autoApprove` writes `status:'pending'` and waits for a staff review that, in a solo
rehearsal, nobody is there to give. The creator could not finish their own game.

**The constraint that shaped the design:** answers are server-secret. `sanitizeTask.ts` strips
`answers` / `numericAnswer` / `steps[].answer` / `smart.secretCode`, so the phone genuinely does
not know them and "fill answer" cannot be a client trick. Making the sanitizer conditional on
"is this a test drive" would put the whole answer key one wrong boolean away from every real
player. So it is a **separate, separately-authorized callable** — worst case there is that a
rehearsal reveals its own creator's answers.

- **`revealTaskAnswer`** (new callable). Gated on `run.isTestDrive` read from the RUN document,
  never the request body; `resolveCallerTeam` proves the caller is a team in that run. Returns
  `answer` / `ordering` / `arrive` / `approved` / `none` — the SERVER decides what the mission
  needs, since the client only sees the sanitized payload.
- **One bar, one label per mission**: כאילו הגעתי / אשרו / מלאו תשובה. Replaces the three
  ad-hoc bypasses (`testDriveImHere`, the two `testdrive-hint` paragraphs) so there is exactly
  one way to rehearse.
- **Filled, never auto-submitted** — the human presses the mission's own submit, so the real
  submit → scoring → routing path runs.
- A **choice** quiz has no field to fill, so it marks the correct option with a ring + ✅.
  Caught in live testing: the first pass looked broken on the most common quiz shape.

**Two more bugs surfaced while verifying, both fixed:**
- Pressing בדיקה twice was refused ("finalize the old one first") — a chore in front of the one
  button whose point is immediacy. `launchRun` now RETIRES the previous rehearsal. Retire, not
  reuse: a run snapshots the game at launch, so handing back the old one would silently rehearse
  a pre-edit version.
- **The launch-failure alert was drawn UNDERNEATH the liftoff overlay** (`z-50` vs `z-[100]`), so
  a failed launch showed "preparing your run…" forever with an invisible dialog waiting for a
  click. The app was not hung; it only looked it. Dialog moved to `z-[110]`, with a new gate
  asserting it outranks every other overlay.

**The bundle budget fired a second time** — and this time the answer was NOT another ratchet.
`PlayScreen` + `TaskRunner` (2.2k lines of gameplay engine) were the last statically-imported
screen, so every first-time visitor downloaded them to look at the JOIN screen. Splitting it
freed **29.7 KB gzip**, and the earlier 975,000 → 980,000 ratchet was **reverted**. All three
budgets are back at their original numbers with ~11% headroom.

Tests: e2e scenario `rehearsal reveal` (8 reveal shapes, a reveal→submit round trip, plus the
security assertions that a REAL run and a non-member are both refused) + the retirement
assertions. `npm run verify` GREEN · `npm run e2e` ALL PASS, 108/108 callables.

**Verified live, whole game, from a desk:** quiz (marked ✅ → tapped → 0→100), numeric (filled
"42" → submitted → 220), sequence (filled "קדימה" on the right step; the answer-less step
honestly reported "no right answer"), photo (**approved with no photo taken**), then the finish
screen — 520 points, 4/4 stages. That last screen was unreachable before this change.
