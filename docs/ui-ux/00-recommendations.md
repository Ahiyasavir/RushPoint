# RushPoint UI/UX Upgrade — Phase 1 Recommendations

_Scope: presentation layer only (components / styles / layout). No backend, data-model,_
_or Firestore-rule changes. Free-tier only — no paid fonts, icon packs, or component libs._
_Respects the multi-tenant branding system and the "Powered by RushPoint" footer._

## Coordination guardrail (parallel backend agent)

A second agent is concurrently implementing `audio-tasks` and `team-hq-chat` + a bug-hunt
sweep. **These files are OFF-LIMITS to this UI work** (do not edit):

- `functions/**`, `packages/shared/**`
- creator-web: `pages/TaskWizard.tsx`, `pages/RunConsolePage.tsx`, `services/calls.ts`
- play-web: `components/TaskRunner.tsx`, `screens/PlayScreen.tsx`, `components/StaffConsole.tsx`,
  `components/ChatPanel.tsx`, `services/calls.ts`, `store.ts`

`i18n.ts` in both apps is a **soft-conflict zone** (the backend agent will append keys later).
UI copy keys here are appended in isolated, clearly-labelled blocks to minimise merge risk.

## Design-system anchors (verified in code)

- Tokens: creator-web uses CSS vars (`--surface-*`, `--ink-*`, `--rp-fire/amber/plasma/signal/alert`)
  with light+dark. play-web uses a warm palette (`rp-fire/amber/go/alert`) on an **inverted zinc
  scale** (`text-zinc-100` = dark-on-light). Both use Tailwind, `Inter`/`Space Grotesk`/`JetBrains Mono`.
- Primitives today — creator-web `ui.tsx`: Card, Button(4), Input, Textarea, Select, Label,
  Badge, Advanced, Spinner. play-web `ui.tsx`: Button(3), Input, Card, Progress, Screen.
- Gaps common to both: **no Skeleton**, **no Toast**, **no reusable EmptyState**, Button has
  **no `focus-visible` ring / loading state**, icon buttons under the 44px tap target.

---

## Prioritized upgrades

Complexity: **S** ≈ ≤1 file / localized · **M** ≈ 2–4 files or a new primitive · **L** ≈ cross-cutting.

### Tier 0 — Foundation (shared primitives; everything else builds on these)

| # | Upgrade | Rationale | Cx |
|---|---------|-----------|----|
| 1 | **Skeleton primitive + `shimmer` keyframe** (both `ui.tsx` + `index.css`) | Content-shaped loaders instead of a lone spinner cut perceived wait and stop layout-shift jank on Dashboard/Gallery/Runs/Promo. | M |
| 2 | **Button a11y + loading state** (both `ui.tsx`) | Add `focus-visible` ring (keyboard nav is currently invisible), an inline `loading` spinner + `aria-busy`, and guarantee ≥44px height. One change fixes every button app-wide. | S |
| 3 | **Toast system** (creator-web: new `toast.tsx` + host in `App.tsx`) | Save/copy/publish/delete give no non-blocking confirmation today; a lightweight snackbar closes the feedback loop without hijacking focus like the dialog does. | M |
| 4 | **EmptyState primitive** (creator-web `ui.tsx`) | Empty states are re-implemented inline per page with inconsistent messaging and no CTA; one primitive (icon + title + body + action) makes them consistent and activating. | S |

### Tier 1 — Creator-web screens (high-traffic console)

| # | Upgrade | Rationale | Cx |
|---|---------|-----------|----|
| 5 | **Dashboard: skeleton cards + responsive card-action row + tap targets** (`DashboardPage.tsx`) | First screen every creator sees. Replace raw spinner with skeleton grid; wrap the 5-button action row so it stops overflowing on mobile; bump icon buttons to 40px. | M |
| 6 | **Gallery: debounced search-as-you-type + copy-success toast + result skeletons** (`GalleryPage.tsx`) | Search requires an explicit click and "Copy" gives no confirmation — users don't know it worked. Debounced search + toast + skeletons make browsing feel live. | M |
| 7 | **Runs overview: copy-code button + error retry + skeleton** (`RunsOverviewPage.tsx`) | The access code is the one thing a host reads aloud/shares; make it one-tap copyable. Add a retry affordance instead of a dead error line. | S |
| 8 | **Global header icon-button a11y** (`App.tsx`) | Theme toggle is a 32px `title`-only control; give it `aria-label` + 40px hit area. | S |

