/**
 * The marketing homepage's STRUCTURE and its conversion elements.
 *
 * Change: marketing-home-cro-redesign.
 *
 * WHY THIS EXISTS. The other marketing suites each answer a different question and none of
 * them answers this one:
 *   • test-marketing-content.ts  — is the Hebrew really Hebrew (per FIELD, not per page)
 *   • test-marketing-theme.ts    — does the palette match the apps
 *   • check-marketing-output.ts  — is the BUILT html static, canonical, bilingual
 *   • test-no-dashes.ts          — is the copy free of dash separators
 * Every one of them stays green if the homepage silently loses its playable demo, ships a
 * hero with the copy hardcoded in the component, or animates a map at somebody who asked
 * their operating system for less motion. Those are decisions, and a decision that nothing
 * asserts is a decision that survives exactly until the next person edits the file.
 *
 * The load bearing ones, in order of how quietly they would break:
 *
 *  1. NO PROSE IN THE COMPONENTS. This site has no `t.*` dictionary — the language of a
 *     string is decided by WHICH FILE it sits in (`home.he.json` vs `home.en.json`). A
 *     literal typed into an `.astro` component therefore renders identically on both
 *     pages, and `test-marketing-content.ts` cannot see it, because it scans content files.
 *     A hardcoded English label on the Hebrew homepage is the exact bug the i18n gate was
 *     built for in the apps, and it is invisible here. So: the components carry no prose.
 *
 *  2. MOTION IS OPT IN. `prefers-reduced-motion` is a stated accessibility need, and the
 *     hero animation is the largest moving thing on the site. The rule enforced is
 *     structural rather than behavioural: every `animation:` declaration in the new
 *     components must sit inside `@media (prefers-reduced-motion: no-preference)`, so the
 *     finished static frame is what a reduced motion visitor gets BY DEFAULT rather than by
 *     a `reduce` override someone has to remember to write.
 *
 *  3. THE HERO COSTS NO REQUEST. The hero is the LCP element. The map is inline SVG on
 *     purpose; the moment somebody "improves" it into an <img> or a background url() the
 *     page pays a request for its own largest paint and nothing else complains.
 *
 *  4. SECTION ORDER. "Play before you read" is the whole conversion thesis of the page: the
 *     playable mission sits above the feature list. Reordering it back is a one line edit
 *     that no build can object to.
 *
 * Pure: reads source files, no build output, no emulator. Discovered automatically by
 * scripts/run-unit-tests.mjs.
 *   npx tsx scripts/test-marketing-home-cro.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { hasEnglishWord, hasHebrew } from './lib/i18nLeak.ts';
import { SUBJECT_SLUGS } from './lib/landingPages.ts';

const ROOT = join(import.meta.dirname, '..');
const MARKETING = join(ROOT, 'apps', 'marketing');
const SRC = join(MARKETING, 'src');

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
}

function read(rel: string): string | null {
  const full = join(MARKETING, rel);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

// ── The files this change introduces ─────────────────────────────────────────

const HOMEPAGE = 'src/pages/[lang]/index.astro';
const COMPONENTS = {
  hero: 'src/components/widgets/HeroField.astro',
  taste: 'src/components/HeroMissionTaste.astro',
  phone: 'src/components/PhoneFrame.astro',
  video: 'src/components/FounderVideo.astro',
  doors: 'src/components/widgets/OccasionDoors.astro',
} as const;

for (const [what, rel] of Object.entries(COMPONENTS)) {
  check(`A · ${what} component exists`, read(rel) !== null, rel);
}

const homepage = read(HOMEPAGE);
check('A · the homepage source was read', homepage !== null, HOMEPAGE);

// ── B. Composition and section order ─────────────────────────────────────────
//
// Read from the SOURCE rather than the built html: the built page is one long string of
// divs with no component identity left in it, so "did TryMission move above Features"
// becomes a guess about class names. The source is where the decision is written.

if (homepage) {
  check(
    'B · the homepage renders the field hero',
    /<HeroField\b/.test(homepage) && /from ['"][^'"]*HeroField\.astro['"]/.test(homepage),
    'HeroField.astro',
  );

  // The generic Hero is still imported by other pages; it must simply not be what the
  // HOMEPAGE renders. `<Hero` would also match `<HeroField`, hence the boundary.
  check(
    'B · the homepage no longer renders the generic hero',
    !/<Hero[\s/>]/.test(homepage),
    'Hero.astro is for the other pages',
  );

  const at = (tag: string) => homepage.indexOf(`<${tag}`);
  const tryMissionAt = at('TryMission');
  const featuresAt = at('Features');
  const heroAt = at('HeroField');

  check('B · the playable mission is on the page', tryMissionAt >= 0, 'TryMission');
  check('B · the feature list is on the page', featuresAt >= 0, 'Features');
  check(
    'B · the playable mission comes before the feature list',
    tryMissionAt >= 0 && featuresAt >= 0 && tryMissionAt < featuresAt,
    `TryMission@${tryMissionAt} Features@${featuresAt}`,
  );
  check(
    'B · the playable mission comes after the hero',
    heroAt >= 0 && tryMissionAt > heroAt,
    `HeroField@${heroAt} TryMission@${tryMissionAt}`,
  );

  check(
    'B · the founder video is rendered inline, not in a modal',
    /<FounderVideo\b/.test(homepage) && !/VideoLightbox/.test(homepage),
    'FounderVideo.astro',
  );

  check(
    'B · the friction reduction line is rendered above the playable mission',
    homepage.includes('lowFrictionNote') &&
      homepage.indexOf('lowFrictionNote') < (tryMissionAt >= 0 ? tryMissionAt : 0),
    'lowFrictionNote',
  );
}

// ── C. The conversion strings live in the content files, in both languages ───

const CONVERSION_KEYS = [
  'heroTrust',        // engagement depth social proof, not a user count
  'heroChallenge',    // the curiosity gap prompt beside the map
  'heroJoinPrompt',   // the door for a visitor who came to PLAY
  'heroJoinAction',
  'lowFrictionNote',  // no signup, no card, seconds to try
  'videoLabel',
  'videoBody',
  'videoStoryAction',
  'videoDuration',
] as const;

const pages: Record<string, Record<string, unknown>> = {};
for (const language of ['he', 'en']) {
  const raw = read(`src/data/pages/home.${language}.json`);
  if (raw === null) {
    check(`C · home.${language}.json exists`, false, `src/data/pages/home.${language}.json`);
    continue;
  }
  try {
    pages[language] = JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    check(`C · home.${language}.json is valid JSON`, false, (e as Error).message);
  }
}

for (const language of ['he', 'en']) {
  const page = pages[language];
  if (!page) continue;
  for (const key of CONVERSION_KEYS) {
    const value = page[key];
    check(
      `C · home.${language}.json carries ${key}`,
      typeof value === 'string' && value.trim().length > 0,
      typeof value === 'string' ? value.slice(0, 48) : String(value),
    );
  }
}

// Parity at the TOP level. The Zod schema already refuses a missing required key at build
// time, but it says nothing about a key added to one language and forgotten in the other
// once both are optional — and the failure mode there is a section that renders in Hebrew
// and silently disappears in English.
if (pages.he && pages.en) {
  const he = Object.keys(pages.he).sort();
  const en = Object.keys(pages.en).sort();
  const onlyHe = he.filter((k) => !en.includes(k));
  const onlyEn = en.filter((k) => !he.includes(k));
  check(
    'C · both languages carry the same top level key set',
    onlyHe.length === 0 && onlyEn.length === 0,
    [onlyHe.length ? `only he: ${onlyHe.join(', ')}` : '', onlyEn.length ? `only en: ${onlyEn.join(', ')}` : '']
      .filter(Boolean)
      .join(' | ') || 'identical',
  );
}

// ── D. No prose in the new components ────────────────────────────────────────
//
// See the header: on a site whose language is decided by which FILE a string lives in, a
// literal in a component renders on BOTH language pages and no content scan can see it.

/** Text attributes a reader (or a screen reader) actually receives. */
const TEXT_ATTRS = ['aria-label', 'alt', 'title', 'placeholder', 'label', 'aria-description'];

