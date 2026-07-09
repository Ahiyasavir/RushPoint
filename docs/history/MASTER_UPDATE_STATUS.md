# Master Update — Status & Handoff

_Session ended early on purpose: tool outputs began garbling (a sign of approaching
context/token limits). The repo is in a **clean, compiling state** — nothing half-written._

## ✅ Done & verified this session
- **Design reskin ("Topographic Expedition", from the design bundle):**
  - `apps/mobile/src/components/tokens.ts` → parchment/forest/blaze palette
    (export names preserved: `GLOW`, `GLASS`, `GRADIENTS`, `BG`, `COLORS`).
  - `apps/admin/src/index.css` → `--rp-*` custom props, body, scrollbar, selection
    re-themed (light parchment).
  - `DESIGN_IMPORT_NOTES.md` → how to decode the design URL next time (it's a
    **gzipped TAR**, not HTML/JSON; use `curl … -o x.tar.gz` then
    `tar --force-local -xzf`. Do NOT use the broken Windows `python` stub — use `node`).
- **Build health verified (all exit 0):** `functions` build, `packages/shared`,
  `apps/admin` typecheck, `apps/mobile` typecheck.

## ✅ Already implemented in the tree (master-update items that need NO work)
Confirmed by reading the real source:
- **§5.2 Dynamic Slot-0 unpinning** — `buildInitialSlots()` already leaves slot 0
  *unassigned*; `registerTeam` → `routeFirstGreen()` → `assignNextTask(...,'green',0)`
  load-balances the opening task across green stations (no hard-pinned `task-green-001`).
- **§1 Matchmaking deadlock + solo-clear** — `joinMatchQueue` pairs instantly within
  ±300 pts and is idempotent; **`sweepMatchQueue`** already implements the 5-min
  "sanctioned solo-clear" (`maxWaitSeconds` default 300, awards `MATCH_WIN_BONUS`,
  writes an audit log). Run it on a timer from the admin UI / scheduler.
- **§3 Satellite/Hybrid toggle** — `HeatmapPage.tsx` already has the outdoor⇄satellite
  control; `apps/admin/src/data/mapStyle.ts` resolves MapTiler `hybrid` (keyed) with a
  keyless Esri World Imagery fallback. Live Firestore listeners (`useLiveTeams`,
  `useActiveAlerts`) live in React state, so switching styles never drops them.
  - ✅ Route `line-color` in HeatmapPage changed neon `#00ffaa` → `#3d6152` (forest) this
    session. ⚠️ Remaining cosmetic: START/Finish/team marker `neon-green` Tailwind classes
    could move to blaze/gold to fully match the theme (left as-is — the `neon-*` tokens
    still exist in the admin Tailwind config, so they render fine; purely optional polish).
- **§1 QR removal (mobile)** — no scanner code exists on the mobile path already
  (`grep` for `expo-camera`/`BarCodeScanner`/`scan` → none). `basket-zone.tsx` starts
  crafting via the `startCraftingTimer` callable, not a scan. So "remove QR" is mostly
  already true; remaining work is the **manual volunteer check-in + beep** (below).

