# Design — optimistic-card-out

## 1. The success region (anchor by content — lines may drift)

`apps/play-web/src/components/TaskRunner.tsx` advances the run by calling `onChanged()` on a
server-confirmed success. The confirmed-success branches (verified at review time):

- `submitCheckIn` — `try { await completeTask({...}); onChanged(); }` (`:472`).
- `verify` (smart-station code) — `onChanged();` (`:546`).
- `answer()` (quiz / numeric / survey) — `if (res.correct) onChanged();` (`:640`).
- `submitOrdered()` (ordering quiz) — `if (res.correct) onChanged();` (`:657`).
- `geofenceArrive` — `.then(() => { onChanged(); return true; })` (`:697`).

Not in scope (must stay unchanged): the wrong-answer path `applyAnswerCost(res, …)` (`:619`+); the
sequence *step* progress `if (res.stepCorrect) { onChanged(); … stepOf ✓ }` (`:675`) — a mid-task
step, not a task completion, so it does **not** trigger a card-out; and the arrival-unlock
`showProgress(t.task.arrivalUnlocked); onChanged();` (`:524`), which unseals a hidden task in place
rather than completing it (also excluded).

Viewer/readonly is already excluded structurally: interactive handlers run only for non-`readOnly`
devices (`readOnly` prop `:63/:67`; `frozen = busy || readOnly` `:269`; `if (readOnly …) return`
guards on the submit paths, e.g. `:690`), so hooking the card-out into these branches inherits the
viewer exclusion for free.

The task card being animated is the `<Card>` returned by TaskRunner for the active task (the
interactive `return (` at `:779` and the sealed variant `<Card … data-testid="task-card">` at
`:735`). The card-out class is applied to that outermost `<Card>`'s className.

**Because this region is being actively edited by `play-working-feedback`, the implementer re-reads
it by content before wiring — do not trust the line numbers above.**

## 2. The pure decision — `apps/play-web/src/lib/cardExit.ts`

```ts
export const CARD_EXIT_MS = 220; // bounded, short; matches the CSS transition duration

export function resolveCardExit(reducedMotion: boolean): { animate: boolean; delayMs: number } {
  return reducedMotion ? { animate: false, delayMs: 0 } : { animate: true, delayMs: CARD_EXIT_MS };
}
```

Total, never throws, no side effects. It is the single source of truth for two invariants:
1. **Bounded delay** — `delayMs` is always a small constant (or 0), never unbounded, never derived
   from an animation event.
2. **Reduced-motion = instant** — `{ animate: false, delayMs: 0 }`, so progression is immediate and
   no class is applied.

Unit-tested RED-first (`scripts/test-card-exit.ts`): `resolveCardExit(false)` ⇒ `{animate:true,
delayMs: CARD_EXIT_MS}` with `delayMs > 0 && delayMs <= 400`; `resolveCardExit(true)` ⇒
`{animate:false, delayMs:0}`.

## 3. The card-out mechanism (no-stuck-state guarantee)

React unmounts the card the moment `onChanged()` bubbles up and the parent re-renders, so an exit
animation needs the outgoing card to stay mounted for its short duration. Mechanism:

1. Read the preference once at fire time, mirroring `confetti.ts:13`:
   `const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;`
2. `const plan = resolveCardExit(reduced);`
3. If `plan.animate`: set an `exiting` state flag (adds the `rp-card-exit` class to the `<Card>`),
   then schedule `window.setTimeout(runOnChanged, plan.delayMs)`.
4. If not: call `runOnChanged()` synchronously (today's exact behavior).

`runOnChanged` is a one-shot wrapper around the existing `onChanged()`.

**The no-stuck-state guarantee — progression correctness never depends on the animation:**
- Progression is driven **only** by the bounded `setTimeout` (or the synchronous call), **never** by
  an `animationend`/`transitionend` listener. If the animation is dropped, janky, GPU-throttled, or
  the browser skips it entirely, the timer still fires and the run still advances.
- The delay is a fixed small bound (`CARD_EXIT_MS`, ≤ ~220 ms) from `resolveCardExit` — it can never
  grow.
- `runOnChanged` is idempotent-guarded (fires `onChanged` at most once per submission) and the
  pending timer is cleared on unmount, so a navigation-away mid-exit is a harmless no-op and can
  never double-advance.
- Under reduced motion `delayMs` is 0 and no class is applied — behavior is byte-for-byte today's
  synchronous `onChanged()`.
- Belt-and-braces: `index.css`'s existing global reduced-motion block (`:86`) already collapses every
  `animation-duration`/`transition-duration` to `0.01ms !important`, so even the CSS can't hold a
  reduced-motion card on screen — but correctness rests on the JS timer, not on that.

The net effect the user asked for: the tap resolves → the card visibly slides away (motion at 0 ms of
the transition) → ~220 ms later `onChanged()` runs and `<Working>`/the next card mounts.

## 4. The CSS — RTL-safe exit (`apps/play-web/src/index.css`)

Add beside `rp-working`/`rp-shimmer`:

```css
/* Optimistic card-out: the just-answered card slides toward the reading end and
   fades, so a correct answer shows forward motion at 0ms of the next phase. The
   distance is a CSS var flipped for RTL so it always exits toward the reading end. */
@keyframes rp-card-exit {
  to { opacity: 0; transform: translateX(var(--rp-card-exit-dx, 24px)); }
}
.rp-card-exit {
  --rp-card-exit-dx: 24px;          /* LTR: reading end is to the right */
  animation: rp-card-exit 220ms ease-in forwards;
  will-change: transform, opacity;
}
[dir="rtl"] .rp-card-exit { --rp-card-exit-dx: -24px; } /* RTL (play-web default): reading end is left */
```

RTL-safe by construction (play-web is Hebrew/RTL by default; the `[dir="rtl"]` rule flips the exit to
the left = the reading end). Neutralized by the existing `@media (prefers-reduced-motion: reduce)`
block, which already zeroes `animation-duration` globally. CSS-only — no dependency, `bundle:budget`
unaffected.

## 5. i18n

None. The card-out is pure motion; it introduces no user-visible copy, so nothing routes through
`t.*` and there are no new dictionary keys. `i18n:check:strict` should show zero new PART B warnings
(no new hardcoded strings — the `rp-card-exit` class name is not UI copy).

## 6. Test strategy

- **Pure lane (RED→GREEN):** `scripts/test-card-exit.ts` asserts `resolveCardExit` per §2 — the
  bounded-delay and reduced-motion-instant invariants. Auto-discovered by the `npm test` aggregator.
- **UI lane (no component test runner):** the TaskRunner wiring is verified by `npm run verify`
  (`play:build` compiles the new state/class; `bundle:budget` proves no new heavy/eager import;
  `i18n:check:strict` proves no new copy leaked). Manual owner check: on a real correct answer the
  card slides toward the reading end then the next phase mounts; wrong answers and viewer devices show
  no card-out; a reduced-motion device advances instantly.

## 7. Sequencing with play-working-feedback

Land **after** `play-working-feedback` and re-read the success region by content. That change adds
the success **sound/haptic beat** and the routing `<Working>` panel in the same branches; this change
adds the outgoing card's **visual** exit. They compose (beat fires on confirm → card slides out →
`<Working>` mounts) and must not clobber each other's edits to the shared `onChanged()` success
calls.
