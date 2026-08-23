# Tasks — readable live distance numbers

UI lane (no component test runner; verify via preview + visual check).

## 1. Update the DistanceBadge classes

- [x] In `apps/play-web/src/components/TaskRunner.tsx`, re-anchor to the
      `DistanceBadge` component's returned `<div>` (search for `text-xs text-zinc-500`
      immediately above the `📍 {dist < 1 ? t.task.metersAway...` line).
- [x] Change `className="text-xs text-zinc-500"` →
      `className="text-base font-semibold text-zinc-100 tabular-nums"`.
- [x] Leave the value expression and the `t.task.metersAway`/`t.task.kmAway` calls
      unchanged.

## 2. Update the geofence "walk closer" line

- [x] Re-anchor to the `walkCloser` line (search for
      `t.task.walkCloser({ dist: Math.round(dist), radius })`; it is the `text-sm
      text-zinc-500` `<p>`).
- [x] Change `className="text-sm text-zinc-500"` →
      `className="text-lg font-semibold text-zinc-100 tabular-nums"`.
- [x] Do NOT touch the sibling `findingLocation` (`text-sm text-zinc-500`) or
      `youreHere` (`text-ink-fire font-medium`) branches.

## 3. Verify (UI lane)

- [x] Preview play-web; confirm both live distance numbers render larger and
      high-contrast, with steady non-jittering digits as the value updates.
- [x] `npm run i18n:check:strict` clean (a `.tsx` was touched, but no string routing
      changed — must still be green).
