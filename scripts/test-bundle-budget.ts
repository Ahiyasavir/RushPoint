// Pure-logic tests for play-web-bundle-budget (asset selection / byte budgets /
// forbidden-dependency markers / report). Run by scripts/run-unit-tests.mjs via `npm test`.
//
// SYNTHETIC FIXTURES ONLY. This file never reads dist/, never touches the
// filesystem and never runs a build — so it can be neither made green by a stale
// build nor made red by the absence of one. The real built output is checked by
// scripts/check-bundle-budget.mjs (`npm run bundle:budget`).
import {
  selectAsset,
  evaluateBundleBudget,
  formatBudgetReport,
} from './lib/bundleBudget.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

type Asset = { file: string; bytes: number; gzipBytes: number };

const ENTRY_JS = /^assets\/index-[^/]*\.js$/;
const ENTRY_CSS = /^assets\/index-[^/]*\.css$/;

/** A realistic-shaped asset list: entry js + entry css + lazy chunks + html. */
function assets(over: Partial<Asset> = {}): Asset[] {
  return [
    { file: 'assets/index-abc.js', bytes: 900_000, gzipBytes: 236_000, ...over },
    { file: 'assets/index-abc.css', bytes: 38_000, gzipBytes: 7_000 },
    { file: 'assets/NavMap-xyz.js', bytes: 808_000, gzipBytes: 219_000 },
    { file: 'assets/QrScanner-xyz.js', bytes: 132_000, gzipBytes: 47_000 },
    { file: 'index.html', bytes: 2_500, gzipBytes: 900 },
  ];
}

/** Policy mirroring the real one, with round numbers that make boundaries obvious. */
function policy(over: Record<string, unknown> = {}) {
  return {
    label: 'play-web',
    entryJs: ENTRY_JS,
    entryCss: ENTRY_CSS,
    maxEntryGzipBytes: 255_000,
    maxEntryRawBytes: 975_000,
    maxInitialGzipBytes: 262_000,
    forbiddenMarkers: ['maplibre', 'jsqr', 'qrcode'],
    ...over,
  };
}

/** Markers as the runner reports them: one entry per forbidden marker. */
function markers(over: Record<string, number> = {}) {
  return { maplibre: 0, jsqr: 0, qrcode: 0, ...over };
}

// Shared invariant asserted on EVERY evaluation: the overall verdict is exactly
// the conjunction of the individual checks, and every policy entry produced one.
const EXPECTED_CHECKS = 3 + 3; // 3 size checks + 1 per forbidden marker
function invariants(res: ReturnType<typeof evaluateBundleBudget>, label: string) {
  ok(res.ok === res.checks.every((c) => c.ok), `${label}: ok === every(check.ok)`);
  ok(res.checks.length === EXPECTED_CHECKS, `${label}: one check per policy entry (got ${res.checks.length})`);
  ok(new Set(res.checks.map((c) => c.name)).size === res.checks.length, `${label}: check names unique`);
  ok(typeof res.report === 'string' && res.report.length > 0, `${label}: report is a non-empty string`);
}

// ── selectAsset ──────────────────────────────────────────────────────────────
{
  const one = selectAsset(assets(), ENTRY_JS);
  ok(one.ok === true && one.asset?.file === 'assets/index-abc.js', 'selectAsset: exactly one match is selected');

  const none = selectAsset(assets().filter((a) => !ENTRY_JS.test(a.file)), ENTRY_JS);
  ok(none.ok === false && none.problem === 'missing', 'selectAsset: no match → missing');
  ok(String(none.detail).includes('index-'), 'selectAsset: missing detail names the pattern');

  const two = selectAsset([...assets(), { file: 'assets/index-def.js', bytes: 1, gzipBytes: 1 }], ENTRY_JS);
  ok(two.ok === false && two.problem === 'ambiguous', 'selectAsset: two matches → ambiguous');
  ok(String(two.detail).includes('index-abc.js') && String(two.detail).includes('index-def.js'),
    'selectAsset: ambiguous detail names every match');

  const css = selectAsset(assets(), ENTRY_CSS);
  ok(css.ok === true && css.asset?.file === 'assets/index-abc.css',
    'selectAsset: lazy chunks / html do not confuse the entry pattern');

  ok(selectAsset([], ENTRY_JS).ok === false, 'selectAsset: empty list → not ok');
}

