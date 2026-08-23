## Why

SOS is the participant app's one **safety** control, yet during active play it is the **last**
element on a long scrolling page. In the active-race branch of PlayScreen
(`apps/play-web/src/screens/PlayScreen.tsx`) the `variant="danger"` SOS button renders *after* the
promoted task card, LiveOps/standings, the photo feed (on by default), team↔HQ chat, and the
trackables/zones/devices panels. A player who needs help must scroll past every secondary panel to
reach the affordance that summons it. An emergency control should never live below the fold.

The sticky `Header` at the top of the same screen (game name, live score/clock, "leave") is always
on-screen — that is exactly where an always-reachable SOS entry belongs.

## What Changes

- Add a **second, always-visible SOS entry point** in the sticky play `Header`: a compact labelled
  danger control next to the existing "leave" button, on-screen the whole time the team is racing.
- The header control calls the **same** `sosAction.run()` used by the bottom button — same confirm
  dialog (`t.play.sosConfirm` / `t.play.sosSend`, danger), same best-effort location resolve, same
  `triggerSOS` callable, same "sent"/"failed" alerts and the same in-flight double-tap guard.
- Give the header control an accessible name via a new `t.play.sosAria` key (HE + EN), a min 44px
  target, and RTL-safe logical spacing.

## What does NOT change

- **The existing bottom SOS button stays exactly as-is** (`variant="danger"`, `sosAction`,
  `triggerSOS`). This change is purely additive — a second reachable entry point, nothing removed.
- **SOS behaviour is untouched.** The confirm-before-send, location resolve, callable payload,
  success/failure alerts and the `useAsyncAction` re-entrancy guard are shared — both entry points
  drive the one `sosAction`, so a double tap across the two still fires once.
- **Task-level "request help" affordances** (geofence/blocked task cards) are unaffected.
- No backend change, no new callable, no rules change, no new dependency.

## Impact

- `apps/play-web` — `src/screens/PlayScreen.tsx` (Header component + its call sites), `src/i18n.ts`
  (one new key per language).
- **Not touched:** `functions/`, `packages/shared`, `apps/creator-web`, `firestore.rules`.
