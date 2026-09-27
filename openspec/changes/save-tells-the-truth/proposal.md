## Why

From the 2026-09-10 run: *"changes were not saved in real time when there was a
connectivity problem. The user got no clear indication of this, and the sync only
happened after turning cellular data on."*

Nothing was ultimately lost — the work did sync once the connection returned. What
failed is that the Builder spent up to **seventy seconds** claiming to be saving, and
took away the one button that could have fixed it.

The Firebase callable SDK's default timeout is **70,000ms**
(`@firebase/functions`). So on a dead connection:

1. The autosave fires and sets status `saving`. The header shows *"שומר…"* beside a
   pulsing amber dot.
2. The request hangs. For seventy seconds nothing else happens.
3. Only then does the promise reject, and only then does the existing save-failure
   banner appear.

For that whole minute the Builder is **indistinguishable from a Builder that is saving
normally**, because "saving…" is the word for both. The creator keeps typing into
something they believe is persisting.

And the recovery action is removed at exactly the wrong moment. The manual save button
carries this comment:

> *"A manual, always-clickable save … it exists purely so a creator who is unsure
> whether autosave 'caught up' has one button that unconditionally tries again right
> now."*

and this code:

```jsx
disabled={status === 'saving'}
```

The comment says *unconditionally*; the code disables it for the entire hang. A creator
who correctly senses something is wrong reaches for the button designed for that
feeling and finds it greyed out.

CLAUDE.md already records this exact shape from the join screen — *"a `disabled`
primary button explains nothing, cannot fire, and therefore cannot tell the user what
it wants"* — and notes that the rule "had not travelled". It still has not.

Creator-web also has **no connection indicator at all**. play-web has
`ConnectionBanner`; the console a host runs an event from has nothing.

## What Changes

- **A save that has not landed says so, long before the SDK gives up.** After a few
  seconds the Builder stops saying "saving" and starts saying it is still trying; after
  longer it says the connection looks like the problem. The creator learns in seconds
  what used to take over a minute.
- **The manual save button becomes what its comment always claimed**: always clickable.
  A creator who senses something is wrong can always act on that.
- **Being offline is reported immediately**, rather than after a timeout.

**BREAKING**: none. No stored shape, no callable, no server change. A save that
succeeds quickly looks exactly as it does today.

## Capabilities

### New Capabilities
- `save-progress-honesty`: what the Builder tells a creator about a save while it is
  still in flight.

## Impact

- **Surfaces**: `apps/creator-web` only — a new pure verdict module, its test, the
  Builder's status area, and copy.
- **No callable, no Firestore shape, no rule, no env var, no server change.**
- **i18n**: three new creator strings, both languages.
- **Deployment**: `deploy:hosting`.

## Non-goals

- **Blocking or queueing a save when the browser reports itself offline.** CLAUDE.md is
  explicit that `navigator.onLine` reads `false` on working connections, so it may
  INFORM and must never GATE. The save always goes out.
- **Shortening the callable timeout.** A slow save is not a failed save, and cutting the
  SDK's deadline would turn a recoverable wait into a manufactured failure.
- **Persisting unsaved edits locally so they survive a reload.** That is a real and
  larger guarantee — it interacts with two open tabs, a newer server version, and the
  game's own conflict model — and it deserves its own proposal. This change fixes what
  was actually reported: not being told.
- **Anything in play-web.** The participant submit path has its own fail-open guards
  (`stuckGuards.ts`) and its own reported issues.
