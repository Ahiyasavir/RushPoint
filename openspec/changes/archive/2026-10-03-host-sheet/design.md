## Context

Part B of `docs/host-sheet-and-prep-plan-action-plan-2026-10-02.md` is the full
content spec. Decisions 1-4 in its part D were closed with Ahiya on 2026-10-02 (PDF via
the browser; staff codes on a tear-off page in the run version only; the creator's
language; stage 0 and the host sheet first). This design covers the remaining HOW.

## Goals / Non-Goals

**Goals:** one pure, total model that every rendering reads; a print layout that
holds on A4 and on a phone screen; no answer and no staff code reaches a copy printed
with answers off.

**Non-Goals:** a server-generated PDF; a shopping list with quantities (stage 4,
`bank-prep-actions`); the prep plan (stage 3).

## Decisions

### D1. A pure view-model, copied out by name
`buildHostSheet(game, { run?, staffCodes?, options })` returns plain data (cover,
stages, cards, answer rows, staff cards). It never throws on a malformed game, and it
copies named fields OUT of the game, like `galleryTaskDetail.ts`, so an unknown future
field cannot reach paper. When `includeAnswers` is false, no answer-bearing value is
ever read into the model: the secrecy is by construction, then proven by a deep sweep.
The model holds no copy text; it returns codes and values, and the page words them
through `t.*` so both languages come from the dictionaries.

### D2. Coverage guard over `Task`
`scripts/test-host-sheet.ts` reads the `Task` interface out of the type source (the
`test-shared-game-view.ts` technique) and requires every field to be either read by
`hostSheet.ts` or declared in `HOST_SHEET_IGNORED_TASK_FIELDS` with a reason. A new
field forces a decision about the paper.

### D3. Approval mirrors the server
`approvalMode(task, run)` applies exactly `submitStationPhoto`'s rule: only photo-type
missions are reviewed; `smart.autoApprove` OR the run's `autoApproveAllMedia` makes it
automatic; a video mission with a length range notes that an out-of-range clip still
waits for a person. Without a run, the game's `autoApproveAllMedia` default is used.

### D4. Rendering: an in-app route, printed by `window.print()`
Not a `window.open` + `document.write` sheet like `StationQrPrint`: the sheet has
switches, a map and many pages, and it must also read well on a phone. Print CSS hides
the app header and the toolbar, forces a light page, sets `@page { size: A4 }`, and
keeps every card `break-inside: avoid`. The staff page and (optionally) each card get
`break-before: page`.

### D5. Map (ברירת מחדל, ניתן לשינוי)
A self-drawn SVG plot of the numbered stations (scaled to their bounding box, marked
by stage), not a MapLibre raster. Tiles in a print are a CORS and timing problem (a
canvas from a third-party tile server is tainted and may print blank), and the numbered
plot is what the host actually matches against the cards. A real basemap can come
later behind the same `includeMap` switch.

### D6. Addresses (ברירת מחדל, ניתן לשינוי)
No reverse geocoding in this change. Each located card prints its coordinates and a QR
that opens navigation to the point, which is what a host on foot actually uses. A
Nominatim pass (rate-limited, cached) is a follow-up.

### D7. Entry points (ברירת מחדל, ניתן לשינוי)
The Builder `⋯` menu (game version) and a button beside the Run Console's station-QR
print (run version). The Dashboard card menu is left for a later pass.
`StationQrPrint` stays as it is: the code-station QR cards it prints are a different,
cut-out artefact.

### D8. Staff codes come from the page, not the model
The page subscribes to the run's `staffInvites` the way `StaffCodesPanel` does and
passes `buildStaffCodeRows(...)` in. The model drops disabled codes and drops the
whole page when `includeAnswers` is off or there is no run.

## Risks / Trade-offs

- A printed sheet goes stale when the game is edited: every page footer carries the
  print date.
- The sheet holds every answer: a bold "host only" banner, and the answers-off copy
  is safe by construction (D1) and by test.
