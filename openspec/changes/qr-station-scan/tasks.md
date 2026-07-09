## 1. Shared payload — RED then GREEN (pure logic, TDD)

- [ ] 1.1 RED: `scripts/test-qr-payload.ts` (tsx assertion script, auto-picked-up by the `npm test` aggregator) asserting `buildStationQrPayload` / `parseStationQrPayload`: `RP1:` prefix pinned literally; trim on build+parse; build throws on empty/whitespace; round-trip law over a code table (ascii, Hebrew, padded, long); parse ⇒ `null` for null/undefined/`''`/`'RP1:'`/`'RP1:   '`/missing prefix/lowercase `'rp1:x'`/`'RP2:x'`/arbitrary URL text. Confirm it fails (module missing).
- [ ] 1.2 GREEN: implement `STATION_QR_PREFIX`, `buildStationQrPayload`, `parseStationQrPayload` in `packages/shared/src/qrPayload.ts` (pure, dependency-free); export via `packages/shared/src/index.ts`. `npm test` → 1.1 passes.

## 2. play-web — lazy scanner + scan button

- [ ] 2.1 Add `jsqr` (MIT) to `apps/play-web/package.json` dependencies.
- [ ] 2.2 New `apps/play-web/src/components/QrScanner.tsx`: `getUserMedia` environment camera → decode loop using native `BarcodeDetector` when available, `jsQR` canvas-frame fallback otherwise; every hit gated through `parseStationQrPayload` (null ⇒ keep scanning); fire `onDecode(code)` once and stop; stop ALL media tracks + cancel RAF on unmount/close; permission-denied / no-camera ⇒ `cameraDenied` hint + close back to manual entry.
- [ ] 2.3 `CodeEntry` in `apps/play-web/src/components/TaskRunner.tsx`: "Scan QR" button (hidden when `navigator.mediaDevices` absent, disabled with `busy`) toggling the `React.lazy`-loaded scanner in `Suspense`; on decode autofill the code input AND auto-submit via the existing `onSubmit` → `verify()` → `verifyStationCode` flow (no new callable).
- [ ] 2.4 Verify the bundle split: `npm run play:build` shows `jsQR`/scanner in a separate lazy chunk (not the main bundle).
- [ ] 2.5 play-web i18n keys (`task.scanQr`, `task.scanQrHint`, `task.cameraDenied`, `task.scanClose`) EN + HE.

## 3. creator-web — printable station QR sheet

- [ ] 3.1 "Print QR codes" button in `apps/creator-web/src/pages/RunConsolePage.tsx` (near `JoinShare`): one-shot owner-scoped `getGame({ gameId })`, filter `stages[].tasks[]` for `type === 'smart_station'` with `task.smart?.secretCode` (secretCode lives on `task.smart`, not top-level), `QRCode.toDataURL(buildStationQrPayload(code))` per station (`qrcode` already installed), open a print window listing title (`dir="auto"`) + QR + human-readable code + `window.print()`; empty-list and popup-blocked ⇒ dialog notice, no crash.
- [ ] 3.2 creator-web i18n keys (`runConsole.printQr`, `runConsole.printQrEmpty`, `runConsole.printQrCodeFallback`) EN + HE.

## 4. UI verification (preview)

- [ ] 4.1 Preview play-web: scan button on a smart_station task; denied-camera path shows the manual-entry hint; a decoded `RP1:` payload autofills + submits; a foreign QR is ignored.
- [ ] 4.2 Preview creator-web: print sheet renders every smart station with title + QR + fallback code.

## 5. Gates

- [ ] 5.1 `npm run typecheck`
- [ ] 5.2 `npm run lint`
- [ ] 5.3 `npm test`
- [ ] 5.4 `npm run creator:build` + `npm run play:build`
- [ ] 5.5 `npm run e2e` (batch gate — no callable added/changed, coverage-guard list unchanged; run to prove no regression)
- [ ] 5.6 `npm run i18n:check` (clean; zero new strict warnings)
