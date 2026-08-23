# Tasks — staff-sos-google-maps-walking

UI lane (play-web has no component test runner). One `href`; no i18n edit (existing key reused).

## Implement

- [x] 1. **Make the staff SOS location link open Google Maps in walking mode** — in
      `apps/play-web/src/screens/StaffConsole.tsx`, change the alert "open location" `<a>` `href` from
      the bare pin (`https://www.google.com/maps?q=${a.lat},${a.lng}`) to the walking-mode directions
      form (`https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}&travelmode=walking`).
      Keep the `a.lat != null && a.lng != null` guard, `target="_blank" rel="noreferrer"`, styling and
      the `t.staff.openLocation` label. (design.md §The fix)
- [x] 2. **Do not add a second provider or change any behavior** — no Waze, no callable, alert or
      SOS-flow change. (design.md §Non-regression)

## Verify (build lane — this agent)

- [ ] 3. `npm run verify` (typecheck · lint · test · creator:build · play:build · bundle:budget ·
      base:check · i18n:check:strict) — green. No new i18n key.
- [ ] 4. `npx openspec validate staff-sos-google-maps-walking --strict` — passes.

## Manual (parent / owner — UNVERIFIED here)

- [ ] 5. On the Staff console, an SOS alert with coordinates shows "open location" and tapping it
      opens Google Maps in walking mode to that position; an alert without coordinates shows no link.
