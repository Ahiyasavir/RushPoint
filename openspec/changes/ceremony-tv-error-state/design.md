# Design — Ceremony / TV projector error state

## Current fetch/poll + waiting render (confirmed)

### `apps/play-web/src/screens/CeremonyScreen.tsx`

Poll loop (`~45-62`) — a single recursive `load()` on a `setTimeout`, `POLL_MS = 12_000`
(`CeremonyScreen.tsx:12`):

```
const next = await getPublicLeaderboard({ code });   // :50
if (!alive) return;
setData(next);
if (!next.published) timer = window.setTimeout(() => void load(), POLL_MS);  // :53
} catch {                                              // :54
  if (!alive) return;
  setData(null);                                       // :56  ← error looks identical to unpublished
  timer = window.setTimeout(() => void load(), POLL_MS);  // :57  ← already keeps polling (good)
}
```

Holding render (`~106-113`):

```
if (!published || phase == null) {                     // :106
  … <p …>{t.ceremony.ceremonyWaiting}</p>              // :111  ← neutral line, no error variant
}
```

The `catch` **already reschedules**, so the loop already keeps polling on error — the only
gap is that the error is indistinguishable from "not yet published" at render time.

### `apps/play-web/src/screens/TvLeaderboard.tsx`

Poll (`~22-39`) via `load()`, driven by `setInterval(load, REFRESH_MS)` (`TvLeaderboard.tsx:48`):

```
const next = await getPublicLeaderboard({ code });   // :24
…
setData(next);                                         // :35
} catch {                                              // :36
  setData(null);                                       // :37  ← error looks identical to unpublished
}
```

The `setInterval` (`:46-50`) keeps firing regardless (it only stops when `runStatus ===
'finished'` or `frozen`, which a never-loaded run never reaches), so this loop also **keeps
polling on error** already.

Holding render (`~67-73`):

```
if (!published || rankings.length === 0) {             // :67
  … <p …>{t.tv.notAvailable}</p>                        // :72  ← neutral line, no error variant
}
```

`data === undefined` initial spinner (`:59-64`) is unchanged.

## The design: an error flag + retry keeps polling

Both screens gain one boolean of state, e.g. `loadError`:

- In the `catch`, set `loadError = true` (in addition to the existing `setData(null)` and
  the existing reschedule). **Do not** change `POLL_MS` / `REFRESH_MS`, and **do not** stop
  the loop — the reschedule/interval stays exactly as-is so a transient blip self-heals and a
  later publish still comes alive.
- On a successful fetch (right after `setData(next)`), clear `loadError = false`.

At the holding render, choose the line by the flag:

- `loadError` true → the **distinct error line** (`t.tv.loadError` / `t.ceremony.loadError`).
- else → the existing neutral line (`t.tv.notAvailable` / `t.ceremony.ceremonyWaiting`).

Because the flag clears on the next success, a run published later flips straight to the live
board / ceremony sequence with no residue, and a wrong code keeps showing the error line while
it keeps retrying (self-healing, not stuck-and-silent).

This is presentation + one flag only. The published-run happy path, the poll cadence, and the
early-open (no-error) holding screen are untouched.

## i18n keys (HE + EN, no em-dash, via `t.*`)

No existing `tv`/`ceremony` load-error key exists (grepped; the only nearby keys are
`tv.notAvailable`, `ceremony.ceremonyWaiting`). Add one key to each block, both dictionaries
(`apps/play-web/src/i18n.ts`):

- `tv.loadError` — HE: "לא הצלחנו לטעון את הדירוג. בדקו את הקוד, מנסים שוב…" · EN: "Couldn't
  load the standings. Check the code, retrying…"
- `ceremony.loadError` — HE: "לא הצלחנו לטעון את הטקס. בדקו את הקוד, מנסים שוב…" · EN:
  "Couldn't load the ceremony. Check the code, retrying…"

Projector-legible (short, high-contrast reuse of the existing large-text holding markup),
HE really Hebrew and EN really English, no em-dash (comma phrasing). `npm run
i18n:check:strict` must stay clean.

## Test strategy

UI lane only (no component test runner in play-web) — verify via the preview tools per
CLAUDE.md: open the TV / Ceremony screen with a **bad** code and confirm the distinct error
line renders while the poll keeps retrying; then confirm a valid, later-published run still
comes alive. Pure-logic gates (`npm run i18n:check:strict`, typecheck, `play:build`) cover the
dictionary additions and the flag wiring.
