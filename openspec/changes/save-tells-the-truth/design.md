## Context

`apps/creator-web/src/pages/BuilderPage.tsx` autosaves through `updateGame`, a Firebase
callable. The SDK's default timeout is **70,000ms**
(`@firebase/functions`: `timeout = options.timeout || 70000`).

On a dead connection the sequence is:

1. `setStatus('saving')` — header shows *"שומר…"* beside a pulsing amber dot.
2. The request hangs for up to seventy seconds.
3. The promise rejects, `describeCallFailure` runs, the existing failure banner appears.

Steps 1 and 2 are indistinguishable from a healthy save, because "saving" is the word
for both. The existing failure handling is good — it was deliberately built (*"this used
to be `catch { setStatus('unsaved') }` — indistinguishable from a save that simply had
not fired yet"*) — it simply cannot run until the SDK gives up.

And the recovery control is removed for exactly that window. The manual save button's
own comment says it exists *"purely so a creator who is unsure whether autosave 'caught
up' has one button that unconditionally tries again right now"*, directly above
`disabled={status === 'saving'}`.

creator-web has no connection indicator at all; play-web has `ConnectionBanner`.

## Goals / Non-Goals

**Goals:** the creator learns in seconds, not after a minute; the manual save is always
available; offline is reported at once.

**Non-Goals:** blocking or queueing on `navigator.onLine`, shortening the SDK timeout,
persisting unsaved edits across a reload, anything in play-web. See `proposal.md`.

## Decisions

### D1 — Escalate on elapsed time, in a pure function

`saveHealth({ status, startedAtMs, nowMs, online })` returns a level. `saving` at first,
`slow` after 6s, `stalled` after 20s, and `offline` immediately when the browser says so.

`nowMs` is injected, so the whole escalation is testable without a fake timer, and the
thresholds are exported so the test can assert the ordering rather than restate the
numbers.

**20s is deliberately far below 70s.** The point is that the creator learns something is
wrong long before the request itself concludes.

### D2 — Do not cry wolf

Every unusable input resolves to the ordinary in-progress state: a missing
`startedAtMs`, a non-finite clock, a clock that went **backwards** (a device time change
or a tab resuming from sleep), and a browser that reports nothing about connectivity.

`online` is checked with `=== false`, never for falsiness: `undefined` means "the browser
would not say", which is not the same as offline, and guessing would raise a false alarm
on every save in an embedded webview that omits the property.

Escalating on bad evidence would train a creator to ignore the one message that matters.

### D3 — It informs; it never gates

There is no "should we send?" answer anywhere in the module. CLAUDE.md is explicit that
`navigator.onLine` reads `false` on working connections, so acting on it would turn a
wrong guess into lost work. The save always goes out; this decides only what is said
while it is out.

### D4 — The escalated states keep their word at every width

The status word is hidden below `xl` and the coloured dot carries the state — except for
a failure, which keeps its word deliberately. `slow`, `stalled` and `offline` join it,
driven by `needsAttention` rather than by a list of levels repeated at the call site.
A coloured dot cannot say "check your connection".

### D5 — The clock has to move, and only while it matters

A verdict computed once at save time would freeze on its first answer, so an interval
re-renders it every second. It runs **only** while `status === 'saving'` and is cleared
the moment the save lands, so an idle Builder ticks nothing.

### D6 — The manual save stops being disabled

`save()` is already a safe no-op when nothing changed and already carries an
out-of-order guard (`saveSeq`), so pressing it during a flight cannot persist a stale
snapshot — the safety that made `disabled` look unnecessary is the same safety that
makes removing it correct.

## Test Strategy

**Pure — `npm test`, `scripts/test-save-health.ts` (48 assertions):** a quick save is
unchanged; escalation at each threshold; the stalled threshold asserted to be far below
the SDK's 70s; offline outranking the clock; unknown connectivity not treated as
offline; non-`saving` statuses passed through untouched; every unusable clock reading as
ordinary, including a backwards one; `needsAttention` correct per level; totality; and a
5000-case sweep asserting **escalation is monotonic in elapsed time** and offline always
wins.

**UI:** `i18n:check:strict` for three new creator strings in both languages.

**Not e2e:** no callable, no server file, no stored shape. Stated so the omission reads
as a decision.

## Risks / Trade-offs

- **[A false "stuck" on a genuinely slow but healthy connection]** → possible, and the
  copy is written for it: *"still saving…"* then *"the save is stuck, check your
  connection"* — neither claims the work is lost, and the existing banner still owns the
  actual failure. The alternative, silence for seventy seconds, is what was reported.
- **[A once-per-second re-render while saving]** → bounded to the in-flight window,
  which is normally under a second. An idle Builder schedules nothing.
- **[Un-disabling the manual save invites double-saves]** → `saveSeq` already discards a
  superseded resolution; that guard predates this change and is what makes it safe.

## Migration Plan

Land, `npm run verify` green, ship by `deploy:hosting`. **Rollback:** revert; nothing
stored changes.

## Open Questions

1. **Should unsaved edits survive a reload?** The strongest version of "changes were not
   saved" is losing them to a refresh or a crash. A local draft would guarantee that,
   and it interacts with two open tabs, a newer server version and the game's conflict
   model — its own proposal, not a rider on this one.
2. **Should the Builder show a persistent connection banner like play-web's?** Probably,
   but it is a different surface from the save status and should not be decided by the
   save's needs alone.
