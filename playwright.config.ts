// Playwright UI smoke — the ONE layer the other gates don't cover: does the app
// actually RENDER in a real browser without a white-screen crash, are the critical
// controls present, and does the Hebrew-first UI mount RTL? Pure-logic tests, e2e,
// and the sims all exercise the backend + callable API; nothing else drives the two
// React apps in a browser. These specs catch the render-crash / broken-mount /
// missing-control class that a headless callable test can never see.
//
//   npm run test:ui              (boots both Vite dev apps; assumes emulator running
//                                 for the play-web join flow — render smokes need no
//                                 emulator and stay green without one)
//
// The webServer block boots creator-web (:5180) + play-web (:5181) and reuses an
// already-running dev server if present (so `npm run dev:all` + `npm run test:ui`
// works too). Chromium headless-shell is installed via `npx playwright install chromium`.
import { defineConfig, devices } from '@playwright/test';

// Use localhost (not 127.0.0.1) for the browser-facing URLs: Vite dev binds to the
// default `localhost` host, which on Windows resolves to IPv6 ::1 — polling 127.0.0.1
// would miss it and time out. The apps' OWN Firebase-emulator connections still use
// 127.0.0.1 internally (unaffected).
const CREATOR = 'http://localhost:5180';
const PLAY = 'http://localhost:5181';

export default defineConfig({
  testDir: './e2e-ui',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // dev servers + a shared emulator: keep it serial and deterministic
  reporter: [['list']],
  use: { headless: true, trace: 'on-first-retry' },
  projects: [
    { name: 'creator', testMatch: /creator\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: CREATOR } },
    { name: 'play', testMatch: /play.*\.spec\.ts/, use: { ...devices['Pixel 7'], baseURL: PLAY } },
  ],
  // ⚠ VITE_API_ORIGIN is forced EMPTY for the UI suite, and that is load-bearing.
  // `apps/*/.env` may point callables at the self-hosted VPS
  // (`VITE_API_ORIGIN=https://api.rush-point.com`, change: self-host-functions-vps), and
  // `services/firebase.ts` only wires the functions emulator `if (!apiOrigin)`. Inherit
  // that value and the smoke suite signs in against the LOCAL Auth emulator but fires
  // every callable at PRODUCTION — which fails (an emulator token is not valid there)
  // and, far worse, would be writing to real data if it ever did succeed. A test must
  // never be able to reach production; an empty value restores the emulator wiring.
  // Vite gives process env precedence over .env, and firebase.ts treats '' as unset.
  webServer: [
    { command: 'npm run creator', url: CREATOR, reuseExistingServer: true, timeout: 120_000, env: { VITE_API_ORIGIN: '' } },
    { command: 'npm run play', url: PLAY, reuseExistingServer: true, timeout: 120_000, env: { VITE_API_ORIGIN: '' } },
  ],
});
