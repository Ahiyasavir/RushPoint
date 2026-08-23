## Why

A finish-experience audit of the participant FinalScreen (`apps/play-web/src/screens/FinalScreen.tsx`)
found three small delight regressions at the single most emotionally loaded moment in the whole
product — the finish reveal. Each is a case where an already-built celebration mechanic silently
fails to fire, so the player gets less than what the code already means to give them. None of them
change scoring, routing, or any server behaviour; all three are polish on a screen that already
works.

1. **Earned badges can render empty and never come back (P2).** `BadgesCard` fetches the player's
   profile on mount and refetches when the run flips to finalized (`!!run.leaderboard`). But badges
   are written by the **async `onRunFinalized` trigger AFTER** finalize completes. On a solo
   instant-play finish the run's leaderboard can already be set at first mount, so `finalized` never
   *flips* — the single refetch races the trigger, comes back empty, and the card stays hidden even
   though the player earned badges. There is no retry, so the badges the player just earned are lost
   from the reveal.

2. **A successful native share gives no confirmation (finding #6).** `share()` reads the
   `shareStoryCard` outcome (`'shared' | 'downloaded' | 'copied' | 'failed'`) and shows the "saved"
   confirmation only on `'downloaded'` / `'copied'`. A genuine native-share success returns
   `'shared'` and is not confirmed, so a player who shared to WhatsApp/Instagram sees the button
   snap straight back to its idle label with no acknowledgement. A cancellation returns `'failed'`,
   so it must stay unconfirmed — only a genuine success may confirm.

3. **The finish reveal has confetti but no sound/haptic climax (finding #5).** The reveal fires a
   confetti burst but never fires the existing, mute-gated `feedback('rankUp')` cue
   (`apps/play-web/src/lib/sound.ts`) — the exact three-note "you climbed" arpeggio + success haptic
   built for moments like this. The single biggest celebration in the app is silent.

## What Changes

**Three FinalScreen-only fixes, all reusing mechanics that already exist.**

- **Bounded badge refetch.** After the run is finalized, if the fetched badge list is still empty,
  poll `getMyProfile` a **bounded** number of times (a few tries, a couple of seconds apart) and
  stop the moment badges arrive or the attempt cap is reached. Never an infinite poll; never a
  callable spam; a graceful stop in every branch.
- **Confirm a genuine native share.** Treat the `'shared'` outcome as a success alongside
  `'downloaded'` / `'copied'`, so a real native share shows the same "saved" confirmation. A
  cancellation (`'failed'`) still shows nothing — no false "shared!".
- **Fire the reveal's audio/haptic climax.** Fire the existing `feedback('rankUp')` cue **once** at
  the finish reveal, alongside the confetti, respecting the existing persistent mute gate (the gate
  lives inside `feedback()`; no new sound is added).

## What explicitly does NOT change

- **No new sound and no change to the mute gate.** Item 3 calls the existing `feedback('rankUp')`;
  `sound.ts` is not modified.
- **No regression to the existing reveal.** Confetti (once, ref-guarded), the score-pop, the survey,
  the share ladder (story / podium / photo), the CTA footer, the leaderboard, the withheld-board
  notice and the waiting spinner all render exactly as before.
- **No new callable, no server change, no rules change, no new dependency, no eager heavy import.**
  The badge poll reuses the existing `getMyProfile` callable.
- **Likely no new i18n string.** The native-share confirmation reuses the existing `final.shareSaved`
  key.

## Surfaces touched

- `apps/play-web` — `src/screens/FinalScreen.tsx` only.
- **Not touched:** `functions/`, `packages/shared`, `apps/creator-web`, `firestore.rules`,
  `apps/play-web/src/lib/sound.ts` (called, not edited), `apps/play-web/src/i18n.ts` (reuses an
  existing key).
