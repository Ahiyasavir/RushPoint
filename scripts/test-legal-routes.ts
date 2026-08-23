// Pure-logic tests for the participant-origin legal pages
// (change: legal-pages-participant-origin). Run by scripts/run-unit-tests.mjs
// via `npm test`. No emulator, no DOM, no bundler.
//
//   npx tsx scripts/test-legal-routes.ts
//
// The bug these guard: play-web has no router, so `/terms` and `/privacy` on the
// participant origin (the playtest tunnel root and the production play site) fell
// through to the player screen. Participants are the people who accept these
// documents; a privacy policy that renders a game is a compliance failure.
//
// Three units, all pure:
//   1. resolveLegalPath  — path → document, the ONLY new routing authority
//   2. resolvePlayRoute  — the legal route must win, must not clear a session,
//                          and must leave every existing route bit-identical
//   3. parseLegalMarkdown / LEGAL_DOCS — one shared source of policy text,
//                          escaped before emphasis markup is substituted
import assert from 'node:assert/strict';
import {
  resolveLegalPath,
  resolvePlayRoute,
  type PlayRoute,
  type SessionRef,
} from '../apps/play-web/src/lib/playRoute';
import { parseLegalMarkdown, renderInline } from '../packages/shared/src/legalMarkdown';
import { LEGAL_DOCS } from '../packages/shared/src/legalContent';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  x ${msg}`); }
}
function eq(a: unknown, b: unknown, msg: string) {
  try { assert.deepEqual(a, b); passed++; } catch {
    failed++;
    console.error(`  x ${msg}\n      got      ${JSON.stringify(a)}\n      expected ${JSON.stringify(b)}`);
  }
}

const sess = (code: string): SessionRef => ({ code });

// ── 1. resolveLegalPath ──────────────────────────────────────────────────────
{
  ok(resolveLegalPath('/terms') === 'terms', '/terms → terms');
  ok(resolveLegalPath('/privacy') === 'privacy', '/privacy → privacy');

  // Trailing slash — a link written either way must work.
  ok(resolveLegalPath('/terms/') === 'terms', 'trailing slash tolerated (/terms/)');
  ok(resolveLegalPath('/privacy/') === 'privacy', 'trailing slash tolerated (/privacy/)');

  // Case — store listings and printed material are not case-disciplined.
  ok(resolveLegalPath('/TERMS') === 'terms', 'upper case tolerated');
  ok(resolveLegalPath('/Privacy') === 'privacy', 'mixed case tolerated');
  ok(resolveLegalPath('/TeRmS/') === 'terms', 'mixed case + trailing slash tolerated');

  // A caller may hand us a value that still carries the query/hash.
  ok(resolveLegalPath('/terms?utm_source=x') === 'terms', 'query string ignored');
  ok(resolveLegalPath('/privacy?lang=en#s3') === 'privacy', 'query + fragment ignored');
  ok(resolveLegalPath('/terms#top') === 'terms', 'fragment ignored');

  // Everything else is NOT a legal path — the player screen must keep it.
  ok(resolveLegalPath('/') === null, 'root is not a legal path');
  ok(resolveLegalPath('') === null, 'empty path is not a legal path');
  ok(resolveLegalPath(undefined) === null, 'absent path is not a legal path');
  ok(resolveLegalPath(null) === null, 'null path is not a legal path');
  ok(resolveLegalPath('/termsofservice') === null, 'prefix near-miss is not a legal path');
  ok(resolveLegalPath('/terms/extra') === null, 'deeper path is not a legal path');
  ok(resolveLegalPath('/privacy-policy') === null, 'hyphen near-miss is not a legal path');
  ok(resolveLegalPath('/creator/terms') === null, 'the creator app owns /creator/terms, not play-web');
  ok(resolveLegalPath('/board') === null, 'an unrelated path is not a legal path');
}

// ── 2. resolvePlayRoute: the legal route ─────────────────────────────────────
{
  const r = resolvePlayRoute({ search: '', session: null, pathname: '/terms' });
  ok(r.route.kind === 'legal', '/terms resolves to the legal route');
  ok(r.route.kind === 'legal' && r.route.doc === 'terms', 'legal route carries doc=terms');
  ok(r.clearSession === false, 'reading the terms never clears a session');
}
{
  const r = resolvePlayRoute({ search: '', session: null, pathname: '/privacy' });
  ok(r.route.kind === 'legal' && r.route.doc === 'privacy', '/privacy carries doc=privacy');
}
{
  // A player mid-run must be able to read the policy without losing the run.
  const r = resolvePlayRoute({ search: '', session: sess('ABC123'), pathname: '/privacy' });
  ok(r.route.kind === 'legal', 'a stored session does not hide the document');
  ok(r.clearSession === false, 'a stored session survives reading the document');
}
{
  // A stored staff session outranks almost everything in this resolver — but not
  // an explicit document path.
  const r = resolvePlayRoute({ search: '', session: null, hasStaffSession: true, pathname: '/terms' });
  ok(r.route.kind === 'legal', 'a stored staff session does not hide the document');
}
{
  const r = resolvePlayRoute({ search: '?code=ABC123', session: null, pathname: '/terms' });
  ok(r.route.kind === 'legal', 'a join code in the query does not hide the document');
  ok(r.clearSession === false, 'the legal route never clears on a code link');
}
{
  const r = resolvePlayRoute({ search: '?staff=o.g.r', session: null, pathname: '/privacy' });
  ok(r.route.kind === 'legal', 'a staff param does not hide the document');
}

// ── 2b. Non-regression: every existing route is bit-identical ────────────────
// The resolver runs on every participant load at a live event. For any path that
// is not one of the two documents — including no path at all — the result must
// deep-equal today's result for the same search + session.
{
  const cases: Array<{ label: string; search: string; session: SessionRef | null; staff?: boolean }> = [
    { label: 'staff link',        search: '?staff=o.g.r',                 session: null },
    { label: 'legacy staff link', search: '?staff&owner=o&game=g&run=r',  session: null },
    { label: 'tv',                search: '?tv=ABC123',                   session: null },
    { label: 'recap',             search: '?recap=ABC123',                session: null },
    { label: 'ceremony',          search: '?board=ABC123&ceremony',       session: null },
    { label: 'board',             search: '?board=ABC123',                session: null },
    { label: 'challenge',         search: '?challenge=g1:t1',             session: null },
    { label: 'join by code',      search: '?code=ABC123',                 session: null },
    { label: 'same-run resume',   search: '?code=ABC123',                 session: sess('ABC123') },
    { label: 'different run',     search: '?code=ZZZ999',                 session: sess('ABC123') },
    { label: 'play (session)',    search: '',                             session: sess('ABC123') },
    { label: 'promo',             search: '?game=g1',                     session: null },
    { label: 'plain join',        search: '',                             session: null },
    { label: 'stored staff',      search: '',                             session: null, staff: true },
  ];
  const nonLegalPaths = [undefined, '/', '/anything-else', '/creator/terms', '/termsofservice'];
  for (const c of cases) {
    const baseline = resolvePlayRoute({ search: c.search, session: c.session, hasStaffSession: c.staff });
    for (const p of nonLegalPaths) {
      const got = resolvePlayRoute({ search: c.search, session: c.session, hasStaffSession: c.staff, pathname: p });
      eq(got, baseline, `${c.label} unchanged for pathname=${String(p)}`);
    }
  }
}

// ── 3. parseLegalMarkdown ────────────────────────────────────────────────────
type Block = ReturnType<typeof parseLegalMarkdown>[number];
const kinds = (t: string): string[] => parseLegalMarkdown(t).map((b: Block) => b.kind);
const first = (t: string): Block => parseLegalMarkdown(t)[0];

{
  // One block per source line — the renderer keys off that 1:1 mapping.
  ok(parseLegalMarkdown('a\nb\nc').length === 3, 'one block per line');
  eq(kinds('## H\n### S\n> Q\n**B**\n- L\n\nplain'),
    ['h2', 'h3', 'quote', 'strong', 'li', 'blank', 'p'], 'every block kind is recognized');

  const h2 = first('## Section 1');
  ok(h2.kind === 'h2' && h2.text === 'Section 1', 'h2 exposes plain text (never raw html)');
  const h3 = first('### 3.1 Sub');
  ok(h3.kind === 'h3' && h3.text === '3.1 Sub', 'h3 exposes plain text');
  const strong = first('**Whole line**');
  ok(strong.kind === 'strong' && strong.text === 'Whole line', 'a whole-line bold is its own block');

  // A line with an INNER bold pair is a paragraph, not a strong block — this is
  // the existing creator-web rule and the documents rely on it.
  ok(first('**A** and **B**').kind === 'p', 'a line with an inner bold pair stays a paragraph');
  ok(first('**A** trailing').kind === 'p', 'bold prefix without a bold suffix stays a paragraph');

  const li = first('- item **x**');
  ok(li.kind === 'li' && li.html === 'item <strong>x</strong>', 'list item carries inline html');
  const q = first('> note **x**');
  ok(q.kind === 'quote' && q.html === 'note <strong>x</strong>', 'quote carries inline html');
  ok(first('').kind === 'blank', 'an empty line is a spacer block');

  // Leading/trailing blank lines of the source body are trimmed (the document
  // bodies are template literals that start and end with a newline).
  ok(parseLegalMarkdown('\n\nx\n\n').length === 1, 'the body is trimmed before splitting');
}
{
  // Escape BEFORE emphasis: policy text can never inject markup.
  const p = first('a > b && c <script> **bold**');
  ok(p.kind === 'p', 'a line with a mid-line > is a paragraph, not a quote');
  ok(p.html === 'a &gt; b &amp;&amp; c &lt;script&gt; <strong>bold</strong>',
    'block html is escaped first, then bolded');
  ok(!/<script>/.test(String(p.html)), 'no raw tag survives into block html');
  ok(first('- <img src=x> **y**').html === renderInline('<img src=x> **y**'),
    'blocks reuse renderInline — one escaping authority');
}

// ── 4. LEGAL_DOCS integrity ──────────────────────────────────────────────────
{
  const HEBREW = /[֐-׿]/;
  for (const type of ['privacy', 'terms'] as const) {
    for (const lang of ['he', 'en'] as const) {
      const doc = LEGAL_DOCS[type][lang];
      ok(!!doc, `LEGAL_DOCS has ${type}.${lang}`);
      ok(doc.title.trim().length > 0, `${type}.${lang} has a title`);
      ok(doc.updated.trim().length > 0, `${type}.${lang} has an updated line`);
      ok(doc.body.trim().length > 2000, `${type}.${lang} body is a real document`);
      // No `|` table row — the legal-page-polish P2 regression, now guarded at
      // the source instead of by scanning a component file.
      ok(!/\n\s*\|[^\n]*\|[^\n]*\|/.test(doc.body), `${type}.${lang} has no markdown table row`);
    }
    ok(HEBREW.test(LEGAL_DOCS[type].he.body), `${type}.he is written in Hebrew`);
    ok(!HEBREW.test(LEGAL_DOCS[type].en.body), `${type}.en carries no Hebrew`);
    ok(HEBREW.test(LEGAL_DOCS[type].he.title), `${type}.he title is Hebrew`);
    ok(!HEBREW.test(LEGAL_DOCS[type].en.title), `${type}.en title is English`);
  }
  // Every line of every document must parse into a block (totality).
  for (const type of ['privacy', 'terms'] as const) {
    for (const lang of ['he', 'en'] as const) {
      const body = LEGAL_DOCS[type][lang].body;
      const blocks = parseLegalMarkdown(body);
      ok(blocks.length === body.trim().split('\n').length, `${type}.${lang} parses one block per line`);
      ok(blocks.every((b: Block) => typeof b.kind === 'string'), `${type}.${lang} has no unclassified line`);
    }
  }
}

console.log(`${failed === 0 ? 'PASS' : 'FAIL'} legal-routes — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
