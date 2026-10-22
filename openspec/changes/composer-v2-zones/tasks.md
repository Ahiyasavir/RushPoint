## 1. Planner
- [x] 1.1 `lib/zonePlan.ts` and `scripts/test-zone-plan.ts` (clustering, route, one area per stage,
  bookends, floor, arrival gates, Quick Setup steps, idempotence, hands off, merge, the updateGame
  battery). Note: the module was drafted before its test in this session; the test was then written
  against the spec scenarios and caught two real defects (re-plan refused its own gates; fixture).
## 2. Builder
- [x] 2.1 `components/ZonePlanOffer.tsx`, shown under the breadcrumb when the plan moves something;
  apply goes through `setGame` (undoable) with a toast offering undo.
- [x] 2.2 Strings in both dictionaries; i18n strict clean.
## 3. Gates
- [ ] 3.1 Browser check of the offer at desktop and 375px, and e2e at the end of the plan (founder:
  run e2e once at the end, not per phase).
