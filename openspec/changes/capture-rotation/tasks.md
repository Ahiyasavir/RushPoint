# Tasks: capture-rotation

Source: `docs/field-report-2026-09-27.md` item 16. After `play-screen-no-scroll`.

## 1. RED
- [x] 1.1 `scripts/test-orientation-intent.ts` (truth table + both manifests declare `any`). Confirm RED.

## 2. GREEN
- [x] 2.1 Manifests → `any`; `lib/orientation.ts` + hook. 1.1 → green.
- [x] 2.2 Game screen requests portrait; camera components free it; viewfinder aspect follows the phone.
- [x] 2.3 `PLAY_STORE.md`: the TWA rebuild carries the orientation change.

## 3. Verify
- [ ] 3.1 Preview 740×360: game screen + camera. `npm run verify`, exit code to a file.

## Progress (2026-09-28)

Manifests + JS intent + camera wiring done. Real-device check and the TWA rebuild are owed (cannot be verified in a desktop preview).
