# Give the recap & challenge share buttons real feedback

## Why

On the two viral/conversion surfaces — the public run recap and the challenge
teaser — tapping "Share" can end as a silent no-op, which is worst at the exact
moment the product wants to convert a share.

- `apps/play-web/src/screens/RunRecap.tsx` (~39-49): `share()` awaits
  `shareRecap(...)` inside a `try { … } finally { setBusy(false); }` with **no
  `catch` and no read of the returned outcome**. `shareRecap`
  (`apps/play-web/src/lib/recapCollage.ts:70-91`) never throws — it returns
  `'shared' | 'downloaded' | 'copied' | 'failed'` — so when it comes back
  `'failed'` the button simply re-enables with zero feedback ("I tapped and
  nothing happened").
- `apps/play-web/src/screens/ChallengeTeaser.tsx` (~73-81): `share()` awaits
  `shareChallenge(...)` (`apps/play-web/src/lib/challengeCard.ts:89-112`, same
  return contract) and **discards the outcome entirely** — no confirmation on
  success, no feedback on failure.

The finish screen already does this correctly: `FinalScreen.share()`
(`apps/play-web/src/screens/FinalScreen.tsx:142-161`) reads the `ShareResult`,
confirms with `t.final.shareSaved` on a genuine delivery, and stays silent on a
cancellation. The recap and teaser call sites just never adopted that shape.

A second gap sits under it: today both a real failure and a user-cancellation of
`navigator.share` collapse to `'failed'` in the lib (the `catch { return
'failed'; }` around `nav.share`). So a caller cannot tell "the OS share sheet
failed" from "the user backed out". Mirroring the finish screen's `'failed' ⇒
silent` rule alone would keep genuine failures silent — the very bug being
fixed. To surface a failure while keeping a cancel quiet, cancellation needs its
own outcome.

## What Changes

- Extend the share-ladder outcome to distinguish a user-cancellation from a
  genuine failure: `shareRecap` / `shareChallenge` detect an
  `AbortError` from `navigator.share` and return a new `'cancelled'` member
  instead of folding it into `'failed'`. All other paths are unchanged.
- `RunRecap.tsx` and `ChallengeTeaser.tsx` **read** the returned outcome and
  surface a lightweight, transient inline confirmation:
  - `'shared' | 'downloaded' | 'copied'` ⇒ a positive "saved / link copied"
    confirmation (reusing the finish-screen pattern).
  - `'failed'` ⇒ a clipboard fallback (`navigator.clipboard.writeText` of the
    share link) plus a "couldn't share, link copied" notice, so the tap always
    yields **something**.
  - `'cancelled'` ⇒ end quietly, no confirmation and no false "shared!".

## What Does NOT Change

- The successful share happy path (native share sheet, image download) is
  untouched.
- The heavy canvas collage stays **lazy** — no new eager import is added, so the
  play-web first-load bundle budget is unaffected.
- `sharePhoto` / the finish screen / `storyCard` behaviour is unchanged; this
  only brings the recap and teaser call sites up to the same standard (and adds
  the `'cancelled'` distinction the finish screen can adopt later without
  churn).

## Impact

- `apps/play-web/src/screens/RunRecap.tsx` — read outcome, feedback state.
- `apps/play-web/src/screens/ChallengeTeaser.tsx` — read outcome, feedback state.
- `apps/play-web/src/lib/recapCollage.ts` + `apps/play-web/src/lib/challengeCard.ts`
  — add the `'cancelled'` outcome (AbortError detection).
- `apps/play-web/src/i18n.ts` — HE + EN share-result copy for the `recap` and
  `challenge` blocks (routed through `t.*`, no em-dash).