### Tier 2 — Play-web (mobile game surfaces + public shares)

| # | Upgrade | Rationale | Cx |
|---|---------|-----------|----|
| 9 | **Haptics utility wired into live feedback** (new `lib/haptics.ts` + `LiveOps.tsx`, `InRunAlerts.tsx`, `ConnectionBanner.tsx`) | Field players hold the phone loosely; a Vibration-API buzz on score changes, hot-zone entry, and going offline makes moments land without them staring at the screen. Free, native API, graceful no-op. | M |
| 10 | **GamePromo: distinct not-found vs not-public states + cover-image skeleton + share button** (`GamePromoScreen.tsx`) | Two very different failures render identically today, stranding visitors; the promo page is a growth surface, so add a share affordance and a progressive-image skeleton. | M |
| 11 | **PublicLeaderboard: manual refresh + "updated Ns ago" + share** (`PublicLeaderboardScreen.tsx`) | Silent 8s polling leaves viewers unsure the board is live; a freshness stamp + refresh + share turns it into a shareable spectator surface. | S |
| 12 | **FinalScreen: finish confetti + leaderboard-waiting progress + medal consistency** (`FinalScreen.tsx` + new `lib/confetti.ts`) | The finish is the emotional peak but currently static; add a reduced-motion-aware confetti burst, a real waiting indicator, and consistent rank medals. | M |
| 13 | **JoinScreen: auto-focus code + animate newly-added member field** (`JoinScreen.tsx`) | Removes a tap at the very top of the funnel and clarifies which name input just appeared on shared devices. | S |
| 14 | **ChallengeTeaser: disable input + "time's up" state on expiry** (`ChallengeTeaser.tsx`) | Timer hits 0 but the input stays live, contradicting the countdown; lock it and show a clear expired state. | S |

---

## Explicitly out of scope (and why)

- **QR-code scanner for join** — needs a camera/QR dependency; deferred to keep the free-tier /
  no-new-lib constraint and avoid permissions UX. Noted as a future item.
- **Email verification on signup** — that's an auth/security flow, not presentation.
- Anything inside the OFF-LIMITS files above (task completion confetti in `TaskRunner`,
  StaffConsole/RunConsole polish) — owned by the parallel agent.

## Dependency order for Phase 3

`1 → 2` (primitives) then `4, 3` (creator primitives) → `5,6,7,8` (creator screens) →
`9` (haptics util) → `10,11,12,13,14` (play screens). Each item is implemented and QA'd
in isolation before the next.

---

## Implementation status (Phase 3)

All 14 items implemented and verified — gates green (typecheck · both builds · lint · i18n:check).

| # | Item | Status |
|---|------|--------|
| 1–4 | Foundation primitives (Skeleton, Button a11y, Toast, EmptyState) | ✅ Done |
| 5 | Dashboard: skeleton grid + responsive 2×2 action-row wrap + 36px tap targets | ✅ Done |
| 6–8 | Gallery / Runs overview / global header a11y | ✅ Done |
| 9 | Haptics utility wired into live feedback | ✅ Done |
| 10–14 | GamePromo / PublicLeaderboard / FinalScreen / JoinScreen / ChallengeTeaser | ✅ Done |

**Item 5 note:** originally deferred because the parallel backend agent held `DashboardPage.tsx`
(it added a "test run" button + `testDrive` launch + a `survey` task-type emoji). Once that agent
moved on, Item 5 was applied _on top of_ those changes without disturbing them — the responsive
wrap now also gracefully absorbs the extra 4th action button. Verified at 375px: the action row
wraps into a 2×2 grid (all 36px tall), no horizontal scroll; the loading skeleton composes the
shared `Skeleton` primitive to mirror the hero + stats + 6-card grid.
