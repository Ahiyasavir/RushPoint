## Why

RushPoint is played outdoors, on a phone, while participants are moving between tasks — often
without looking at the screen. Purely visual feedback (a toast, a color change) is easy to miss in
that context, and the SOS flow in particular has no non-visual cue for either the sender or the
staff receiving it. Short, in-code sounds paired with device vibration give immediate, glanceable
confirmation of the moments that matter (a task landed, a stage cleared, an SOS fired) and make the
app feel like a real game rather than a form.

## What Changes

- Add a small **audio + haptic feedback layer** in play-web that plays a short cue on key
  participant/staff events: **task complete**, **stage complete**, **SOS sent**, **staff receives
  an SOS alert**, and **leaderboard rank-up**.
- Sounds are **synthesized in-code via the Web Audio API** (short oscillator/gain envelopes) — **no
  audio asset files**, so the bundle stays small and nothing new is fetched.
- The audio context is **unlocked on the first user interaction** (e.g. the Join tap) to satisfy
  the iOS/Safari autoplay policy; cues fired before unlock are silently dropped, not queued.
- Each cue also triggers **device vibration** via the Vibration API **where supported** (Android
  Chrome), degrading silently on iOS/Safari where it is unavailable.
- Add a **persistent "sound" mute toggle** stored in play-web's session store (localStorage-backed),
  defaulting to on, with a bilingual (EN/HE) label. When muted, no sound **and** no vibration fires.
- No backend, callable, Firestore, or scoring changes. Existing event sites (`completeTask`
  success, stage advance, `triggerSOS`, staff alert subscription, leaderboard rank change) call the
  new feedback helper; the events themselves are unchanged.

## Capabilities

### New Capabilities
- `audio-haptic-feedback`: play-web plays a short synthesized sound and (where supported) a vibration
  on key participant/staff events, gated by an iOS-safe autoplay unlock and a persistent mute toggle.

### Modified Capabilities
<!-- None — no existing spec's requirements change. -->

## Impact

- **Surfaces touched:** `apps/play-web` only. No shared types, no callable, no `functions/`, no
  `firestore.rules` changes.
- **Code:**
  - New feedback module + `usePlaySound()` hook (Web Audio synthesis, iOS unlock, vibration).
  - `store.ts` — add a persisted `soundEnabled` flag + toggle.
  - Event sites: `TaskRunner` (task complete), `PlayScreen`/stage advance (stage complete, rank-up),
    SOS send flow (`LiveOps`/wherever `triggerSOS` is called), `StaffConsole` (SOS receive), and a
    mute control in the play-web settings/menu surface.
  - `i18n.ts` — EN/HE label(s) for the sound toggle.
- **Gates:** UI change → `npm run i18n:check` mandatory; plus typecheck, builds. No new callable, so
  no e2e coverage guard change.
- **Risk:** low — additive, silent-degrading, no server or scoring impact.
