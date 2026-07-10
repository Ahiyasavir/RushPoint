## Context

play-web already ships a **haptics** helper ([apps/play-web/src/lib/haptics.ts](apps/play-web/src/lib/haptics.ts)
— `haptic('tap'|'success'|'warn'|'error')`, a silent no-op where the Vibration API is missing or
reduced-motion is set) and a **confetti** helper ([lib/confetti.ts](apps/play-web/src/lib/confetti.ts)).
Haptics are already fired at a few sites (ConnectionBanner offline, LiveOps score adjustment,
InRunAlerts). There is **no audio layer** and **no user control** over feedback. The moments that
most need non-visual confirmation — task complete, stage complete, SOS sent, staff receiving an SOS,
rank-up — have no sound, and SOS in particular is silent for both sender and staff.

Preferences in play-web follow a consistent localStorage load/save pattern in
[store.ts](apps/play-web/src/store.ts) (`loadLang`/`saveLang`, `loadColorblind`/`saveColorblind`).
The app is Hebrew-first; all user-facing text routes through `t.*` in
[i18n.ts](apps/play-web/src/i18n.ts).

## Goals / Non-Goals

**Goals:**
- A single semantic feedback call per event that plays a **synthesized** sound (Web Audio, no asset
  files) **and** a vibration, honoring one persistent mute toggle.
- iOS/Safari-safe: unlock the audio context on first user interaction; drop (never queue) cues fired
  before unlock.
- Wire the five events: task complete, stage complete, SOS sent, staff SOS received, rank-up.
- Persistent, bilingual mute toggle defaulting to on.

**Non-Goals:**
- No audio asset files, no volume slider, no per-event sound customization.
- No backend/callable/Firestore/scoring changes — event *sites* already exist.
- Not reworking the existing standalone `haptic()` calls (ConnectionBanner/InRunAlerts); those keep
  their current reduced-motion-only gating. This change adds the *unified cue* layer on top.

## Decisions

### New module `apps/play-web/src/lib/sound.ts`
- `unlockAudio()` — lazily create (or `resume()`) a single shared `AudioContext`; call from the
  first user gesture. Idempotent; wrapped in try/catch so an unavailable `AudioContext` is a no-op.
- `playCue(cue)` where `cue ∈ 'task' | 'stage' | 'alert' | 'rankUp'` — synthesizes a short envelope
  (oscillator + gain ramp, ~120–300ms) per cue. Returns immediately and never throws. If the context
  is missing or still suspended (not yet unlocked), it does nothing (cue dropped, not queued).
- Sounds are distinct: `task` = single soft blip, `stage` = two-note rising, `rankUp` = three-note
  arpeggio, `alert` = urgent two-tone (used for both SOS send and staff receive).

### Unified feedback helper `feedback(cue)` (in `sound.ts`)
- Reads `loadSound()` from the store. If sound is **off**, do nothing — no `playCue`, no vibration.
- If **on**: call `playCue(cue)` and the matching `haptic(...)` pattern
  (`task→success`, `stage→success`, `rankUp→success`, `alert→error`). This satisfies the spec's
  "muting silences sound AND vibration" for cue events without touching the standalone haptic sites.

### Store: persisted `soundEnabled` in [store.ts](apps/play-web/src/store.ts)
- Mirror the colorblind pattern: `SOUND_KEY = 'rushpoint.sound'`, `loadSound(): boolean` (default
  **true** — `!== '0'`), `saveSound(on)`. Guarded try/catch like the others.

### Unlock site
- Call `unlockAudio()` from the Join tap handler in
  [screens/JoinScreen.tsx](apps/play-web/src/screens/JoinScreen.tsx) and, defensively, once on first
  pointer/keydown in [App.tsx](apps/play-web/src/App.tsx) (one-shot listener) so staff and returning
  sessions that skip Join still unlock.

### Event wiring
- **Task complete** → in [components/TaskRunner.tsx](apps/play-web/src/components/TaskRunner.tsx) on
  a successful `completeTask` result: `feedback('task')`.
- **Stage complete** → in [screens/PlayScreen.tsx](apps/play-web/src/screens/PlayScreen.tsx) when the
  team's stage index advances (compare previous vs new): `feedback('stage')`.
- **Rank-up** → in PlayScreen when live-leaderboard rank improves (lower number) vs the last seen
  rank: `feedback('rankUp')`. No cue on same/worse rank.
- **SOS sent** → where `triggerSOS` is invoked in
  [components/LiveOps.tsx](apps/play-web/src/components/LiveOps.tsx): `feedback('alert')` on success.
- **Staff SOS received** → in the staff console alert subscription (StaffConsole /
  [components/InRunAlerts.tsx](apps/play-web/src/components/InRunAlerts.tsx)) when a new alert
  arrives: `feedback('alert')`.

### Mute toggle UI
- Add a sound on/off control next to the existing language/colorblind preferences (same settings/menu
  surface those toggles live in). Label via new i18n keys `t.soundOn` / `t.soundOff` (or a single
  `t.sound` label + state) in [i18n.ts](apps/play-web/src/i18n.ts), EN + HE.

## Test Strategy

- **Pure logic (vitest/tsx):** `sound.ts` is DOM/AudioContext-bound, so extract the cue→envelope and
  cue→haptic mapping and the `loadSound` default logic into pure, testable functions. Add
  `apps/play-web/src/lib/sound.test.ts` (or `scripts/test-sound.ts` picked up by the aggregator)
  asserting: default is on; `feedback` is a no-op when sound is off; every cue maps to a defined
  envelope + haptic pattern; `rankUp` decision fires only on strict improvement. **RED first.**
- **UI:** verify via preview tools — toggle mute, complete a task, trigger SOS, and confirm no
  thrown errors in console; confirm the toggle persists across reload. Because AudioContext can't be
  "heard" in preview, assert the call path via console/log and the toggle state.
- **i18n:** `npm run i18n:check` MUST be clean — new toggle label goes through `t.*` (EN=English,
  HE=Hebrew), zero new PART B hardcoded-string findings (`npm run i18n:check:strict`).
- **Gates:** `npm run typecheck`, `npm run play:build`, `npm run i18n:check`. No callable → e2e/
  coverage-guard unaffected.

## Risks / Trade-offs

- **iOS autoplay:** if no gesture unlocks the context, cues silently don't play — acceptable and
  spec'd (drop, don't queue). The App.tsx one-shot listener minimizes this.
- **Synthesized vs. designed sound:** oscillator cues are less polished than authored samples, but
  keep the bundle flat and avoid any network fetch — the right trade for a field PWA.
- **Double feedback:** a couple of sites already call `haptic()` directly (score adjust in LiveOps).
  We route the *new cues* through `feedback()`; we won't stack a second haptic on an event that
  already has one — checked per site during wiring.
- **Annoyance:** mitigated by the default-on toggle, cue selectivity (only 5 meaningful events), and
  short envelopes.
