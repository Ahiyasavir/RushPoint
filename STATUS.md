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

## Going live — see [DEPLOY.md](DEPLOY.md)
Full step-by-step for Firebase deploy + Stripe payments is in **[DEPLOY.md](DEPLOY.md)**. The repo
is deploy-ready: `firebase.json` has both Hosting sites + a functions predeploy build hook; the
functions bundle `@rushpoint/shared` via esbuild (no workspace-install issue); Stripe top-ups are
real and credited idempotently by the webhook. What's left is owner-only: enter your Firebase +
Stripe keys in the `.env` files, connect your bank in Stripe, run `npm run deploy:all`.

Optional before a big event: reconcile with the autopilot's `Rushpoint-product` clone (only has
V2-PHOTO), and load real content (coordinates, task copy, access codes, staff PINs).

## Roadmap ideas (see CLAUDE.md "Core concepts" for what exists)
Quiz / numeric / geofence-auto-checkin / sequence tasks · per-team Wrapped recap ·
quick-start templates · whole-route builder preview · speed streaks · achievements.
