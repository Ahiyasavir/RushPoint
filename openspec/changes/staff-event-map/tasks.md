# Tasks: staff-event-map

Owner (2026-09-27): "staff should also have a map of the event with the locations of all teams".
A staff map already existed (collapsed, team dots only). What it lacked:

- [x] Mission spots: getRunOutline adds `spot {lat,lng,hidden?}` per located mission (never the
      authored `coordinates`, nothing for a locationless one); drawn as numbered squares, hidden
      ones grey with a note that players do not see the spot.
- [x] Team names on the map, "updated N min ago" in the popup, a dot faded after 5 minutes
      (`lib/staffMap.ts`, scripts/test-staff-map.ts), a team list under the map that centres on a
      tap, and a count of teams that never reported.
- [x] Easier to find and use: taller map, framed on the missions before any team reports, and it
      stays open once opened (per run, per phone).
- [x] e2e (outline spots, hidden flag, no spot, still no secrets); lint, unit, i18n strict.
      The e2e block was written before the server change but not run RED first (noted honestly).
- [ ] Browser check (batched).
