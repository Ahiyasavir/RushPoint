# Design — readable live distance numbers

## Scope

Two elements in `apps/play-web/src/components/TaskRunner.tsx`. Both render the live
distance a walking participant watches. Presentation-only: class strings change, the
rendered value and every `t.*` call stay byte-for-byte identical.

## The two spots (exact current classes)

### 1. `DistanceBadge` — the always-on distance chip

Current (in the `DistanceBadge` component, the returned `<div>`):

```tsx
<div className="text-xs text-zinc-500">
  📍 {dist < 1 ? t.task.metersAway({ m: Math.round(dist * 1000) }) : t.task.kmAway({ km: dist.toFixed(1) })}
</div>
```

Proposed:

```tsx
<div className="text-base font-semibold text-zinc-100 tabular-nums">
  📍 {dist < 1 ? t.task.metersAway({ m: Math.round(dist * 1000) }) : t.task.kmAway({ km: dist.toFixed(1) })}
</div>
```

Change: `text-xs text-zinc-500` → `text-base font-semibold text-zinc-100 tabular-nums`.

### 2. Geofence "walk closer" line

Current (the `dist > radius` branch of the geofence status block):

```tsx
: <p className="text-sm text-zinc-500">{t.task.walkCloser({ dist: Math.round(dist), radius })}</p>}
```

Proposed:

```tsx
: <p className="text-lg font-semibold text-zinc-100 tabular-nums">{t.task.walkCloser({ dist: Math.round(dist), radius })}</p>}
```

Change: `text-sm text-zinc-500` → `text-lg font-semibold text-zinc-100 tabular-nums`.

Leave the sibling states in that block as-is: `findingLocation` (`text-sm text-zinc-500`)
is a status message, not a number, and `youreHere` already uses the strong
`text-ink-fire font-medium` treatment.

## Token rationale

play-web reverses the zinc scale (see `apps/play-web/tailwind.config.js`): on this
light theme `text-zinc-500` is the metadata gray `#78716c`, and `text-zinc-100` is
the near-black ink `#1c1917` — an AA-strong reading color, the stronger ink these
live numbers should have used all along. `tabular-nums` fixes digit width so the
value doesn't reflow as it ticks.

## RTL / logical-class note

Only size, weight, color, and `tabular-nums` change — none are physical-direction
classes, so there is no RTL regression and no logical-class (`ms-`/`text-start`)
concern. The `📍` emoji prefix and layout are unchanged.

## Testing

UI lane only — there is no component test runner for play-web. Verify visually via the
preview tools that both live numbers render larger and higher-contrast with steady,
non-jittering digits. The presentation-only nature (value/logic/i18n untouched) is the
guard against regression; `npm run i18n:check:strict` still applies as this touches a
`.tsx`, but no string routing changes so it should be clean.

## Implementer note — re-anchor by content

`TaskRunner.tsx` is a hot file, frequently edited; line numbers drift. Do NOT trust
line numbers — re-anchor by searching for the exact current class strings above
(`text-xs text-zinc-500` inside `DistanceBadge`, and the `text-sm text-zinc-500`
`walkCloser` line). Both `text-xs text-zinc-500` and `text-sm text-zinc-500` appear
multiple times in the file for genuine metadata; change ONLY these two live-distance
elements, not the other occurrences.
