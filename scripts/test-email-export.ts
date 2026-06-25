// Unit test for the operator mailing-list export (TECH_SPEC §26.A, Appendix B #30).
// Plain tsx assertion script (matches test-tiebreaker.ts). Asserts the PURE
// segmentation — no emulator needed. Run: npx tsx scripts/test-email-export.ts
//
// @ts-expect-error — sibling .mjs has no type declarations; tsx resolves it fine.
import { segmentEmails, csv, formatReport } from './export-emails.mjs';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── 1. Segments into 3 lists: marketing / updates-only / combined (1 ∪ 2) ──────
{
  const seg = segmentEmails([
    { email: 'ads@x.com', marketingConsent: true },
    { email: 'news@x.com', updatesConsent: true },
    { email: 'both@x.com', marketingConsent: true, updatesConsent: true }, // marketing wins (else-if)
  ]);
  check('marketing list = ads + both', seg.marketing.sort().join(',') === 'ads@x.com,both@x.com',
    seg.marketing.join(','));
  check('updates-only list = news', seg.updatesOnly.join(',') === 'news@x.com', seg.updatesOnly.join(','));
  check('combined = marketing ∪ updates-only (1 ∪ 2)',
    seg.combined.slice().sort().join(',') === 'ads@x.com,both@x.com,news@x.com', seg.combined.join(','));
  check('a marketing consenter is NOT double-listed in updates-only',
    !seg.updatesOnly.includes('both@x.com'));
}

// ── 2. csv() is comma-separated, de-duplicated, sorted — paste-ready for BCC ───
{
  // Two accounts share an address (same person) → must appear once.
  const out = csv(['zed@x.com', 'amy@x.com', 'zed@x.com', 'bob@x.com']);
  check('csv is sorted + comma-space separated', out === 'amy@x.com, bob@x.com, zed@x.com', out);
  check('csv de-duplicates repeated addresses', out.split(', ').length === 3, out);
  check('empty list renders cleanly', csv([]) === '', `"${csv([])}"`);
}

// ── 3. no-consent + no-email + minors are EXCLUDED from every list (and counted) ─
{
  const seg = segmentEmails([
    { email: 'ok@x.com', marketingConsent: true },
    { email: 'silent@x.com' },                                  // no consent at all
    { email: 'kid@x.com', marketingConsent: true, isMinor: true }, // minor — excluded despite consent
    { marketingConsent: true },                                  // no email
    { email: '', updatesConsent: true },                         // empty email
    null,                                                        // junk record
  ]);
  const everyone = [...seg.marketing, ...seg.updatesOnly, ...seg.combined];
  check('no-consent address never appears', !everyone.includes('silent@x.com'));
  check('minor never appears in any list', !everyone.includes('kid@x.com'));
  check('only the one valid consenter is reachable', seg.combined.join(',') === 'ok@x.com', seg.combined.join(','));
  check('excludedNoConsent counted', seg.excludedNoConsent === 1, `=${seg.excludedNoConsent}`);
  check('excludedMinor counted', seg.excludedMinor === 1, `=${seg.excludedMinor}`);
  check('excludedNoEmail counted (missing + empty + junk)', seg.excludedNoEmail === 3, `=${seg.excludedNoEmail}`);
}

// ── 4. formatReport renders all three labelled blocks with counts ─────────────
{
  const report = formatReport(segmentEmails([{ email: 'a@x.com', marketingConsent: true }]));
  check('report has MARKETING block', report.includes('# MARKETING'));
  check('report has UPDATES ONLY block', report.includes('# UPDATES ONLY'));
  check('report has COMBINED block', report.includes('# COMBINED'));
  check('empty section shows (none)', report.includes('(none)'));
}

console.log(`\n${failures === 0 ? 'ALL EMAIL-EXPORT TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
