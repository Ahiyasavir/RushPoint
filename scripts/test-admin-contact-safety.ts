/**
 * Contact message content is DATA, never markup (change: marketing-site).
 *
 * Every field on the admin contact page was typed by an anonymous stranger into a
 * form on a public website. That makes it the least trustworthy input the product
 * has: there is no account behind it, no rate of trust built up over time, and no
 * prior interaction. It is also the only such input the product renders back to a
 * human at all.
 *
 * There is no component test runner in this repository, so this is a source scan.
 * A scan cannot prove a page is safe. What it CAN do is fail the moment someone
 * reaches for the one API that would make it unsafe, which is the realistic way
 * this regresses: not by someone deciding to trust the input, but by someone
 * pasting a snippet that renders rich text and not thinking about where the text
 * came from.
 *
 * It is deliberately narrow. It is not an XSS scanner.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const PAGE = join(ROOT, 'apps', 'creator-web', 'src', 'pages', 'AdminContactPage.tsx');

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
}

// The reach assertion first. Every check below is an absence, and an absence over
// a file that is not there is a green nobody earned. If the page is renamed, this
// must fail loudly rather than quietly stop checking anything.
check('the page this guards actually exists', existsSync(PAGE), PAGE);

if (!existsSync(PAGE)) {
  console.log('');
  console.log(`ADMIN CONTACT SAFETY TESTS FAILED :: ${failures} of ${checks}`);
  process.exit(1);
}

const raw = readFileSync(PAGE, 'utf8');
check('the page is not empty', raw.length > 500, `${raw.length} chars`);

// Comments are stripped before scanning, because the page's own comments NAME the
// APIs it is refusing to use, and a checker that cannot tell "we do not do this"
// from "we do this" is a checker that forces the explanation to be deleted. The
// direction attribute check runs against the raw text for the opposite reason: it
// counts real occurrences, and a comment never renders one.
const source = raw
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

check(
  'the page never sets inner HTML',
  !/dangerouslySetInnerHTML/.test(source),
  'dangerouslySetInnerHTML',
);

// A markdown or rich text renderer would reintroduce the same hazard through a
// different door, and would look entirely reasonable in review.
check(
  'the page renders no markdown or rich text',
  !/\b(ReactMarkdown|marked|DOMPurify|sanitizeHtml|innerHTML)\b/.test(source),
  'rich text renderer',
);

// The reply link is built from the sender's own address. An unescaped newline in
// a mailto turns everything after it into additional mail headers, so the escape
// is load bearing rather than tidiness.
check(
  'the reply link escapes the address it was given',
  /mailto:\$\{encodeURIComponent\(/.test(source),
  'encodeURIComponent on the mailto address',
);

// A name or a message may be Hebrew or Latin, and the page's own language is not
// a guide to either. Without dir="auto" a Hebrew message on an English console
// renders with its punctuation in the wrong place.
check(
  'sender authored text is rendered with automatic direction',
  (raw.match(/dir="auto"/g) ?? []).length >= 2,
  `${(raw.match(/dir="auto"/g) ?? []).length} occurrence(s)`,
);

console.log('');
if (failures > 0) {
  console.log(`ADMIN CONTACT SAFETY TESTS FAILED :: ${failures} of ${checks}`);
  process.exit(1);
}
console.log(`ALL ADMIN CONTACT SAFETY TESTS PASSED :: ${checks} checks`);
