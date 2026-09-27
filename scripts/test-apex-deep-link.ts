// The apex must not swallow a link that was minted for the participant app
// (change: marketing-to-apex).
//
// WHY THIS EXISTS
//
// `rush-point.com` served play-web until 2026-09-01 and now serves the marketing
// site. Every join link already in the world points there: printed QR codes, links
// forwarded in WhatsApp, bookmarks, and every installed Play Store build older than
// versionCode 5, whose Digital Asset Links scope is still the apex. If the apex just
// renders a marketing page for those, the person holding the link concludes the game
// is broken, and there is no error anywhere to find.
//
// Two mechanisms carry that, and each has a different failure mode:
//
//   PART A — the query-string links (`?code=`, `?game=`, `?board=`, `?staff`).
//     Firebase Hosting redirects match the PATH only, so these CANNOT be expressed
//     in firebase.json. They are handled by an inline script in the marketing head
//     (PlayerDeepLink.astro). This part extracts that script from the SOURCE and
//     RUNS it, rather than asserting the source text looks right: a redirect that is
//     present but subtly wrong reads identically to a correct one.
//
//   PART B — the path links (the occasion landing pages, and the two legal
//     documents). These are ordinary 301s in firebase.json. The risk here is drift:
//     a landing page added to the registry later has no redirect, and nothing fails.
//     So the table is checked AGAINST the registry rather than against a copy of it.
//
// Pure. No build, no emulator, no network.
//   npx tsx scripts/test-apex-deep-link.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANDING_PAGES, LANDING_ORIGIN } from './lib/landingPages';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── PART A — the query-string rescue, executed for real ──────────────────────

console.log('A · the inline apex rescue script');

const componentPath = join(ROOT, 'apps', 'marketing', 'src', 'components', 'common', 'PlayerDeepLink.astro');
const component = readFileSync(componentPath, 'utf8');

const scriptMatch = component.match(/<script[^>]*>([\s\S]*?)<\/script>/);
check('A · the component ships an inline script', scriptMatch !== null);

// `is:inline` is not cosmetic: without it Astro processes and bundles the script,
// which defers it. A deferred redirect runs after the marketing page has already
// started rendering and after the analytics tag has recorded a page_view for a page
// the visitor was never meant to see.
check('A · the script is is:inline', /<script[^>]*\bis:inline\b/.test(component));

const scriptBody = scriptMatch ? scriptMatch[1] : '';

interface Case {
  readonly search: string;
  readonly hash: string;
  readonly expected: string | null;
}

const PLAYER = 'https://player.rush-point.com';
const cases: Case[] = [
  // The four link shapes the participant app answers.
  { search: '?code=SANSANA', hash: '', expected: `${PLAYER}/?code=SANSANA` },
  { search: '?game=abc123', hash: '', expected: `${PLAYER}/?game=abc123` },
  { search: '?board=XYZ', hash: '', expected: `${PLAYER}/?board=XYZ` },
  { search: '?staff', hash: '', expected: `${PLAYER}/?staff` },

  // The whole query survives, not just the recognised key: a join link that also
  // carries campaign params must arrive intact, and the hash with it.
  { search: '?code=A&utm_source=poster', hash: '#top', expected: `${PLAYER}/?code=A&utm_source=poster#top` },

  // The negative cases. These matter more than the positive ones: a rescue that
  // fires too eagerly takes every marketing visitor off the marketing site, which
  // is the exact opposite of why the apex was moved here.
  { search: '', hash: '', expected: null },
  { search: '?utm_source=poster', hash: '', expected: null },
  { search: '?lang=en', hash: '', expected: null },
];

let ran = 0;
for (const { search, hash, expected } of cases) {
  let replaced: string | null = null;
  const fakeWindow = {
    location: {
      search,
      hash,
      replace: (url: string) => { replaced = url; },
    },
  };

  // The component reads its origin from `define:vars`, which Astro injects as a
  // `playerOrigin` binding. Supply it the same way rather than hardcoding it into
  // the script text, so this exercises the real body.
  const run = new Function('window', 'URLSearchParams', 'playerOrigin', scriptBody);
  run(fakeWindow, URLSearchParams, PLAYER);
  ran++;

  const label = `A · ${search || '(no query)'}${hash}`;
  check(
    expected === null ? `${label} stays on the marketing site` : `${label} reaches the participant app`,
    replaced === expected,
    replaced ?? 'no redirect',
  );
}
check('A · the case sweep actually executed the script', ran === cases.length, `${ran} case(s)`);

