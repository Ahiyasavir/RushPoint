# Proposal — No-signup "build in 5 minutes" demo

## Why

The creator funnel's biggest leak is the signup wall: a curious organizer lands on the page and must
create an account before they can even see the Builder. Most bounce. If they could pick a template
and build a real game in five minutes — and only sign up when they want to **save or launch** — the
top-of-funnel conversion would jump dramatically.

## What Changes

> Observable behavior. Client-first flow; the signup wall moves from entry to the save/launch action.

- A logged-out visitor can open the **Builder in demo mode** from the landing page, pick a template,
  and edit stages/tasks fully — all held in **local state** (no account, no Firestore write).
- The first attempt to **save, launch, or publish** triggers the signup/login flow; on success the
  in-progress demo game is **persisted to the new account** (via `createGame` + `updateGame`).
- A persistent banner communicates "Demo mode — sign up to save" with the draft auto-kept in
  `localStorage` so a refresh or accidental navigation doesn't lose work.
- If the visitor signs up via a different entry, any pending local demo draft is offered for import.

## Capabilities

### New Capabilities
- `no-signup-demo`: a logged-out Builder demo flow with local draft persistence and a deferred
  signup wall that claims the draft into the new account on first save/launch.

### Modified Capabilities
<!-- None — createGame/updateGame are reused as-is to claim the draft. -->

## Surfaces touched

- **creator-web:** `AuthGate` (allow a "Try the Builder" path that bypasses auth into demo mode);
  Builder reads/writes a local draft instead of Firestore when `demoMode`; a `claimDraft()` step on
  first authenticated save. New `lib/demoDraft.ts` (localStorage serialize/deserialize + a pure
  `isDraftClaimable(draft)` validator).
- **Tests:** `scripts/test-demo-draft.ts` (draft serialize/validate pure logic).
- **No callable change** — `createGame`/`updateGame` are reused to persist on claim.

## Non-goals

- No anonymous server-side game persistence (the draft lives only in the browser until claimed).
- No demo run launching (launch always requires an account + credits).
- No multi-device draft sync (localStorage only).
