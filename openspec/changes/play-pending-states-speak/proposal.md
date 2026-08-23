# Proposal: play-pending-states-speak

## Why

The user's top participant-experience complaint, stated twice, is that waiting after a tap feels
dead: "the loading after pressing something is very confusing because nothing is happening
basically so try making it more interesting and that you are advancing and not staying in place"
and "not only show loading because it's boring and not inviting."

The `play-working-feedback` change already introduced a branded `Working` panel (rotating
RushPoint-voiced status lines + an advancing bar) and a success beat, and wired it into the
next-mission routing wait. But a read-only hunt of play-web verified two waits that still sit as a
dead, wordless spinner or a silently-greyed button. This change finishes the branded-progress
rollout by closing exactly those two verified gaps — no new capability, only reuse of the existing
`Working` component and the `Button` `loading` prop.

## What

Two independent, presentation-only fixes:

- **P1 — first screen after Join talks.** When `PlayScreen` has no team state yet (the initial load
  right after joining), it renders a bare 8px spinning ring with no words and no branding
  (`apps/play-web/src/screens/PlayScreen.tsx:348`). Replace that ring with the existing
  `<Working messages={[...]} />` panel showing 2-3 branded "loading your game / almost ready" lines,
  so the very first thing a participant sees after tapping Join reads as forward motion in
  RushPoint's voice. The error branch above it is unchanged.

- **P2 — quick-submit task actions give pending feedback.** The fast submit handlers in `TaskRunner`
  (station-code `verify`, check-in `field`, quiz/numeric/survey `answer`) only `clearMsg()` and
  disable their button during the network round-trip; unlike the photo/audio/sequence paths they
  never surface any pending signal, so on a slow link the button just greys with zero feedback at
  the moment of success. Give those submit buttons the same pending feedback the upload paths
  already have — pass the `loading` prop the shared `Button` already supports (the busy state
  already exists) so the button shows an in-flight indicator, optionally paired with a brief
  branded `showProgress` line.

Both are scoped to presentation. No callable, no server change, no scoring or routing change.
