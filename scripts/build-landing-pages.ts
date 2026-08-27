// Writes the static SEO landing pages and the participant origin's sitemap.
//
// This is the ONLY piece of the landing page feature that touches the filesystem. All the
// decisions live in scripts/lib/landingPages.ts, which is pure and unit tested; this file
// renders that module's registry and puts the result on disk.
//
// The output is COMMITTED, not built. Generating during the build would mean the gate
// build and the playtest build both write these files, and a build step that writes a
// directory another build also writes is exactly the shape that produced the
// dist/dist-playtest incident (a base-`/` gate build silently replacing the live
// playtest's base-`/creator/` bundle, with every process healthy and every request 200).
// A committed file is reviewable in a diff, identical under every build, and needs no
// build wiring at all.
//
// The price of committing generated output is drift, and scripts/test-landing-pages.ts
// closes it: the bytes on disk must equal what the generator produces now, so editing the
// registry and forgetting to re-run this fails `npm test` naming the stale file.
//
//   npm run seo:build
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  LANDING_PAGES,
  LANDING_PUBLIC_DIR,
  landingPageFile,
  renderLandingPage,
  sitemapXml,
} from './lib/landingPages';

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, LANDING_PUBLIC_DIR);

function write(relative: string, contents: string): void {
  const full = join(OUT, relative);
  mkdirSync(dirname(full), { recursive: true });
  // Written with explicit utf8 and LF-normalised content from the renderer, because the
  // drift test compares bytes: a platform that rewrote line endings on write would make
  // the gate fail on Windows and pass elsewhere, which is worse than either.
  writeFileSync(full, contents, 'utf8');
  console.log(`  wrote ${LANDING_PUBLIC_DIR}/${relative.replace(/\\/g, '/')}`);
}

console.log(`Generating ${LANDING_PAGES.length} landing pages into ${LANDING_PUBLIC_DIR}/`);
for (const page of LANDING_PAGES) {
  write(landingPageFile(page), renderLandingPage(page));
}
write('sitemap.xml', sitemapXml());
console.log('Done. Commit the generated files.');
