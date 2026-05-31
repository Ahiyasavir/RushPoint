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

## ⬜ Remaining work (precise targets for next session)
> index.ts is ~2150 lines and large-file `Read` GARBLES late in a session. Re-Read in
> ≤120-line ranges AND cross-check with `grep -n` before any Edit, or `old_string`
> matching will fail. Trust build/test EXIT CODES over a suspicious Read.

### §1 Tene discovery — manual check-in + beep + 20-min timer
- New callable (e.g. `teneCheckIn` / reuse `startCraftingTimer`) called by a
  **Tene Distributor** volunteer; it stamps `craftingStartedAt` server-side.
- Mobile (`dashboard.tsx` / `basket-zone.tsx`): on `craftingStartedAt` appearing, play a
  beep (there's already `useSlotSound` / Web Audio in the kit) and start the 20-min client
  countdown synced to the server stamp.

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

### §1 Progressive mobile map reveal
- `apps/mobile/app/map.tsx` (368 lines, currently static): render only completed-slot
  station coords + current target; reveal all product stations once `craftingStartedAt`
  is set. Drive off `gameState.slots[].status` + the station list.

### §2 Role refactor
- `apps/admin/src/roles.tsx`: extend `Role` to add `duelModerator`, `arrivalApprover`,
  `teneDistributor`; add `ROLE_ROUTES` entries. `RoleSelect.tsx` UI for the new roles.
- **Station Operator**: `StationPage.tsx` — collapse Station Name + Number into a single
  **Station Number** input (and the role-select station prompt).
- **Tene Distributor**: pick 1 of 3 hubs, filter dashboard to teams routed to that hub.
- **Global search + fines** (`VolunteerPage.tsx`, 643 lines — already has team list):
  add a search box (name / member / code) and an instant-fine button → `adjustTeamScore`.

### §3 Admin route builder dynamic line
- `BuilderPage.tsx` (366 lines): make the green route `Source`/`Layer` `data` derive from
  the live coordinate state so the line updates as points are added/moved (no refresh).

### §5 Reset & 30-team / 25-station simulation
- Base script exists: **`scripts/simulate-tournament.mjs`** — extend it to:
  wipe collections, seed **25 stations** Motza→Gan HaKipod, launch **30 teams**, run to
  completion, emit a health report (routing spread, state-sync friction, final standings).
- Run procedure: `npm run dev:all` (emulator up), then `node scripts/simulate-tournament.mjs`.
  Stop the emulator with **Ctrl+C** to persist (`--export-on-exit`).

## ⚠️ Environment gotchas hit this session (don't re-learn these)
- **Parallel Bash batches cancel-cascade**: one failing call cancels every sibling. Run
  fragile/probing commands **one per turn**.
- **`python` / `python3` = broken MS Store stub** (exit 49, no output). Use `node`.
- **Large-file `Read` garbled** content late in the session; `grep -n` stayed reliable.
  Trust the **build/typecheck exit codes** as ground truth over a suspicious Read.
- Scratch `tmp_*` files were cleaned up; `tmp_build.txt` etc. may remain — safe to delete.
