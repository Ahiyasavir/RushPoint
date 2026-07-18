## 1. RED — failing tests for the pure core

- [x] 1.1 Add `apps/play-web/src/lib/sound.test.ts` (vitest) or `scripts/test-sound.ts` (aggregator) asserting the pure logic BEFORE it exists: `loadSound()` defaults to `true`; a `shouldFeedback(soundEnabled)` gate returns false when off; every cue (`task|stage|alert|rankUp`) maps to a defined envelope descriptor AND a haptic pattern; `isRankUp(prev, next)` is true only on strict improvement (lower number), false on equal/worse/undefined. → `scripts/test-sound.ts`.
- [x] 1.2 Run the test lane and confirm it FAILS (module/functions not yet present) — this is the RED gate. (Confirmed: MODULE_NOT_FOUND.)

## 2. Core module — synthesized sound + unified feedback

- [x] 2.1 Create `apps/play-web/src/lib/sound.ts`: shared lazy `AudioContext`, `unlockAudio()` (create/`resume()`, idempotent, try/catch no-op), and `playCue(cue)` synthesizing a short distinct envelope per cue; never throws; drops (does not queue) when context missing/suspended.
- [x] 2.2 Add the pure, testable mappings referenced by the tests: cue→envelope descriptor, cue→haptic pattern, `isRankUp(prev,next)`, and the `shouldFeedback` gate. Keep them exported and DOM-free.
- [x] 2.3 Add `feedback(cue)`: reads `loadSound()`; when off do nothing; when on call `playCue(cue)` + matching `haptic(...)`.
- [x] 2.4 Make the RED tests from Task 1 pass (GREEN). (36/36.)

## 3. Persisted mute preference

- [x] 3.1 In `apps/play-web/src/store.ts` add `loadSound(): boolean` (default true) and `saveSound(on)`, mirroring the colorblind pattern (`SOUND_KEY = 'rushpoint.sound'`, guarded try/catch).

## 4. Autoplay unlock wiring

- [x] 4.1 Call `unlockAudio()` from the Join tap handler in `apps/play-web/src/screens/JoinScreen.tsx`. (In `lookup()` + on the sound toggle turning on.)
- [x] 4.2 In `apps/play-web/src/App.tsx` add a one-shot `pointerdown`/`keydown` listener that calls `unlockAudio()` once (covers staff + returning sessions that skip Join), then removes itself.

## 5. Event wiring (the five cues)

- [x] 5.1 Task complete → `feedback('task')`. **Refinement:** wired in `PlayScreen.tsx` off the server-confirmed completed-task count delta rather than TaskRunner's 8 submit sites — one place, covers every task type, and correctly stays silent for a photo/audio submission still pending staff review (not yet `completed`).
- [x] 5.2 Stage complete → `feedback('stage')` in `apps/play-web/src/screens/PlayScreen.tsx` when the completed-stage count grows across polls (ref-baseline guards against re-fire / reload replay).
- [x] 5.3 Rank-up → `feedback('rankUp')` in `PlayScreen.tsx` only when live rank strictly improves vs last-seen (`isRankUp`); no cue on same/worse/undefined.
- [x] 5.4 SOS sent → `feedback('alert')` on successful `triggerSOS`. **Actual site:** `screens/PlayScreen.tsx` `sos()` (SOS lives there, not LiveOps).
- [x] 5.5 Staff SOS received → `feedback('alert')` when a new alert id appears in the staff alert subscription in `screens/StaffConsole.tsx` (ref-baseline of seen ids; no double-haptic since that site had none).

## 6. Mute toggle UI + i18n

- [x] 6.1 Add EN + HE sound-toggle label keys (`t.common.soundOn` / `t.common.soundOff`) to `apps/play-web/src/i18n.ts` (via `t.*`, no hardcoded string).
- [x] 6.2 Render a 🔊/🔇 sound on/off control next to the existing language/colorblind toggles in `JoinScreen.tsx`; wired to `loadSound`/`saveSound`, re-renders on change.

## 7. Gates

- [x] 7.1 `npm run typecheck` — green (all 5 workspaces).
- [x] 7.2 `npm test` — new `test-sound.ts` green (36/36). Only red is a **pre-existing** creator-web em-dash finding (`test-no-dashes`, runConsole help copy) unrelated to this play-web change; both play-web i18n dash checks pass.
- [x] 7.3 `npm run i18n:check` clean — PART A parity/purity green, PART B no hardcoded strings.
- [x] 7.4 `npm run play:build` — production build green.
- [x] 7.5 Preview verify: toggle renders next to lang/colorblind; toggling flips glyph 🔊/🔇 + aria-checked + HE/EN label; persists across reload (localStorage `rushpoint.sound`); `unlockAudio()` on the on-gesture does not throw; no console errors. (Cue playback needs a live joined run; the `feedback()` call path is unit-tested + guarded to never throw.)