## ✅ §4 Dynamic Difficulty-Adjusted Scoring — DONE & TESTED this session
- **`packages/shared/src/types/index.ts`** — added optional
  `Task.expectedDurationMinutes` (difficulty baseline; falls back to
  `estimatedMinutes` everywhere it's read).
- **`functions/src/scoring/calculateScore.ts`** — added pure `computeTimeBonus()`
  plus `TIME_BONUS_PER_MINUTE` (10) and `TIME_BONUS_CAP` (200). ΔT = T_expected −
  T_actual; bonus = `min(cap, round(ΔT·perMin))`, never negative.
- **`functions/src/index.ts` `finalizeLeaderboard`** — builds a task→duration map
  from all assigned slots, computes each team's `routeTargetMinutes` (T_expected),
  and adds `computeTimeBonus(...)` on top of the Z-Score'd raw score. Rankings now
  expose `routeTargetMinutes` + `timeBonus`.
- **Seed scripts** — left unchanged: tasks are inline objects (no `mkTask` helper),
  and the finalizeLeaderboard reader falls back `expectedDurationMinutes ?? estimatedMinutes`,
  so existing seeds score correctly. For a sharper Easy/Hard spread, add explicit
  `expectedDurationMinutes` to the green tasks in `scripts/seed-emulator.ts`
  (lines ~73-209) and `scripts/seed-local.mjs` (lines ~45-70).
- **`scripts/test-timebonus.ts`** — 9 unit checks, all pass
  (`npx tsx scripts/test-timebonus.ts` → exit 0). Verifies fairness (harder route ≥
  easier for same actual), the zero-floor, the cap, and that the cap (≤200) keeps the
  full 20-min crafting haul mathematically superior to rushing the judge.
- **Full build green**: shared / functions / admin / mobile all typecheck (exit 0).

## ✅ §1 Basket lock + Volunteer "Remove from Queue" — DONE this session
- **Basket lock** (`functions/src/index.ts` `saveTeneSelection`) — now runs in a
  transaction and throws `failed-precondition` if `gameState.judging` is set, so a
  team can't add/remove Tene products after the judge has checked them in.
- **`cancelCheckIn` callable** (new, after `checkInArrival`) — judge/volunteer removes
  a team from the arrival queue: marks the check-in `status:'rejected'` (+ `cancelledAt`),
  clears `gameState.judging` **only** if that check-in held the freeze (idempotent), and
  writes an audit log (`actionType:'cancel_checkin'`, added to the `AuditEntry` union).
- **Admin UI** (`apps/admin/src/pages/CheckInsPage.tsx`) — per-row **Remove** button
  (confirm → `cancelCheckIn` → optimistic list removal). i18n keys `checkins.remove*`
  added EN + HE.
- **Verified**: functions build exit 0; admin `tsc --noEmit` exit 0. Live click-through
  deferred (needs emulator + a seeded pending check-in).

## ✅ ALL master-update items complete (this session series)
> Every §1–§5 item below is implemented, typechecked, and committed/pushed on
> `topographic-maps`. The ONLY thing not done in-session is the **live** emulator run
> of the 30-team sim (deliberately deferred — see §5). index.ts is ~2200 lines and
> large-file `Read` GARBLES late in a session: re-Read in ≤120-line ranges + cross-check
> with `grep -n` before any Edit. Trust build/test EXIT CODES over a suspicious Read.

### §1 Tene discovery — manual check-in + beep + 20-min timer — ✅ DONE
- `startCraftingForTeam` callable (volunteer-triggered, `assertJudge`, idempotent) stamps
  `craftingStartedAt` server-side and advances the basket slot — same effect as the
  self-serve `startCraftingTimer`.
- Mobile beep: `useGameSync` plays the gold chime the moment `craftingStartedAt` first
  appears; the 20-min countdown was already driven off that server stamp.
- Volunteer trigger UI: new **Tene Hub** page (`/tene`, `TenePage.tsx`) — pick 1 of 3 hubs,
  list basket-stage teams, **Start 20-min clock** button → `startCraftingForTeam`.

### §1 Judge routing + freeze bug + basket lock — ✅ DONE
- Judge CTA mis-routing: **already fixed** by commit `8f7322f` — the mobile dashboard only
  exposes the "arrived at judge" button when `slot.type === 'gold' && craftingActive &&
  !frozen` (`dashboard.tsx` `ActiveTaskCard`, ~line 389). Gate slot still renders `GateCard`
  until the duel resolves, so no mis-route back to the duel.
- Basket lock: **done this session** — `saveTeneSelection` rejects once `gameState.judging`
  is set (see the "Basket lock" section above). Used `judging` as the lock rather than a
  separate `teneLocked` flag (single source of truth, already set by `checkInArrival`).

### §1 Volunteer queue "Remove from Queue" — ✅ DONE
- Done this session: `cancelCheckIn` callable + the **Remove** button in `CheckInsPage.tsx`
  (see the section above). `VolunteerPage.tsx` can reuse the same `cancelCheckIn` callable
  if/when its own queue view is built.

### §1 Progressive mobile map reveal — ✅ DONE
- `apps/mobile/app/map.tsx`: reads `live` from the game store and filters the station list
  by progress (by station TYPE — markers carry no per-task id): green always; orange once
  the team reaches the basket leg; gold/all once `craftingStartedAt` is set. The same
  filtered list feeds BOTH the static-map URL and the GPS-dot frame, so "You Are Here" stays
  aligned. Falls back to all stations before the first sync.

### §2 Role refactor — ✅ DONE
- `apps/admin/src/roles.tsx`: added `duelModerator` (→ `/matchmaking`), `arrivalApprover`
  (→ `/checkins`), `teneDistributor` (→ `/tene`) to `Role`, `ALL_ROLES`, `ROLE_ROUTES`.
  `RoleSelect.tsx` meta added (auto-renders from `ALL_ROLES`). EN/HE i18n for all.
- **Station Operator**: already number-only — `RoleSelect` operator picker is a numeric
  station select (1–25) and `StationPage` shows "Station {n}"; the dropdown there picks the
  *mission* that runs at the station (a separate concept). No regression introduced.
- **Tene Distributor**: new `TenePage.tsx` (`/tene`) — pick 1 of 3 hubs + start each team's
  crafting clock (also satisfies the §1 volunteer trigger). Hub→team routing is demo-simple
  (lists all basket-stage teams; teams carry no hub field yet).
- **Global search + fines** (`VolunteerPage.tsx`): added a search box (name / code / member)
  filtering the teams table; the instant cohesion-fine button (`adjustTeamScore`) already
  existed.

### §3 Admin route builder dynamic line — ✅ DONE
- `BuilderPage.tsx`: route line now derives from live state — `start → green stations
  (nearest-neighbour ordered) → gate → finish` — and recomputes instantly as any point is
  dragged or a green station is added/removed. **Save Route** persists the derived mid-nodes;
  green-station edits flag the route dirty. Removed the now-unused `routePathFor` import.

### §5 Reset & 30-team / 25-station simulation — ✅ DONE (script); ⬜ live run deferred
- `scripts/simulate-tournament.mjs` already wipes sim data, seeds **25 stations** (18 green +
  5 gold + 2 zones) Motza→Gan HaKipod, registers **30 teams**, runs the full lifecycle
  (routing → duels/solo-clear → craft → operator pass), injects disruptions (station
  breakdown+evacuate, GPS-less SOS, announcement, forced tie), finalizes, and prints a
  PASS/FAIL health report. **Extended this session** to also exercise the new
  `startCraftingForTeam` (half the field via the Tene Distributor path) and to report the §4
  difficulty time-bonus spread. `node --check` passes.
- **To run live** (deliberately NOT done in-session per the token-budget call): `npm run
  dev:all` (emulator up), then `npm run simulate`. Stop with **Ctrl+C** to persist
  (`--export-on-exit`).

## ⚠️ Environment gotchas hit this session (don't re-learn these)
- **Parallel Bash batches cancel-cascade**: one failing call cancels every sibling. Run
  fragile/probing commands **one per turn**.
- **`python` / `python3` = broken MS Store stub** (exit 49, no output). Use `node`.
- **Large-file `Read` garbled** content late in the session; `grep -n` stayed reliable.
  Trust the **build/typecheck exit codes** as ground truth over a suspicious Read.
- Scratch `tmp_*` files were cleaned up; `tmp_build.txt` etc. may remain — safe to delete.
