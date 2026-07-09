## Why

Smart stations today require players to hand-type a secret code — slow, typo-prone,
and clunky on a phone in the field. Every competitor ships QR check-in. RushPoint can
add it with **zero backend surface**: the QR is just a printed carrier for the code
the station already has, and the decoded value feeds the EXISTING `verifyStationCode`
callable. The creator prints a QR sheet; players scan instead of typing. Complexity
S/M, zero paid dependencies.

## What Changes

- A versioned QR payload format **`RP1:<secretCode>`** with pure shared helpers
  (`buildStationQrPayload` / `parseStationQrPayload` in
  `packages/shared/src/qrPayload.ts`). The `RP1:` prefix means a scanned grocery
  barcode or a foreign QR parses to `null` (never submitted), and future payloads
  (e.g. per-team) can bump the version without breaking old printed sheets.
- **play-web:** a "Scan QR" button in the smart_station code-entry UI (`CodeEntry`
  in `TaskRunner.tsx`). Camera via `getUserMedia` + native `BarcodeDetector` where
  available; MIT `jsQR` canvas-frame fallback elsewhere. The whole scanner is
  **lazy-loaded** (kept out of the main bundle, MapLibre-style). On decode: parse,
  autofill the code field, and auto-submit through the existing `verify()` flow.
  Camera permission denied ⇒ graceful hint to type the code manually.
- **creator-web:** a "Print QR codes" button in `RunConsolePage` that opens a
  printable window (`window.print()`) listing every smart_station task in the game:
  title + QR image (existing `qrcode` dep) + the human-readable code beneath as
  fallback. Codes come from the owner-scoped `getGame` — the owner already legally
  holds them.
- **No new callable, no sanitizer change, no rules change, no Firestore change.**

## Capabilities

### New Capabilities
- `qr-station-scan`: pure versioned payload build/parse (shared, assertion-script
  tested); lazy camera scanner + scan button in play-web `CodeEntry`; printable
  station QR sheet in creator-web RunConsole; i18n EN/HE for all new copy.

## Non-goals

- No per-team QR codes and no signed/HMAC payloads — the station code IS already the
  shared secret; a QR adds convenience, not authentication.
- No QR scanning for join codes (join links already carry `?code=` + a QR in
  `JoinShare`).
- No new callable and no change to `verifyStationCode` semantics (attempts,
  rate-limits, controller checks all apply unchanged).
- No native app / no paid scanning SDK — `BarcodeDetector` + `jsQR` (MIT) only.
- No QR for other task types (quiz/photo/etc.) in v1.

## Surfaces touched

- **shared:** `packages/shared/src/qrPayload.ts` (`STATION_QR_PREFIX`,
  `buildStationQrPayload`, `parseStationQrPayload`) + export from `index.ts`.
- **functions:** **nothing** — `verifyStationCode` is consumed as-is.
- **play-web:** `components/TaskRunner.tsx` (`CodeEntry` gains the scan button),
  new lazy `components/QrScanner.tsx`; `jsQR` added to `apps/play-web` deps;
  i18n EN/HE (`scanQr`, `scanQrHint`, `cameraDenied`, …).
- **creator-web:** `pages/RunConsolePage.tsx` "Print QR codes" button + printable
  sheet (uses the already-installed `qrcode` package and the existing `getGame`
  wrapper in `services/calls.ts`); i18n EN/HE.
- **Tests:** `scripts/test-qr-payload.ts` (tsx assertion script, auto-picked-up by
  the `npm test` aggregator). No e2e scenario needed — no callable added or changed,
  so the coverage guard and sanitizer allowlist are untouched by construction.
