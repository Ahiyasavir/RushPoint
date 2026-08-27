/**
 * The marketing site's HOSTING contract.
 *
 * The load bearing property here is an ABSENCE, and absences are exactly what
 * nobody notices being added back. The two React apps need a catch-all rewrite
 * because their routes exist only inside a router. This site is static output
 * with real files at real paths, so a catch-all would turn every typo, every
 * stale link and every deleted page into a 200 serving the wrong document. A
 * soft 200 is indexable, which is worse for a crawler than an honest 404.
 *
 * The single redirect is deliberately NOT a rewrite. `/` genuinely moved to a
 * language home, and a redirect says so; a rewrite would instead publish a
 * duplicate of `/he/` at a second URL and invite the two to compete. It is 302
 * rather than 301 because which language a bare visit should land on is a
 * judgement that may change, and a 301 is cached by browsers for practical
 * purposes forever.
 *
 * Change: marketing-site.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LANGUAGES, pagePath } from './lib/marketingSite.ts';

const ROOT = join(import.meta.dirname, '..');

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
}

const firebase = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
const firebaserc = JSON.parse(readFileSync(join(ROOT, '.firebaserc'), 'utf8'));

const hosting: Array<Record<string, unknown>> = firebase.hosting ?? [];
const marketing = hosting.find((h) => h.target === 'marketing');

check('A · a marketing hosting target is declared', Boolean(marketing), `${hosting.length} target(s)`);

if (!marketing) {
  console.log('');
  console.log(`MARKETING HOSTING TESTS FAILED :: ${failures} of ${checks}`);
  process.exit(1);
}

check(
  'A · it serves the marketing build output',
  marketing.public === 'apps/marketing/dist',
  String(marketing.public),
);

// The absence, asserted directly.
const rewrites = (marketing.rewrites ?? []) as Array<{ source?: string }>;
check(
  'B · the marketing target declares NO catch all rewrite',
  !rewrites.some((r) => r.source === '**'),
  rewrites.length === 0 ? 'no rewrites at all' : `${rewrites.length} rewrite(s)`,
);

// ...and its converse, so this file also documents that the apps still need one.
// If a future change strips the apps' rewrite, their routers break, and it is
// worth failing here rather than discovering it as a blank page.
for (const target of ['creator', 'play']) {
  const app = hosting.find((h) => h.target === target) as { rewrites?: Array<{ source?: string }> } | undefined;
  check(
    `B · the ${target} app still HAS its catch all rewrite`,
    Boolean(app?.rewrites?.some((r) => r.source === '**')),
    target,
  );
}

// The single redirect.
const redirects = (marketing.redirects ?? []) as Array<{ source?: string; destination?: string; type?: number }>;
const root = redirects.find((r) => r.source === '/');

check('C · `/` is redirected rather than left unmatched', Boolean(root), `${redirects.length} redirect(s)`);
check(
  'C · it points at a real language home',
  Boolean(root) && LANGUAGES.some((lang) => root!.destination === pagePath(lang, '')),
  root ? String(root.destination) : '(absent)',
);
check(
  'C · it is a 302, not a permanent redirect',
  root?.type === 302,
  root ? String(root.type) : '(absent)',
);
check(
  'C · no redirect is a catch all in disguise',
  !redirects.some((r) => r.source === '**' || r.source === '/**'),
  `${redirects.length} redirect(s)`,
);

// The target has to be mapped to an actual Hosting site or a deploy fails with a
// message about targets rather than about anything you just changed.
const targets = firebaserc?.targets?.['rushpoint-pwa-7daaa']?.hosting ?? {};
check(
  'D · the marketing target is mapped to a hosting site',
  Array.isArray(targets.marketing) && targets.marketing.length > 0,
  JSON.stringify(targets.marketing ?? null),
);

console.log('');
if (failures > 0) {
  console.log(`MARKETING HOSTING TESTS FAILED :: ${failures} of ${checks}`);
  process.exit(1);
}
console.log(`ALL MARKETING HOSTING TESTS PASSED :: ${checks} checks`);
