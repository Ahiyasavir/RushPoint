## Context

play-web has no component test runner; this is a **UI + URL-helper** change to one small component
plus one pure URL builder. `navigationTarget()` still decides whether any link shows. RushPoint is a
walking field game, so the primary navigation link must open **walking directions** — Google Maps
(walking mode) — with Waze demoted. TaskRunner.tsx is being edited concurrently, so the change
anchors on the `NavigateHereLink` component and its `data-testid`s, not on line numbers.

## Current state (re-confirmed)

`apps/play-web/src/lib/navigateTo.ts`:

```
export function wazeUrl(target: NavTarget): string {
  return `https://waze.com/ul?ll=${target.lat},${target.lng}&navigate=yes`;
}
export function googleMapsUrl(target: NavTarget): string {
  return `https://www.google.com/maps?q=${target.lat},${target.lng}`;   // bare pin, no travel mode
}
```

`apps/play-web/src/components/TaskRunner.tsx`, `function NavigateHereLink({ task })`: renders the
**Waze** `<a>` first (`🧭 {t.task.navigateHere}`, `text-ink-fire font-semibold`,
`data-testid="task-navigate-waze"`), then the **Google Maps** `<a>` (`{t.task.navigateMaps}`,
`text-zinc-500`, `data-testid="task-navigate-maps"`) as two co-equal side-by-side controls. So the
player reads two "go there" affordances and the one that leads is the driving navigator opening a
dropped pin.

## The fix

**1. Make Google Maps a walking-directions URL.** In `googleMapsUrl`, emit the Directions form with a
travel mode instead of the bare pin (the `?q=` pin form cannot carry a travel mode):

```
export function googleMapsUrl(target: NavTarget): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=walking`;
}
```

`dir/?api=1` is the documented Google Maps URL API; `&travelmode=walking` selects on-foot
directions. This keeps the fresh-two-numeric-fields safety of `NavTarget` (no task field rides along
into the URL).

**2. Lead with Google Maps, demote Waze.** In `NavigateHereLink`, the **Google Maps (walking)** link
becomes the single primary control — carry the prominent styling (`🧭 {t.task.navigateHere}`,
`text-ink-fire font-semibold`, `min-h-[44px]` tap target, `data-testid="task-navigate-maps"`). The
**Waze** link becomes the clearly subordinate secondary affordance (smaller/lighter, e.g.
`text-zinc-500 text-[11px]`, set apart) while keeping `href={wazeUrl(target)}`,
`target="_blank" rel="noreferrer"`, a `min-h-[44px]` touch target and `data-testid="task-navigate-waze"`
so it stays a one-tap fallback. The container keeps `aria-label={t.task.navigateAria}` and logical
spacing. Result: one weighted primary (Google Maps, walking), one quiet fallback (Waze) — both
reachable, only one carrying visual weight.

> The `data-testid`s stay pinned to their providers (`task-navigate-maps` = Google Maps,
> `task-navigate-waze` = Waze); only which link is styled primary flips.

## RTL / i18n notes

- HE is default; keep logical Tailwind only (`-ms-1`, `gap-*`, `ms-`/`me-`) — no physical-direction
  classes. The existing container already uses `-ms-1`; preserve that.
- **No new strings.** Reuse `task.navigateHere` / `task.navigateMaps` / `task.navigateAria`. The
  primary "🧭 Navigate here" now points at Google Maps walking; the demoted `navigateMaps` label now
  fronts Waze — both are existing, provider-neutral keys, so no dictionary edit. No em-dash.
- Run `npm run i18n:check:strict` — no dictionary change, so PART A parity and PART B are unchanged.

## Test strategy

Presentational **UI lane** plus a one-line pure URL builder (no extractable decision changes). Keep
both `data-testid`s so any UI-render smoke that references them still resolves. Verify via
`npm run typecheck` · `npm run lint` · `npm run play:build` · `npm run bundle:budget` ·
`npm run i18n:check:strict`. Manual: on a located task the card shows one prominent "🧭 Navigate
here" that opens **Google Maps in walking mode** and a visibly subordinate Waze fallback; a
hidden-location task still shows no navigation link.

## Non-regression checklist

- Both providers reachable in one tap; Waze URL unchanged; Google Maps URL is now the walking-mode
  directions form.
- `data-testid="task-navigate-maps"` (Google Maps) and `task-navigate-waze` (Waze) retained.
- `navigationTarget()` gate untouched — hidden-location tasks still get no handoff.
- Distance badge and the rest of the task card unaffected; 44px tap targets preserved on both links.
