## Context

play-web has no component test runner; this is a **UI lane** one-line URL change on the Staff
console. RushPoint is a walking field game, so a staff member responding to an SOS on foot needs
walking directions, not a dropped pin.

## Current state (re-confirmed)

`apps/play-web/src/screens/StaffConsole.tsx`, in the alerts list, each alert with coordinates
renders:

```
{a.lat != null && a.lng != null && (
  <a
    className="text-ink-fire text-xs underline"
    href={`https://www.google.com/maps?q=${a.lat},${a.lng}`}
    target="_blank" rel="noreferrer"
  >
    {t.staff.openLocation}
  </a>
)}
```

`?q=<lat>,<lng>` is a bare pin form — it drops a marker but starts no directions and carries no
travel mode.

## The fix

Change only the `href` to the Google Maps **directions** form with a walking travel mode:

```
href={`https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}&travelmode=walking`}
```

`dir/?api=1` is the documented Google Maps URL API; `&travelmode=walking` selects on-foot
directions. This matches the walking-mode form specced for the participant-side Google Maps link
(change `task-single-map-link`), keeping the two surfaces consistent. Everything else on the link is
unchanged: the `a.lat != null && a.lng != null` guard, `target="_blank" rel="noreferrer"`, the
`text-ink-fire text-xs underline` styling, and the `t.staff.openLocation` label. Coordinates still
come only from `a.lat` / `a.lng` on the alert document.

## RTL / i18n notes

- No new strings; `t.staff.openLocation` is reused. No hardcoded UI literal added. No em-dash.
- No dictionary change, so `npm run i18n:check:strict` PART A parity and PART B are unchanged.

## Test strategy

Presentational **UI lane** — no extractable pure decision is added or changed. Verify via
`npm run typecheck` · `npm run lint` · `npm run play:build` · `npm run bundle:budget` ·
`npm run i18n:check:strict`. Manual: on the Staff console, an SOS alert that carries coordinates
shows "open location" and tapping it opens **Google Maps in walking mode** to that position; an alert
without coordinates shows no link.

## Non-regression checklist

- Link renders only when the alert has `lat` and `lng`; coordinates sourced only from the alert.
- `target="_blank" rel="noreferrer"` and the `t.staff.openLocation` label retained.
- No second provider added; no callable, alert, or SOS-flow change.