// ── Byte budget boundaries ───────────────────────────────────────────────────
{
  const base = evaluateBundleBudget({ assets: assets(), markers: markers(), policy: policy() });
  invariants(base, 'baseline');
  ok(base.ok === true, 'baseline fixture is within budget');

  const at = evaluateBundleBudget({
    assets: assets({ gzipBytes: 255_000, bytes: 975_000 }),
    markers: markers(),
    policy: policy(),
  });
  invariants(at, 'at-limit');
  ok(at.ok === true, 'exactly at the limit passes (gzip and raw)');

  const over = evaluateBundleBudget({
    assets: assets({ gzipBytes: 255_001 }),
    markers: markers(),
    policy: policy(),
  });
  invariants(over, 'limit+1');
  ok(over.ok === false, 'one byte over the gzip limit fails');
  const gz = over.checks.find((c) => c.name === 'play-web entry js (gzip)');
  ok(gz?.ok === false, 'the failing check is the entry gzip check');
  ok(String(gz?.detail).includes('1'), 'overage detail states how far over it is');

  const overRaw = evaluateBundleBudget({
    assets: assets({ bytes: 975_001 }),
    markers: markers(),
    policy: policy(),
  });
  ok(overRaw.ok === false, 'one byte over the RAW limit fails even when gzip passes');

  const under = evaluateBundleBudget({
    assets: assets({ gzipBytes: 254_999, bytes: 974_999 }),
    markers: markers(),
    policy: policy(),
  });
  ok(under.ok === true, 'one byte under the limit passes');

  const zero = evaluateBundleBudget({
    assets: assets({ bytes: 0, gzipBytes: 0 }),
    markers: markers(),
    policy: policy(),
  });
  ok(zero.ok === true, 'a zero-byte entry passes the BUDGET (an absent entry is what fails)');

  // CSS-only growth: entry js is comfortably inside its own budget, but the sum
  // crosses the initial-payload budget.
  const cssHeavy = [
    { file: 'assets/index-abc.js', bytes: 900_000, gzipBytes: 254_000 },
    { file: 'assets/index-abc.css', bytes: 90_000, gzipBytes: 20_000 },
  ];
  const sum = evaluateBundleBudget({ assets: cssHeavy, markers: markers(), policy: policy() });
  invariants(sum, 'css-heavy');
  ok(sum.checks.find((c) => c.name === 'play-web entry js (gzip)')?.ok === true,
    'css-heavy: the js check still passes');
  ok(sum.ok === false, 'css-heavy: the initial-payload sum fails');
  ok(sum.checks.find((c) => c.name === 'play-web initial payload (gzip)')?.actual === 274_000,
    'initial payload = entry js + entry css gzip bytes');
}

// ── Unknown / malformed measurements ─────────────────────────────────────────
{
  const undef = evaluateBundleBudget({
    assets: assets({ gzipBytes: undefined as unknown as number }),
    markers: markers(),
    policy: policy(),
  });
  invariants(undef, 'undefined-gzip');
  ok(undef.ok === false, 'undefined gzip size fails');
  ok(undef.checks.find((c) => c.name === 'play-web entry js (gzip)')?.kind === 'unknown',
    'undefined gzip size is reported as unknown, not coerced to 0');

  const nan = evaluateBundleBudget({
    assets: assets({ gzipBytes: Number.NaN }),
    markers: markers(),
    policy: policy(),
  });
  ok(nan.ok === false, 'NaN gzip size fails');

  const neg = evaluateBundleBudget({
    assets: assets({ bytes: -1 }),
    markers: markers(),
    policy: policy(),
  });
  ok(neg.ok === false, 'negative raw size fails');
  ok(neg.checks.find((c) => c.name === 'play-web entry js (raw)')?.kind === 'unknown',
    'negative raw size is reported as unknown');

  const empty = evaluateBundleBudget({ assets: [], markers: markers(), policy: policy() });
  invariants(empty, 'empty-assets');
  ok(empty.ok === false, 'an empty asset list fails (missing entry), never a vacuous pass');
  ok(empty.checks.filter((c) => c.kind === 'unknown').length === 3,
    'empty-assets: all three size checks fail as unknown');
  ok(empty.checks.filter((c) => c.kind === 'marker').every((c) => c.ok),
    'empty-assets: marker checks are independent of the missing entry asset');
}

