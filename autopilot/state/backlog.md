# Backlog (task queue)

_Generated from state.json · 2026-06-02T20:18:17.485Z_

Goal phase: **structure**. 8 task(s) queued.

- **F-CTRL** [admin] Control-room "needs attention" dashboard: one prioritized live view of active SOS alerts, teams past their station time cap, paused/closed stations, and pending judge reviews  _(U2 A5 R5 P4 C0 · risk 3/effort 3)_
    - VERIFIED ABSENT on topographic-maps (no control-room/triage page exists). New admin page + nav entry for the manager role. Read-ONLY aggregation of EXISTING live sources (adminAlerts snapshot, listPendingArrivals, listTeams, task status + maxDurationMinutes) — add NO new gameState/score writes, reuse the existing acknowledge action. Bilingual EN/HE + RTL logical classes + the premium theme.
- **H-DASH** [gameplay] Player dashboard clarity: add explicit next-step guidance + robust loading / empty / error states so a team always knows what to do  _(U5 A1 R3 P3 C0 · risk 2/effort 3)_
    - POLISH the EXISTING apps/mobile/app/dashboard.tsx. Purely additive UI states; preserve every current behavior and the premium theme. EN/HE parity for any new strings.
- **H-WRAP** [ui] Race Wrapped polish: finish/animate the EXISTING wrapped summary screen (per-team stats, clean shareable layout) without changing how it is reached  _(U4 A1 R1 P2 C0 · risk 2/effort 2)_
    - apps/mobile/app/wrapped.tsx already exists (~187 lines) — ENHANCE it, do NOT rebuild. Keep it opt-in and non-manipulative.
- **H-REG** [gameplay] registerTeam resilience: validate input and return clear, typed, bilingual error messages for duplicate / claimed / invalid access codes  _(U4 A3 R4 P3 C0 · risk 3/effort 3)_
    - HARDEN the EXISTING registerTeam callable + the register/access-code screens. Preserve the atomic claim flow exactly; surface friendlier errors on the client.
- **H-OFFLINE** [reliability] Mobile reconnect UX: clear "reconnecting / back online" indicator and a gameState resync nudge after a network drop during the event  _(U4 A2 R5 P4 C0 · risk 3/effort 3)_
    - BUILD ON the existing offline persistence + useOfflineToast; add a VISIBLE connection-state indicator. Do not change Firestore wiring beyond what is needed for the indicator.
- **H-A11Y** [ui] Accessibility + EN/HE parity audit on the core player screens (access-code, register, dashboard, sos): touch targets, contrast, missing translations, RTL logical classes  _(U3 A1 R2 P2 C0 · risk 2/effort 3)_
    - Improve EXISTING screens only. Each cycle should ship a visible, checkable improvement (e.g. a fixed untranslated string or a corrected RTL layout), not a sweeping refactor.
- **H-READY** [reliability] Event-day readiness page (admin): one screen that checks seed integrity, callable health, and config and shows a green/red go-live checklist before doors open  _(U1 A4 R5 P4 C0 · risk 2/effort 3)_
    - New, self-contained admin page that READS existing data + pings existing callables. No changes to game logic.
- **C-001** [structure] Remove any committed debug logs (firebase-debug.log, firestore-debug.log, .emulator-log.txt) and ensure they are gitignored  _(U0 A0 R1 P0 C4 · risk 1/effort 1)_
    - Pure cleanup; pick only when nothing product-facing is ready or it unblocks a product task.
