# Tasks — Local playtest with shareable links (RED → GREEN → REFACTOR)

> Pairs with `free-mode` (#63) so testers play with no payment wall.

## Pure helpers

- [ ] **1. RED (pure):** new `scripts/test-playtest-links.ts` — `resolveEmulatorHost` (default
  127.0.0.1; explicit host; playtest → origin), `resolveProxyTarget` (each emulator path; `/creator`
  → 5180; default → 5181), `buildPlaytestLinks` (creator + join with/without code). `npm test` → RED.
- [ ] **2. GREEN:** add the three helpers to `packages/shared/src/`, export. Re-run → green.

## Client emulator host

- [ ] **3. GREEN:** `apps/*/src/services/firebase.ts` use `resolveEmulatorHost(import.meta.env,
  window.location.origin)` instead of hardcoded `127.0.0.1`; Vite `server.host = true` (0.0.0.0).
  Confirm `npm run dev:all` still connects locally (default unchanged).

## Proxy + orchestrator

- [ ] **4. GREEN:** rewrite `scripts/proxy.mjs` route table via `resolveProxyTarget` (v2 creator/play +
  emulator paths; drop the v1 :8081 fallback).
- [ ] **5. GREEN:** add `npm run playtest` (EMU + SEED + CREATOR + PLAY at 0.0.0.0 + proxy:3000 +
  cloudflared) and `scripts/print-playtest-links.mjs` that prints the creator + join links once the
  tunnel URL + seeded access code are known.

## Runbook + verify

- [ ] **6. Manual verify:** run `npm run playtest`; open the creator link on the laptop, the join link
  on a phone over cellular → the phone joins the seeded run and plays. Write `PLAYTEST.md` runbook.
- [ ] **7. Gate:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build`.
  (No callable → no e2e change.) Update TECH_SPEC Appendix B.
