# RushPoint — Status (v2 platform)

> Branch `topographic-maps`. This supersedes the v1 phase tracker (admin/mobile/judges/Tene).

## Where it is
The **v2 multi-tenant Creator + Play web platform** is feature-complete and hardened on the
local emulator. Full lifecycle verified by `npm run e2e` (52/52) and all gates green
(`typecheck`, `creator:build`, `lint` 0 errors).

### Built & verified
- **Creator:** Dashboard (+ empty state), 3-step Builder (tile-grid Stages&Tasks + modal editor,
  map location picker), Gallery (list/map), Wallet (Stripe + emulator mock), live Run Console
  (teams, live map, **live leaderboard** with staged publish, broadcast, finalize).
- **Participant (play-web):** join (with finished-run guard), play all task types, real photo
  uploads, nav map, live-ops banners, SOS, **paid hints**, offline resilience (Firestore cache +
  service worker + offline banner), crash guard, wake-lock, Hebrew-content RTL.
- **Staff console:** PIN sign-in, photo review, SOS ack, announcements.
- **Gameplay:** stages → tasks; **partial-completion stages** (complete N of M, best-routed);
  **locationless tasks**; **preset-aware smart routing**; 3 automatic scoring presets + Z-Score.
- **Backend:** all callables (games/runs/gallery/payments + staff/live-ops), server-write-only
  rules, scoped staff read, Storage rules.

## Remaining (not code — needs the owner)
- [ ] Reconcile branches: this work is on `topographic-maps`; the autopilot's `Rushpoint-product`
      clone only has V2-PHOTO. Merge the two lines before deploy.
- [ ] Firebase production deploy: `npm run deploy:backend` (functions + rules + indexes + storage),
      then host the two web apps.
- [ ] Real content: actual coordinates, task copy, access codes, staff PINs.
- [ ] Production auth/keys: Stripe live keys, MapTiler key, admin allowlist.

## Roadmap ideas (see CLAUDE.md "Core concepts" for what exists)
Quiz / numeric / geofence-auto-checkin / sequence tasks · per-team Wrapped recap ·
quick-start templates · whole-route builder preview · speed streaks · achievements.
