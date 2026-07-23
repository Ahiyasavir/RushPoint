## 1. The decision that has to be pure

A recentre button looks like it has no logic, which is exactly why the logic it does have has
historically rotted: "is there a fix worth flying to, and where should the camera end up" is a
verdict, and a verdict rendered inline in JSX is a verdict nothing can test. play-web has no
component test runner, so anything decided inside `NavMap.tsx` is decided unobserved.

`apps/play-web/src/lib/recenter.ts`:

```ts
export const RECENTER_ZOOM = 16;
export const RECENTER_MIN_ZOOM = 1;
export const RECENTER_MAX_ZOOM = 20;

export type RecenterReason = 'ok' | 'no_fix';

export interface RecenterVerdict {
  enabled: boolean;
  reason: RecenterReason;
  center: [number, number] | null;   // [lng, lat] — MapLibre order, decided once, here
  zoom: number;                      // always finite and in range, even when disabled
}

export function recenterVerdict(
  me: { lat?: unknown; lng?: unknown } | null | undefined,
  opts?: { zoom?: unknown },
): RecenterVerdict;
```

Properties the tests pin:

- **Total.** `null`, `undefined`, `{}`, `{lat: 'x'}`, `NaN`, `Infinity`, out-of-range, a string, a
  number and an array all return a verdict. Nothing throws. A map control that throws during render
  takes the whole racing screen down with it, and this one runs on every GPS tick.
- **Null island is not a fix.** `(0, 0)` is `blankTask()`'s "unplaced" placeholder and a classic
  bad-GPS sentinel; the rest of the codebase rejects it by name, so this does too.
- **`[lng, lat]`, once.** The axis swap is the single most repeated bug in map code. The verdict
  emits MapLibre's own order so the component never re-derives it.
- **`zoom` is always usable.** A caller that reads `zoom` off a disabled verdict still gets a finite
  in-range number, never `NaN`; a caller-supplied zoom is clamped, and a garbage one falls back to
  the default rather than poisoning `easeTo`.
- **No clock, no randomness, no I/O.** Re-runnable, order-independent, safe on a hot path.

## 2. Fail-open, precisely

The platform rule is "every client-side blocking flag must fail OPEN" (`stuckGuards.ts`). The rule
is about guards that stand between the player and the server. This control stands between the player
and the CAMERA — it is not on any submit path, and no server call reads it.

So the correct reading of fail-open here is: **a disabled recentre button must never be able to block
anything else.** It is a `<button disabled>` inside the map's overlay layer; it holds no focus trap,
no modal, no pointer-events blanket over the canvas, and the map, the mode toggle, the task card and
every submit control behave identically whether it is enabled or not. What it must NOT do is pretend
— an enabled-looking button that silently does nothing is what the MapLibre control already does, and
it is the reason the player asked for a real one.

`onClick` additionally re-checks the verdict and returns early if the map is not yet created or the
verdict is disabled, so a click that races a fix disappearing is a no-op rather than an `easeTo(NaN)`
(which leaves MapLibre in a permanently broken camera state).

## 3. Markup and placement

```tsx
<button
  type="button"
  onClick={recenter}
  disabled={!rc.enabled}
  aria-label={rc.enabled ? t.play.recenter : t.play.recenterNoFix}
  title={rc.enabled ? t.play.recenter : t.play.recenterNoFix}
  className="absolute top-14 start-2 z-10 inline-flex items-center gap-1.5 min-h-[44px] px-3
             rounded-lg bg-app-card/90 backdrop-blur border border-glass-border shadow-soft
             text-[11px] font-medium text-zinc-100 disabled:opacity-50"
>
  <span aria-hidden="true">◎</span>
  {t.play.recenter}
</button>
```

- **Accessible name.** Both a visible text label AND an explicit `aria-label`, because the name has
  to CHANGE when the button is disabled — "no location yet" is the answer to the question a player
  asks when it will not respond, and a visible label alone cannot carry it. `scripts/lib/
  playA11yScan.ts` accepts either; this satisfies both its rules.
- **RTL.** `start-2`, `gap-1.5`, no `ml-*`/`pl-*`/`left-*`. Hebrew is the default language of this
  app, so a physical-direction class is a mainline bug and the a11y scan fails on it.
- **Placement.** Directly beneath `MapModeToggle` (`top-2 start-2`, 44 px tall), so `top-14` clears
  it. It cannot collide with MapLibre's `NavigationControl` (top-right) or the compact attribution
  (bottom-right), and the map strip is only 208 px tall so the bottom edge is not usable.
- **Tap target.** `min-h-[44px]` + horizontal padding, the same floor the rest of play-web uses.
- **Icon is decorative.** `aria-hidden` on the glyph so a screen reader reads the label once.

## 4. Removing `GeolocateControl`

Deleted from the `addControl` block. The justification is in the proposal; the mechanical
consequences are: one fewer `watchPosition` subscription on a racing phone, one fewer permission
prompt, and no possibility of the built-in control's fix disagreeing with the blue dot. Nothing else
in the app referenced it. `NavigationControl` stays.

## 5. Test strategy

**`scripts/test-map-recenter.ts` (tsx, auto-discovered by `npm test`)** — pure, no emulator:

- a valid fix ⇒ `enabled: true`, `reason: 'ok'`, `center` is `[lng, lat]` in that order and equal to
  the input axes, `zoom === RECENTER_ZOOM`;
- `null`, `undefined`, `{}`, missing `lat`, missing `lng`, `NaN`, `Infinity`, `-Infinity`, string
  coordinates, boolean coordinates, `lat: 91`, `lat: -91`, `lng: 181`, `lng: -181` ⇒
  `enabled: false`, `reason: 'no_fix'`, `center: null`, and a finite in-range `zoom`;
- `(0, 0)` ⇒ disabled;
- boundary coordinates `(90, 180)` and `(-90, -180)` ⇒ enabled (valid, and not the placeholder);
- an explicit `zoom` is honoured; `0`, `99`, `NaN`, `'x'`, `null` are clamped or fall back, never
  emitted as-is;
- the function never throws for a hostile input matrix (arrays, numbers, strings, symbols-as-values);
- **idempotence/purity**: calling it twice on the same input returns deeply equal verdicts, and it
  does not mutate its argument.

**`scripts/test-play-a11y-scan.ts`** — already scans every play-web `.tsx`; the new button must add
zero findings (that is what proves the `aria-label` and the logical-direction classes are right).

**`npx tsx scripts/check-i18n.ts --strict`** — the two new keys exist in both dictionaries, Hebrew is
Hebrew, English is English, and no literal bypasses `t.*`.

**Manual/preview (for the parent or the owner):** open a run, drag the map until the dot leaves the
viewport, tap the control, confirm the camera flies back; then deny location permission and confirm
the control renders disabled with the "no location yet" name and that the task card still submits.

## 6. Copy (HE + EN, no dash separators)

`play.recenter`:
- HE: `מרכוז למיקום שלי`
- EN: `Center on me`

`play.recenterNoFix`:
- HE: `אין עדיין מיקום. ממתינים לקליטת GPS.`
- EN: `No location yet. Waiting for a GPS fix.`
