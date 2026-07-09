// Pure-logic tests for the station QR payload (buildStationQrPayload /
// parseStationQrPayload). Change: qr-station-scan. Run by scripts/run-unit-tests.mjs
// via `npm test`. No emulator needed.
import { STATION_QR_PREFIX, buildStationQrPayload, parseStationQrPayload } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── prefix contract pinned literally (printed-sheet compatibility) ───────────
ok(STATION_QR_PREFIX === 'RP1:', 'STATION_QR_PREFIX is exactly "RP1:"');

// ── build: prefix + trim, throw on empty/whitespace ──────────────────────────
ok(buildStationQrPayload('ABC') === 'RP1:ABC', 'build prefixes the code');
ok(buildStationQrPayload('  ABC  ') === 'RP1:ABC', 'build trims before prefixing');
{
  let threw = false;
  try { buildStationQrPayload(''); } catch { threw = true; }
  ok(threw, 'build throws on empty code');
}
{
  let threw = false;
  try { buildStationQrPayload('   '); } catch { threw = true; }
  ok(threw, 'build throws on whitespace-only code');
}

// ── round-trip law: parse(build(c)) === c.trim() over a code table ───────────
const codes = ['A', 'ABC123', 'shalom', 'שלום', 'קוד סודי', '  padded  ', 'x'.repeat(200), 'a-b_c.d'];
for (const c of codes) {
  ok(parseStationQrPayload(buildStationQrPayload(c)) === c.trim(),
    `round-trip preserves trimmed code: "${c}"`);
}

// ── parse: trims the decoded remainder ───────────────────────────────────────
ok(parseStationQrPayload('RP1:  ABC  ') === 'ABC', 'parse trims the remainder');

// ── parse: null for every non-matching / empty input ─────────────────────────
ok(parseStationQrPayload(null) === null, 'null input → null');
ok(parseStationQrPayload(undefined) === null, 'undefined input → null');
ok(parseStationQrPayload('') === null, 'empty string → null');
ok(parseStationQrPayload('RP1:') === null, 'prefix only → null');
ok(parseStationQrPayload('RP1:   ') === null, 'prefix + whitespace only → null');
ok(parseStationQrPayload('ABC') === null, 'missing prefix → null');
ok(parseStationQrPayload('rp1:x') === null, 'lowercase prefix (case-sensitive) → null');
ok(parseStationQrPayload('RP2:x') === null, 'future version prefix → null');
ok(parseStationQrPayload('https://example.com/thing') === null, 'arbitrary URL → null');
ok(parseStationQrPayload('https://play.rushpoint.app/?code=ABCDE') === null, 'join-link text → null');
ok(parseStationQrPayload('4006381333931') === null, 'grocery barcode → null');

console.log(failed === 0
  ? `\n✅ ALL QR PAYLOAD TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