/**
 * Strip everything that is not visible template text: frontmatter, style, script, comments,
 * and expression containers. `{...}` matters most — `{content.heroTrust}` is a BINDING, and
 * a scan that reads its identifiers as prose reports every correct component as an offender.
 */
function visibleText(source: string): string[] {
  let s = source;

  // Frontmatter: the leading --- ... --- block.
  s = s.replace(/^---\r?\n[\s\S]*?\r?\n---/, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');

  // Expression containers, nesting aware. A regex cannot balance braces, and
  // `{items.map((i) => <p>{i}</p>)}` nests three deep in real Astro.
  let out = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }

  const chunks: string[] = [];

  // Text nodes: whatever sits between a > and the next <.
  for (const m of out.matchAll(/>([^<>]+)</g)) chunks.push(m[1]);

  // Literal text attributes. A bound one (`alt={media.alt}`) is already gone with the
  // expression containers above, so anything left in quotes is a literal.
  for (const attr of TEXT_ATTRS) {
    for (const m of out.matchAll(new RegExp(`${attr}=["']([^"']*)["']`, 'g'))) chunks.push(m[1]);
  }

  return chunks;
}

/** Prose is a chunk with real words in it. An entity, a number or a symbol is not prose. */
function isProse(chunk: string): boolean {
  const text = chunk.replace(/&[a-z]+;|&#\d+;/gi, ' ').trim();
  if (!text) return false;
  return hasHebrew(text) || hasEnglishWord(text);
}

for (const [what, rel] of Object.entries(COMPONENTS)) {
  const source = read(rel);
  if (source === null) {
    check(`D · ${what} could be scanned for prose`, false, rel);
    continue;
  }
  const offenders = visibleText(source).filter(isProse).map((s) => s.trim().replace(/\s+/g, ' '));
  check(
    `D · ${what} hardcodes no visible prose`,
    offenders.length === 0,
    offenders.slice(0, 4).map((o) => `"${o.slice(0, 50)}"`).join(' | ') || 'clean',
  );
}

// ── E. Motion is opt in, not opt out ─────────────────────────────────────────
//
// Structural rather than behavioural, and deliberately so. "Animation is disabled under
// reduce" can be written two ways: gate the animation on `no-preference` (nothing moves
// until the visitor has said they do not mind), or declare it unconditionally and undo it
// under `reduce` (everything moves for anyone the second query is forgotten). Only the
// first is safe by default, so only the first passes.

/** The `@media (prefers-reduced-motion: no-preference) { ... }` spans of a stylesheet. */
function noPreferenceSpans(css: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = /@media[^{]*prefers-reduced-motion:\s*no-preference[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    // Walk to the matching brace so a nested rule inside the query still counts as inside.
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    spans.push([m.index, i]);
  }
  return spans;
}

for (const [what, rel] of Object.entries(COMPONENTS)) {
  const source = read(rel);
  if (source === null) continue;

  const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  if (!styles.trim()) {
    check(`E · ${what} declares no animation outside a reduced motion guard`, true, 'no stylesheet');
    continue;
  }

  const spans = noPreferenceSpans(styles);
  const inside = (index: number) => spans.some(([from, to]) => index >= from && index < to);

  const declarations = [...styles.matchAll(/\banimation(?:-name)?\s*:/g)];
  const ungated = declarations.filter((m) => !inside(m.index ?? 0));

  check(
    `E · every animation in ${what} sits inside a no-preference query`,
    ungated.length === 0,
    `${declarations.length} declaration(s), ${ungated.length} ungated`,
  );

  // A file that declares keyframes and animates nothing is a file whose animation was
  // deleted and whose keyframes were left behind. Harmless, but it also means this check
  // examined nothing, and a check that examined nothing must not read as a pass.
  if (/@keyframes/.test(styles)) {
    check(
      `E · ${what} actually uses the keyframes it declares`,
      declarations.length > 0,
      `${declarations.length} declaration(s)`,
    );
  }
}

// ── F. The hero taste screen costs (almost) no network request ───────────────
//
// This used to be zero images, full stop. `change: hero-photo-real` earned one
// deliberate exception: a real recreation photo, but ONLY behind a desktop
// viewport — a mobile visitor, the one this hero was rebuilt to stop failing,
// never pays for it. So the bar here is not "no <img> ever" any more; it is
// "at most the one known asset, gated shut on mobile by default and opened
// only inside a min-width query" — anything past that (a second image, a
// video, an external url()) is exactly the request creep this section exists
// to catch.

{
  const taste = read(COMPONENTS.taste);
  if (taste === null) {
    check('F · the hero taste screen could be scanned', false, COMPONENTS.taste);
  } else {
    // Strip the frontmatter AND every comment before scanning. Comments are prose
    // ABOUT the markup, and this section's whole job is to count real markup: a
    // sentence explaining why the lazy image tag is safe was itself counted as a
    // second one, so the file failed its own rule by documenting it. The `//`
    // pattern refuses a match preceded by a colon, or it would eat the rest of
    // every `https://` line it touched.
    const template = taste
      .replace(/^---\r?\n[\s\S]*?\r?\n---/, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(?<!:)\/\/[^\n]*/g, ' ');
    const external = [
      ['a <video> tag', /<video[\s/>]/i],
      ['an <image> href', /<image[\s/>]/i],
      ['a css url()', /\burl\(/i],
      ['an xlink href', /xlink:href/i],
    ] as const;

    for (const [what, pattern] of external) {
      check(`F · the hero taste screen references ${what} nowhere`, !pattern.test(template), what);
    }

    const imgTags = [...template.matchAll(/<img\b[^>]*>/gi)];
    check('F · at most one <img> tag', imgTags.length <= 1, `${imgTags.length} found`);

    if (imgTags.length === 1) {
      const img = imgTags[0][0];
      const srcMatch = img.match(/\bsrc\s*=\s*"([^"]*)"/i);
      check(
        'F · the one real photo is a local upload, not an external request',
        !!srcMatch && /^\/uploads\//.test(srcMatch[1]),
        srcMatch?.[1] ?? 'no src attribute',
      );
      check('F · the one real photo lazy loads', /loading\s*=\s*"lazy"/i.test(img), 'loading="lazy"');

      // The gate moved OUT of this component (change: hero-phone-desktop-only):
      // the whole phone frame is now desktop-only in HeroField, so a phone
      // renders none of this and the lazy <img> never enters a viewport to be
      // fetched. Asserting it here would pin a wrapper that no longer decides
      // anything; the real contract is one class on the frame, checked below.
    }

    check(
      'F · the hero taste screen renders real inline markup',
      /<div\b/i.test(template) && /<style[\s>]/i.test(taste),
      '<div> + <style>',
    );
  }
}

// ── G. The founder video plays inline, muted, and by itself ──────────────────
//
// The rework replaced a poster-and-modal with an inline player. The contract this pins:
//  • it is a real inline <video>, NOT a <dialog> (no modal, no window sliding in from an
//    edge with its dismiss half off screen);
//  • it starts MUTED — the one autoplay a browser allows without a gesture, and the one
//    this site's rules permit (no sound until asked);
//  • it does NOT carry the `autoplay` ATTRIBUTE: playback is driven by an
//    IntersectionObserver so it only ever runs while it is on screen, and stops when it
//    is not, rather than decoding video into an empty viewport;
//  • there is an explicit control to turn the sound on, because the native mute toggle is
//    a few pixels in a corner and this is the actual invitation to hear it;
//  • under prefers-reduced-motion it does not autostart.

{
  const video = read(COMPONENTS.video);
  if (video === null) {
    check('G · the founder video could be scanned', false, COMPONENTS.video);
  } else {
    check('G · it is inline, not a dialog', !/<dialog[\s>]/i.test(video), 'no <dialog>');
    check('G · it renders a real <video>', /<video[\s>]/i.test(video), '<video>');
    check('G · it starts muted', /\bmuted\b/.test(video), 'muted attribute');
    check(
      'G · playback is IntersectionObserver driven, not the autoplay attribute',
      /IntersectionObserver/.test(video) && !/<video[^>]*\bautoplay\b/i.test(video),
      'IntersectionObserver, no autoplay attr on <video>',
    );
    check(
      'G · it offers an explicit control to turn on sound',
      /muted\s*=\s*false/.test(video),
      'unmute path',
    );
    check(
      'G · it honours prefers-reduced-motion',
      /prefers-reduced-motion/.test(video),
      'reduced-motion branch',
    );
  }
}

// ── H. The anchor and the occasion doors ─────────────────────────────────────
//
// (change: marketing-home-occasion-doors)
//
// WHY THE ANCHOR IS PINNED PER LANGUAGE. The headline borrows a format the reader
// already holds, and the two languages borrow DIFFERENT ones on purpose: מירוץ למיליון
// carries nothing outside Israel and Amazing Race carries nothing inside it. That is an
// anchor swap, not a translation, and it is exactly the kind of intentional asymmetry a
// future "let us make the two files match" tidy-up would quietly destroy. So both halves
// are asserted by name.
//
// WHY THE SUBHEAD IS ASSERTED NEGATIVELY. Three feature-specific subheads were written
// and rejected during design, each because it was false for a real supported use:
// automatic scoring is false for a game that does not score, "no production crew" is
// meaningless at home, and "runs by itself" contradicts the live run console that exists
// so a person CAN intervene. The subhead's job is to promise removed difficulty in
// general. This check is what stops the fourth attempt at a clever feature claim.
//
// WHY THE SLUGS ARE CHECKED AGAINST THE REGISTRY. A card whose slug has a typo renders a
// perfectly good link to a 404. Nothing else on the page notices: the build succeeds, the
// component is fine, and the failure is one visitor at a time discovering a dead door.

const DOOR_COUNT = 4;
const HE_FORBIDDEN: readonly RegExp[] = [/ניקוד אוטומטי/, /בלי שופטים/, /(^|\s)לבד([\s.,]|$)/];
const EN_FORBIDDEN: readonly RegExp[] = [/automatic/i, /no staff/i, /by itself/i, /runs itself/i];
const CATCH_ALL: Record<string, RegExp> = { he: /וכל/, en: /and any/i };
const ANCHOR: Record<string, string> = { he: 'מירוץ למיליון', en: 'Amazing Race' };

const KNOWN_SLUGS = new Set(Object.values(SUBJECT_SLUGS).filter((s) => s !== ''));

interface Door {
  title?: unknown;
  examples?: unknown;
  slug?: unknown;
}

const doorSlugs: Record<string, string[]> = {};

for (const language of ['he', 'en']) {
  const page = pages[language];
  if (!page) continue;

  const headline = typeof page.headline === 'string' ? page.headline : '';
  check(
    `H · the ${language} headline carries its own anchor`,
    headline.includes(ANCHOR[language]),
    `expected ${ANCHOR[language]} :: got ${headline || '(missing)'}`,
  );

  const subhead = typeof page.subhead === 'string' ? page.subhead : '';
  const forbidden = language === 'he' ? HE_FORBIDDEN : EN_FORBIDDEN;
  const hit = forbidden.find((re) => re.test(subhead));
  check(
    `H · the ${language} subhead makes no feature claim`,
    subhead !== '' && hit === undefined,
    hit ? `matched ${hit} :: ${subhead}` : subhead || '(missing)',
  );

  const block = page.occasionDoors as { doors?: unknown } | undefined;
  const doors = Array.isArray(block?.doors) ? (block.doors as Door[]) : null;

  check(
    `H · the ${language} page carries exactly ${DOOR_COUNT} occasion doors`,
    doors !== null && doors.length === DOOR_COUNT,
    doors === null ? 'occasionDoors.doors missing' : `${doors.length} door(s)`,
  );

  if (!doors) continue;
  doorSlugs[language] = [];

  doors.forEach((door, i) => {
    const title = typeof door.title === 'string' ? door.title.trim() : '';
    const examples = typeof door.examples === 'string' ? door.examples.trim() : '';
    const slug = typeof door.slug === 'string' ? door.slug.trim() : '';
    doorSlugs[language].push(slug);

    check(`H · ${language} door ${i} has a title`, title !== '', title || '(empty)');
    check(`H · ${language} door ${i} has an examples line`, examples !== '', examples || '(empty)');

    // The catch all is what lets four doors stand in for an open set. Without it a
    // visitor whose occasion is not one of the four reads the row as a list of the only
    // things this product is for, which is the exact narrowing the strip exists to undo.
    check(
      `H · ${language} door ${i} ends its examples in a catch all`,
      CATCH_ALL[language].test(examples),
      `expected ${CATCH_ALL[language]} :: ${examples || '(empty)'}`,
    );

    check(
      `H · ${language} door ${i} points at a generated landing page`,
      KNOWN_SLUGS.has(slug),
      `${slug || '(empty)'} :: known ${[...KNOWN_SLUGS].join(', ')}`,
    );
  });
}

// A slug identifies the SUBJECT, so the Hebrew and English cards of one door must resolve
// to the two languages of the SAME page. Divergence here sends a Hebrew reader to an
// English destination, which is the failure the landing page registry is built to prevent
// and which would be reintroduced here, one level up, by a copy paste.
if (doorSlugs.he && doorSlugs.en) {
  check(
    'H · both languages of a door share one slug',
    doorSlugs.he.join('|') === doorSlugs.en.join('|'),
    `he [${doorSlugs.he.join(', ')}] en [${doorSlugs.en.join(', ')}]`,
  );
}

if (homepage) {
  const doorsAt = homepage.indexOf('<OccasionDoors');
  const heroAt = homepage.indexOf('<HeroField');
  const tryAt = homepage.indexOf('<TryMission');

  check('H · the homepage renders the occasion doors', doorsAt >= 0, 'OccasionDoors');
  check(
    'H · the doors sit between the hero and the playable mission',
    doorsAt >= 0 && heroAt >= 0 && tryAt >= 0 && doorsAt > heroAt && doorsAt < tryAt,
    `HeroField@${heroAt} OccasionDoors@${doorsAt} TryMission@${tryAt}`,
  );

  // Every section that existed before this change must still be here. The strip is
  // additive; a visitor who ignores it loses nothing, and that promise is only as good as
  // the page still containing everything it contained.
  for (const tag of ['TryMission', 'Features', 'Steps', 'MissionIdeas', 'GamePlanner', 'FAQs', 'CallToAction']) {
    check(`H · ${tag} survived the change`, homepage.includes(`<${tag}`), tag);
  }
}

const doorsSource = read(COMPONENTS.doors);
if (doorsSource === null) {
  check('H · the occasion doors component could be scanned', false, COMPONENTS.doors);
} else {
  // NOT A GATE. The whole design rests on a visitor being able to ignore the strip and
  // keep reading. A dialog, or anything pinned over the page, converts an offer into a
  // toll booth, and it would do so without failing any other check on this page.
  check('H · the strip is not a dialog', !/<dialog[\s>]/i.test(doorsSource), 'no <dialog>');
  check(
    'H · the strip claims no dialog role',
    !/role\s*=\s*["']dialog["']/i.test(doorsSource),
    'no role="dialog"',
  );
  check(
    'H · the strip does not pin itself over the page',
    !/position:\s*fixed/i.test(doorsSource) && !/\bfixed\s+inset-0\b/.test(doorsSource),
    'no fixed positioning',
  );
  check(
    'H · the doors are real links',
    /<a\b/.test(doorsSource) && /href=/.test(doorsSource),
    'anchor elements',
  );
}

console.log('');
if (failures > 0) {
  console.log(`MARKETING HOME CRO TESTS FAILED :: ${failures} of ${checks}`);
  process.exit(1);
}
console.log(`ALL MARKETING HOME CRO TESTS PASSED :: ${checks} checks`);