// ── Forbidden dependency markers ─────────────────────────────────────────────
{
  const clean = evaluateBundleBudget({ assets: assets(), markers: markers(), policy: policy() });
  ok(clean.checks.filter((c) => c.kind === 'marker').every((c) => c.ok), 'all markers at 0 → pass');

  const one = evaluateBundleBudget({
    assets: assets(),
    markers: markers({ maplibre: 42 }),
    policy: policy(),
  });
  invariants(one, 'one-marker');
  ok(one.ok === false, 'a positive marker count fails');
  const m = one.checks.find((c) => c.name.includes('maplibre'));
  ok(m?.ok === false, 'the failing check names the dependency');
  ok(String(m?.detail).includes('index-abc.js'), 'the marker detail names the entry chunk');
  ok(one.checks.filter((c) => c.kind === 'marker' && !c.ok).length === 1, 'only the offending marker fails');

  const many = evaluateBundleBudget({
    assets: assets(),
    markers: markers({ maplibre: 3, jsqr: 1 }),
    policy: policy(),
  });
  ok(many.checks.filter((c) => c.kind === 'marker' && !c.ok).length === 2,
    'every offending dependency is reported, not just the first');
  ok(many.report.includes('maplibre') && many.report.includes('jsqr'),
    'the report names every offending dependency');

  const missing = evaluateBundleBudget({
    assets: assets(),
    markers: { maplibre: 0, jsqr: 0 } as Record<string, number>, // qrcode never measured
    policy: policy(),
  });
  invariants(missing, 'unmeasured-marker');
  ok(missing.ok === false, 'an unmeasured dependency fails rather than passing silently');
  ok(missing.checks.find((c) => c.name.includes('qrcode'))?.kind === 'unknown',
    'an unmeasured dependency is reported as unknown');
}

// ── Report ───────────────────────────────────────────────────────────────────
{
  const input = { assets: assets({ gzipBytes: 300_000 }), markers: markers({ jsqr: 2 }), policy: policy() };
  const a = evaluateBundleBudget(input);
  const b = evaluateBundleBudget(input);
  ok(a.report === b.report, 'formatBudgetReport is deterministic for the same input');
  ok(formatBudgetReport(a) === a.report, 'result.report is exactly formatBudgetReport(result)');
  for (const c of a.checks) ok(a.report.includes(c.name), `report contains check "${c.name}"`);

  const failingNames = a.checks.filter((c) => !c.ok).map((c) => c.name);
  ok(failingNames.length > 0, 'the failing fixture really has failing checks');
  const failLines = a.report.split('\n').filter((l) => l.includes('FAIL'));
  ok(failLines.length === failingNames.length, 'exactly the failing checks are marked FAIL');
  for (const n of failingNames) {
    ok(failLines.some((l) => l.includes(n)), `FAIL line present for "${n}"`);
  }

  const good = evaluateBundleBudget({ assets: assets(), markers: markers(), policy: policy() });
  ok(!good.report.includes('FAIL'), 'a fully passing run has no FAIL lines');
  ok(good.report.includes('headroom'), 'a passing report states remaining headroom');
}

// ── Purity ───────────────────────────────────────────────────────────────────
{
  const input = { assets: assets(), markers: markers(), policy: policy() };
  const before = JSON.stringify({ a: input.assets, m: input.markers });
  const r1 = evaluateBundleBudget(input);
  const r2 = evaluateBundleBudget(input);
  ok(JSON.stringify({ a: input.assets, m: input.markers }) === before, 'the input is not mutated');
  ok(r1.ok === r2.ok && r1.report === r2.report, 'repeated calls agree');
}

console.log(`  bundle-budget: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
