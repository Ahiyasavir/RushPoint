// Pure bundle-budget decision logic (change: play-web-bundle-budget).
//
// No filesystem, no zlib, no clock, no env — the caller measures, this module
// decides. That is what lets scripts/test-bundle-budget.ts cover the adversarial
// cases (no entry chunk, two entry chunks, exactly-at-budget, unknown sizes,
// a heavy dependency that drifted into the entry) with synthetic fixtures and no
// build at all. The I/O side lives in scripts/check-bundle-budget.mjs.
//
// Why a budget exists: apps/play-web is loaded by participants outdoors on weak
// mobile data, mid-game. A single static import can silently collapse a lazy
// boundary — the build still succeeds and every gate still passes — so the entry
// chunk is checked by bytes AND by the direct absence of named heavy deps
// (maplibre-gl / jsqr / qrcode). The byte budget catches large collapses; the
// marker check catches a dependency small enough to hide inside the headroom.

/** A finite, non-negative number is the only measurement we trust. */
function isMeasured(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

function pct(part, whole) {
  if (!isMeasured(whole) || whole === 0) return '—';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function fmtBytes(n) {
  if (!isMeasured(n)) return '?';
  return n.toLocaleString('en-US');
}

/**
 * Pick THE asset matching `pattern`.
 *
 * Ambiguity is a failure, never a pass: zero matches means the build emitted no
 * entry chunk (or the pattern rotted), two matches mean the pattern has stopped
 * identifying the entry. A budget check that passes when it cannot measure is
 * worse than no check, because it is believed.
 *
 * @returns {{ok: true, asset: object} | {ok: false, problem: 'missing'|'ambiguous', detail: string}}
 */
export function selectAsset(assets, pattern) {
  const list = Array.isArray(assets) ? assets : [];
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  const hits = list.filter((a) => a && typeof a.file === 'string' && re.test(a.file));
  if (hits.length === 0) {
    return { ok: false, problem: 'missing', detail: `no asset matched ${re.source}` };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      problem: 'ambiguous',
      detail: `${hits.length} assets matched ${re.source}: ${hits.map((h) => h.file).join(', ')}`,
    };
  }
  return { ok: true, asset: hits[0] };
}

/** One size check: `actual <= limit` passes; an unmeasurable value fails as 'unknown'. */
function sizeCheck({ name, actual, limit, source }) {
  if (!isMeasured(actual)) {
    return { name, kind: 'unknown', actual: null, limit, ok: false, detail: source };
  }
  if (actual <= limit) {
    const left = limit - actual;
    return {
      name, kind: 'size', actual, limit, ok: true,
      detail: `headroom ${fmtBytes(left)} B (${pct(left, limit)})`,
    };
  }
  const over = actual - limit;
  return {
    name, kind: 'size', actual, limit, ok: false,
    detail: `OVER by ${fmtBytes(over)} B (${pct(over, limit)})`,
  };
}

/**
 * Evaluate a built app against a budget policy.
 *
 * @param assets  [{ file, bytes, gzipBytes }] — every emitted asset.
 * @param markers { [dependency]: hitCount } — occurrences of each forbidden
 *                dependency in the ENTRY chunk's text, as counted by the caller.
 * @param policy  { label, entryJs, entryCss, maxEntryGzipBytes, maxEntryRawBytes,
 *                  maxInitialGzipBytes, forbiddenMarkers: string[] }
 * @returns {{ ok: boolean, checks: object[], report: string }}
 *
 * Total: every policy entry yields exactly one check, and `ok` is the
 * conjunction of them — so a check can never be silently skipped.
 */
export function evaluateBundleBudget({ assets, markers, policy }) {
  const label = policy.label ?? 'app';
  const checks = [];

  const js = selectAsset(assets, policy.entryJs);
  const css = selectAsset(assets, policy.entryCss);

  checks.push(sizeCheck({
    name: `${label} entry js (gzip)`,
    actual: js.ok ? js.asset.gzipBytes : undefined,
    limit: policy.maxEntryGzipBytes,
    source: js.ok ? `unmeasurable gzip size for ${js.asset.file}` : js.detail,
  }));

  checks.push(sizeCheck({
    name: `${label} entry js (raw)`,
    actual: js.ok ? js.asset.bytes : undefined,
    limit: policy.maxEntryRawBytes,
    source: js.ok ? `unmeasurable raw size for ${js.asset.file}` : js.detail,
  }));

  // Initial payload = what the browser must fetch before first paint: the entry
  // script plus the entry stylesheet. index.html is excluded (it is tiny and its
  // bytes track the hashed filenames it references); the lazy map stylesheet is
  // excluded because it arrives with the map chunk, not at first paint.
  const initialParts = [js, css];
  const initialMeasured = initialParts.every((p) => p.ok && isMeasured(p.asset.gzipBytes));
  checks.push(sizeCheck({
    name: `${label} initial payload (gzip)`,
    actual: initialMeasured ? initialParts.reduce((sum, p) => sum + p.asset.gzipBytes, 0) : undefined,
    limit: policy.maxInitialGzipBytes,
    source: initialParts.filter((p) => !p.ok).map((p) => p.detail).join('; ')
      || 'unmeasurable gzip size in the initial payload',
  }));

  const entryName = js.ok ? js.asset.file : '(no entry chunk)';
  for (const dep of policy.forbiddenMarkers ?? []) {
    const hits = markers ? markers[dep] : undefined;
    if (!isMeasured(hits)) {
      checks.push({
        name: `${label} entry free of "${dep}"`,
        kind: 'unknown', actual: null, limit: 0, ok: false,
        // The runner promised to measure this and did not. Passing here would
        // quietly retire the check that catches a small-but-heavy dependency.
        detail: `no measurement for "${dep}" — the entry chunk was not scanned for it`,
      });
      continue;
    }
    checks.push({
      name: `${label} entry free of "${dep}"`,
      kind: 'marker',
      actual: hits,
      limit: 0,
      ok: hits === 0,
      detail: hits === 0
        ? `absent from ${entryName} (lazy boundary holds)`
        : `${hits} occurrence(s) in ${entryName} — this dependency must stay behind a dynamic import`,
    });
  }

  const result = { ok: checks.every((c) => c.ok), checks };
  result.report = formatBudgetReport(result);
  return result;
}

/**
 * Deterministic, human-readable report. A failure must name the asset, the
 * number and the overage without any further investigation, so every check is
 * printed — passing ones too — with its measured value, limit and headroom.
 */
export function formatBudgetReport(result) {
  const lines = [];
  const width = Math.max(...result.checks.map((c) => c.name.length), 0);
  for (const c of result.checks) {
    const mark = c.ok ? 'ok  ' : 'FAIL';
    const value = c.kind === 'marker'
      ? `${c.actual} hit(s)`
      : c.actual === null ? 'unmeasured' : `${fmtBytes(c.actual)} B`;
    const limit = c.kind === 'marker' ? '0 hit(s)' : `${fmtBytes(c.limit)} B`;
    lines.push(`  ${mark}  ${c.name.padEnd(width)}  ${value.padStart(13)}  / ${limit.padStart(13)}  ${c.detail}`);
  }
  return lines.join('\n');
}
