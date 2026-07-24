# Tasks — task-single-map-link

UI + one-line URL-helper change (play-web has no component test runner). No i18n edit (existing keys
reused). TaskRunner.tsx is edited concurrently — anchor on `NavigateHereLink` and the `data-testid`s.

## Implement

- [x] 1. **Make `googleMapsUrl` a walking-mode directions URL** — in
      `apps/play-web/src/lib/navigateTo.ts`, change `googleMapsUrl` from the bare pin
      (`https://www.google.com/maps?q=<lat>,<lng>`) to the directions form with a walking travel mode
      (`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>&travelmode=walking`). `wazeUrl`
      unchanged. (design.md §The fix #1)
- [x] 2. **Lead with Google Maps, demote Waze in `NavigateHereLink`** — in
      `apps/play-web/src/components/TaskRunner.tsx`, make the Google Maps `<a>`
      (`🧭 {t.task.navigateHere}`, `text-ink-fire font-semibold`, `min-h-[44px]`,
      `data-testid="task-navigate-maps"`, `href={googleMapsUrl(target)}`) the single primary control,
      and demote the Waze `<a>` to a clearly subordinate secondary affordance (smaller/lighter, set
      apart) while keeping its `href={wazeUrl(target)}`, `target="_blank" rel="noreferrer"`,
      `min-h-[44px]` and `data-testid="task-navigate-waze"`. Keep the container
      `aria-label={t.task.navigateAria}` and logical spacing. (design.md §The fix #2)
- [x] 3. **Do not touch the visibility gate** — `navigationTarget(task)` unchanged; a `null` target
      still returns `null`. (design.md §Non-regression)

## Verify (build lane — this agent)

- [ ] 4. `npm run verify` (typecheck · lint · test · creator:build · play:build · bundle:budget ·
      base:check · i18n:check:strict) — green. No new i18n key.
- [ ] 5. `npx openspec validate task-single-map-link --strict` — passes.

## Manual (parent / owner — UNVERIFIED here)

- [ ] 6. On a located task the card shows one prominent "🧭 Navigate here" that opens **Google Maps
      in walking mode** and a visibly subordinate Waze fallback; both open their app; a
      hidden-location task shows no nav link.
