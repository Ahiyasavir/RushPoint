# Design — qr-station-scan

## Payload (packages/shared/src/qrPayload.ts)

```ts
export const STATION_QR_PREFIX = 'RP1:';

// 'RP1:' + code, code trimmed. Throws on empty/whitespace-only code (a creator
// bug we want loud at print time, not a blank QR in the field).
export function buildStationQrPayload(code: string): string;

// Inverse. Returns the trimmed code, or null when: text is null/empty, prefix is
// missing or foreign (grocery barcode, someone else's QR, an 'RP2:' future
// payload), or the remainder trims to ''. null ⇒ the scanner keeps scanning and
// NEVER submits.
export function parseStationQrPayload(text: string | null | undefined): string | null;
```

Round-trip law: `parseStationQrPayload(buildStationQrPayload(c)) === c.trim()` for
every non-empty `c`. The versioned prefix is the whole design: parse is a strict
gate, so arbitrary scanned content can't reach `verifyStationCode`, and a future
`RP2:` payload is a new branch, not a breaking change. Export from
`packages/shared/src/index.ts` (one `export * from './qrPayload'` line, matching the
existing list).

## Why this is not a secret leak

The printable sheet renders `task.smart.secretCode` (pitfall: secretCode lives on
`task.smart`, not top-level) obtained via the **owner-scoped `getGame`** callable —
the creator authored those codes and `getGame` already returns them to the owner
today. The participant sanitizer (`functions/src/runs/sanitizeTask.ts`) keeps
stripping `secretCode`; the QR never transits any participant payload. Physically
printing the code at the station is the feature (same trust model as taping the
code to the wall). **No sanitizer, rules, or callable change.**

## play-web — scan button + lazy scanner

**`CodeEntry`** (`apps/play-web/src/components/TaskRunner.tsx` ~line 363) gains a
secondary "📷 Scan QR" button next to the existing input + verify button, plus
`const [scanning, setScanning] = useState(false)`. While `scanning`, render the
lazy scanner; on decode `(code) => { setCode(code); setScanning(false); onSubmit(code); }`
— autofill AND auto-submit through the **existing** `verify()` path in TaskRunner
(`verifyStationCode({ ...ctx, teamId, taskId, code })`), so wrong-code handling,
`not-controller`, attempt throttling, and the `frozen` guard all apply unchanged.
The scan button is disabled when `busy`/`frozen`, same as the verify button.

**`components/QrScanner.tsx`** — new, loaded via `React.lazy(() => import('./QrScanner'))`
inside `Suspense` (bundle rule: heavy deps stay out of the main chunk, like
MapLibre; `jsQR` and the camera code live only here):

1. `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`
   → `<video playsInline autoPlay muted>`.
2. Decode loop (`requestAnimationFrame`):
   - Native path: `'BarcodeDetector' in window` ⇒
     `new BarcodeDetector({ formats: ['qr_code'] }).detect(video)` (typed via a
     small local `declare` — no `@types` package needed).
   - Fallback: draw the frame to an offscreen canvas, `jsQR(imageData.data, w, h)`
     (MIT, ~free; add `"jsqr"` to `apps/play-web/package.json` dependencies).
3. Every decoded string goes through `parseStationQrPayload`; `null` ⇒ keep
   scanning silently (foreign QR is not an error), non-null ⇒ `onDecode(code)` once
   and stop.
4. Cleanup on unmount/close: cancel the RAF loop and `track.stop()` every
   `MediaStreamTrack` (repo has a storage-leak history — camera streams must not
   outlive the component).
5. `getUserMedia` rejection (denied / insecure context / no camera) ⇒ no crash:
   render `t.task.cameraDenied` ("Camera unavailable — type the code below") with a
   close button back to manual entry. Feature-detect `navigator.mediaDevices`
   before offering — if absent, the scan button simply doesn't render.

**Props:** `{ onDecode: (code: string) => void; onClose: () => void }`. Static
Tailwind classes only; overlay styled like the existing light "Warm Trail" cards.

**i18n (play-web `i18n.ts`, EN + HE):** `task.scanQr` ("Scan QR" / "סריקת QR"),
`task.scanQrHint`, `task.cameraDenied`, `task.scanClose`. Zero new
`i18n:check:strict` PART B warnings.

## creator-web — printable QR sheet

`RunConsolePage.tsx` currently subscribes to the run doc but never loads the game —
add a one-shot `getGame({ gameId })` (existing wrapper,
`apps/creator-web/src/services/calls.ts:32`) when the user clicks **"Print QR
codes"** (placed near `JoinShare`, which already demonstrates the `qrcode` →
`toDataURL` pattern at line 286; `qrcode@^1.5.4` is already in
`apps/creator-web/package.json` — **no new creator-web dep**).

Flow (plain function, no new route):
1. Collect `game.stages.flatMap(s => s.tasks).filter(t => t.type === 'smart_station' && t.smart?.secretCode)`.
   Empty ⇒ `dialog` notice "no smart stations in this game".
2. For each: `await QRCode.toDataURL(buildStationQrPayload(task.smart.secretCode), { margin: 1, width: 256 })`.
3. `window.open('', '_blank')` → `doc.write` a minimal printable page (inline CSS,
   one station per block with `page-break-inside: avoid`): task title
   (`dir="auto"` — Hebrew titles), the QR `<img>`, and the human-readable code in
   monospace beneath (manual fallback if a phone can't scan), then
   `win.print()` after images load. Popup blocked ⇒ dialog error, no crash.
4. `t.*` EN + HE: `runConsole.printQr`, `runConsole.printQrEmpty`,
   `runConsole.printQrCodeFallback` (sheet body copy may go through `t.*` too — the
   sheet is creator-facing UI, same language rules apply).

## Test strategy

- **Pure (TDD RED→GREEN):** `scripts/test-qr-payload.ts` — tsx assertion script,
  auto-discovered by the `scripts/run-unit-tests.mjs` aggregator (`npm test`), same
  lane as `scripts/test-gating.ts`:
  - build: prefixes `RP1:`, trims, throws on `''`/whitespace-only.
  - parse: round-trip law over a table of codes (ascii, Hebrew, spaces-padded,
    long); `null` for `null`/`undefined`/`''`/`'RP1:'`/`'RP1:   '`/missing
    prefix/`'rp1:x'` (case-sensitive)/`'RP2:x'`/random URL/join-link text.
  - prefix constant pinned literally (`'RP1:'`) — the printed-sheet compatibility
    contract.
- **Callable:** none needed — `verifyStationCode` is untouched; the e2e
  callable-coverage guard and sanitizer allowlist are unchanged by construction.
  `npm run e2e` still runs as a gate to prove no regression.
- **UI:** preview — scan button renders on a smart_station task, denied-camera path
  shows the manual-entry hint, print sheet renders title+QR+code;
  `npm run i18n:check` clean, zero new strict warnings.

## Footguns respected

- Decoded text is parsed (`parseStationQrPayload`) before any submit — foreign QRs
  can never hit the callable.
- Scanner is fully lazy; `jsQR` never lands in play-web's main chunk (check the
  build output chunk list like the MapLibre split).
- Camera `MediaStream` tracks stopped on every unmount path (leak history).
- `secretCode` read from `task.smart` (not top-level — known pitfall) and only via
  owner-scoped `getGame`; sanitizer untouched.
- Static Tailwind classes; `dir="auto"` on user-authored titles in the print sheet.
