## 1. RED — the visibility rule, failing

- [x] 1.1 Write `scripts/test-navigate-handoff.ts` asserting every case in design.md's Test Strategy
      against `apps/play-web/src/lib/navigateTo.ts` (`navigationTarget`, `wazeUrl`,
      `googleMapsUrl`), including the leak guard and the dictionary cross-checks for the new keys.
      Run `npx tsx scripts/test-navigate-handoff.ts` and confirm it fails because the module does
      not exist.

## 2. GREEN — the visibility rule

- [x] 2.1 Create `apps/play-web/src/lib/navigateTo.ts` with `NavigableTask`, `NavTarget`,
      `navigationTarget`, `wazeUrl` and `googleMapsUrl` per design.md D1/D2. Fail closed: return
      `null` for anything not positively recognised. No React, no Firebase, no `SafeTask` import.
- [x] 2.2 Add `t.task.navigateHere`, `t.task.navigateMaps` and `t.task.navigateAria` to BOTH
      dictionaries in `apps/play-web/src/i18n.ts`. Hebrew must be real Hebrew; no `—`, `–` or ` - `.
- [x] 2.3 Re-run `npx tsx scripts/test-navigate-handoff.ts` and confirm every assertion passes.

## 3. The link

- [x] 3.1 Add a `NavigateHereLink` component to `TaskRunner.tsx`: call `navigationTarget(task)`,
      render nothing on `null`, otherwise a Waze `<a>` and a Google Maps `<a>`, both
      `target="_blank" rel="noreferrer"`, each meeting the 44px tap minimum, labelled from `t.task.*`.
- [x] 3.2 Render `<NavigateHereLink task={task} />` immediately after `<DistanceBadge task={task} />`
      inside the non-hidden branch of the `task.locationHidden` conditional. Do not add it to the
      sealed-task card.

## 4. REFACTOR

- [x] 4.1 Confirm no task text of any kind is passed to a URL builder (they take a `NavTarget`
      only), that every added class string is a static Tailwind literal, and that new markup uses
      logical classes.

## 5. Gates

- [x] 5.1 Run and confirm green: `npx tsc --noEmit` in `apps/play-web` ·
      `npx tsx scripts/test-navigate-handoff.ts` · `npm run i18n:check`. The repo-wide
      `npm run typecheck` / `lint` / `test` / `creator:build` / `play:build` are run once by the
      orchestrator at the end of the wave, because the tree is shared with other in-flight lanes.
      `npm run e2e` is **excluded**: no callable, payload or server behavior is touched, and the
      emulator must not be started.