// ── PART B — the path redirects, checked against the registry ────────────────

console.log('B · the hosting redirect table');

interface HostingSite {
  target?: string;
  redirects?: { source: string; destination: string; type: number }[];
}

const firebaseConfig = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8')) as {
  hosting: HostingSite[];
};
const marketing = firebaseConfig.hosting.find((site) => site.target === 'marketing');
check('B · the marketing target exists', marketing !== undefined);

const redirects = marketing?.redirects ?? [];
const destinationFor = (source: string): string | undefined =>
  redirects.find((r) => r.source === source)?.destination;
const typeFor = (source: string): number | undefined =>
  redirects.find((r) => r.source === source)?.type;

// Every landing page except the language INDEX. `/he/` and `/en/` are the marketing
// site's own home pages now — redirecting those would send every visitor straight
// back off the site, which is the one URL whose meaning this change deliberately
// changes.
const moved = LANDING_PAGES.filter((page) => page.slug !== '');
check('B · there are landing pages to check', moved.length >= 8, `${moved.length} page(s)`);

for (const page of moved) {
  const path = `/${page.language}/${page.slug}`;
  const wanted = `${LANDING_ORIGIN}/${page.language}/${page.slug}/`;

  // Both the bare and the trailing-slash form. The marketing target sets
  // `trailingSlash: true`, so a request arrives in one form or the other depending
  // on how the link was written; guessing which one the redirect table sees is not
  // worth the cost of being wrong, which is a dead indexed URL.
  check(`B · ${path} redirects`, destinationFor(path) === wanted, destinationFor(path) ?? 'MISSING');
  check(`B · ${path}/ redirects`, destinationFor(`${path}/`) === wanted, destinationFor(`${path}/`) ?? 'MISSING');
  check(`B · ${path} is a 301`, typeFor(path) === 301, String(typeFor(path)));
}

// The legal documents are served by play-web, and they were reachable on the apex
// for as long as the apex was play-web. They are linked from app stores and policy
// forms, which are the slowest links in the world to get corrected.
for (const doc of ['/terms', '/privacy']) {
  check(`B · ${doc} redirects to the participant app`,
    destinationFor(doc) === `${LANDING_ORIGIN}${doc}`, destinationFor(doc) ?? 'MISSING');
  check(`B · ${doc} is a 301`, typeFor(doc) === 301, String(typeFor(doc)));
}

// The site's own front door still opens.
check('B · the apex root still opens the Hebrew home',
  destinationFor('/') === '/he/' && typeFor('/') === 302,
  `${destinationFor('/')} (${typeFor('/')})`);

// ── PART C — the service worker the old app left behind ──────────────────────
//
// play-web registers /sw.js on every production visit, and a service worker is
// scoped to an ORIGIN. Every returning visitor to the apex still has play-web's
// worker installed and controlling this site. It is replaced only by whatever the
// browser finds at the SAME path, so the file has to exist here — deleting it would
// leave the old worker in place forever, because a 404 is not an update.

console.log('C · the apex reclaims the old service worker scope');

const swPath = join(ROOT, 'apps', 'marketing', 'public', 'sw.js');
let sw = '';
try {
  sw = readFileSync(swPath, 'utf8');
} catch {
  sw = '';
}
check('C · the apex serves a /sw.js', sw.length > 0, swPath);
check('C · it unregisters itself', /registration\.unregister\(\)/.test(sw));
check('C · it clears the caches the old worker filled', /caches\s*\n?\s*\.keys\(\)/.test(sw) && /caches\.delete/.test(sw));
check('C · it takes over immediately rather than waiting for every tab to close',
  /skipWaiting\(\)/.test(sw));
// A fetch handler would make this worker intercept requests, which is the behaviour
// being removed. Its absence is the point, so it is asserted rather than assumed.
check('C · it registers no fetch handler', !/addEventListener\(\s*['"]fetch['"]/.test(sw));

console.log(failures === 0 ? '\nALL APEX DEEP LINK TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
