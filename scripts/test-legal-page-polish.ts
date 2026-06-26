// Pure-logic tests for LegalPage polish (change: prelaunch-polish, P6/P2).
// renderInline must HTML-escape a raw line BEFORE substituting **bold** → <strong>,
// so stray HTML in the policy text can never be injected as markup. Pure module
// (no React) so the tsx lane can import it. No emulator.
//   npx tsx scripts/test-legal-page-polish.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { escapeHtml, renderInline } from '../apps/creator-web/src/pages/legalMarkdown';

// escapeHtml
assert.equal(escapeHtml('<script>&"test"</script>'), '&lt;script&gt;&amp;&quot;test&quot;&lt;/script&gt;');
assert.equal(escapeHtml('no special chars'), 'no special chars');
assert.equal(escapeHtml('a > b && c < d'), 'a &gt; b &amp;&amp; c &lt; d');

// renderInline — escape-then-bold ordering
assert.equal(renderInline('plain & <b>'), 'plain &amp; &lt;b&gt;');
assert.equal(renderInline('**bold**'), '<strong>bold</strong>');
assert.equal(renderInline('a **b** & <c>'), 'a <strong>b</strong> &amp; &lt;c&gt;');

// P2 regression guard — no fake Markdown table row anywhere in LegalPage source.
const src = readFileSync(new URL('../apps/creator-web/src/pages/LegalPage.tsx', import.meta.url), 'utf8');
assert.ok(!/\n\s*\|[^\n]*\|[^\n]*\|/.test(src), 'LegalPage must not contain a | table row');

console.log('PASS legal-page-polish');
