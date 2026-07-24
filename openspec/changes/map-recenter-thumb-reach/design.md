# Design — map-recenter-thumb-reach

## Scope

A single Tailwind position-class change on the recenter button in
`apps/play-web/src/components/NavMap.tsx`. No behaviour, handler, or logic change.

## Exact change

The recenter `<button>` currently renders with:

```
className="absolute top-14 start-2 z-10 inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-app-card/90 backdrop-blur border border-glass-border shadow-soft text-[11px] font-medium text-zinc-100 disabled:opacity-50"
```

Change only the vertical anchor:

- **From:** `top-14`
- **To:** `bottom-14`

Everything else on the class list stays byte-for-byte — including the logical
inline edge `start-2`, `min-h-[44px]` (WCAG tap target), and the z/color/disabled
utilities.

## No-overlap confirmation

The map container's absolute-positioned children were inspected around this region:

- **MapLibre attribution** — compact, physical **bottom-right**, a short single row
  hugging the very bottom.
- **Search-area legend** — `absolute bottom-2 inset-x-0 ... pointer-events-none`,
  centred and non-interactive (only rendered when search areas exist).
- **MapLibre `NavigationControl`** — `top-right`.
- **`MapModeToggle`** — top.

`bottom-14` places the button roughly one control-row **above** the `bottom-2`
attribution and legend, so it does not sit on top of either; the legend is
`pointer-events-none` regardless, so even incidental overlap could never eat a tap.
Placed on the inline-**start** side (`start-2`), the button is opposite the
bottom-**right** attribution in LTR and vertically clear of it in RTL. No
interactive element occupies the target bottom-start corner.

## RTL note

`start-2` is a **logical** inline edge, so the button hugs the reading-start side —
left in English, right in Hebrew (the app default) — exactly as it did at the top.
No physical `left-`/`right-` class is introduced.

## Test strategy

Presentation-only Tailwind change; play-web has no component test runner. Verify via
the **UI/visual lane** (preview tools): the recenter button appears in the bottom
inline-start corner of the map, remains tappable, clears the attribution and the
search-area legend, and mirrors correctly under a Hebrew (RTL) locale. `npm run
i18n:check:strict` stays clean (no string or hardcoded-literal change).
