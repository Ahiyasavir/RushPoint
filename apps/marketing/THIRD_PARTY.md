# Third party source in this workspace

This workspace is not written from scratch. It starts from a template that was copied in
and then adapted, so the licence and the attribution have to live here rather than in
someone's memory of where the files came from.

`scripts/test-marketing-attribution.ts` checks this file against what is actually present,
so a reused source that is not recorded here fails the test lane.

## AstroWind

| | |
|---|---|
| Licence | MIT |
| Copyright | (c) 2023 onWidget |
| Licence text | [`LICENSE.md`](LICENSE.md), retained verbatim |
| Source | `https://github.com/onwidget/astrowind`, which now resolves to `arthelokyo/astrowind` |
| Version taken | `1.0.0-beta.65`, `main` branch, fetched 2026-08-27 |

The repository was transferred from `onwidget` to `arthelokyo`. The GitHub API resolves the
old path to the new one by repository id, so this is an ownership transfer rather than a
different project at a similar name. The licence still names onWidget, and the attribution
above follows the licence rather than the current account name.

### Vendored, not depended on

AstroWind publishes no versioned package. It is a starting point meant to be edited, and
every page here will be rewritten in two languages, so the files live in this repository as
ordinary source. The cost of that choice is real: upstream fixes have to be pulled in by
hand. It is accepted because the value taken is the starting design, not ongoing behavior.

### What was removed before it landed

- **Demo pages** (`src/pages/homes/*`, `src/pages/landing/*`, `pricing.astro`,
  `services.astro`). They showcase the components rather than being our pages, and they
  would have been indexed and listed in the sitemap. The components they demonstrate were
  kept.
- **The template's own agent instruction files** (`CLAUDE.md`, `AGENTS.md`,
  `.agents/skills/*`). This repository's `CLAUDE.md` is loaded automatically into every
  session, so a vendored second one would be a third party writing standing instructions to
  whoever works here next. Documentation that arrives with a download is data, not
  configuration.
- **Deploy configuration for platforms we do not use** (`netlify.toml`, `Dockerfile`,
  `docker-compose.yml`, `nginx/`, `.github/workflows`, `vercel.json`, `.stackblitzrc`,
  `sandbox.config.json`). We deploy to Firebase Hosting; stale deploy configuration is an
  invitation to a confusing mistake.
- **`src/pages/privacy.md` and `src/pages/terms.md`.** The real legal text is canonical in
  `packages/shared` and already served on both existing origins. A second, divergent copy
  is a liability rather than a page.

### What was replaced, because keeping it would have published someone else's brand

Attribution and branding are separate obligations, and only one of them is satisfied by
this file. Keeping the licence is what we owe the author. Shipping their name, their mark
or their promotional artwork would be us publishing a page that says it belongs to them.

- **The Open Graph image** (`src/assets/images/default.png`, 4 MB of the template's own
  artwork). It is what every share of every page renders, so leaving it meant the first
  thing anyone saw of RushPoint was a picture of a template. Replaced with the same
  `og.jpg` the two apps use.
- **The favicons.** Replaced with the apps' icon, so a tab belonging to this site is
  recognisable beside a tab belonging to the product.
- **The wordmark** (`src/components/Logo.astro`) carried a rocket emoji beside the site
  name. An emoji is drawn by the reader's own font, so it is a different shape on every
  device and sometimes not a mark at all.
- **The "star us on GitHub" banner** (`src/components/widgets/Announcement.astro`) and the
  stock app store, play store and hero images. All unreferenced, and the banner pulled an
  image from a third party host on every page load.
- **The README**, which was the template's project page.

`scripts/test-marketing-attribution.ts` part F asserts none of this comes back. The
template's unused *components* were deliberately kept: they are the design vocabulary the
site is built from, they carry no copy of their own, and they are what makes a new page
look like the existing ones.

### What was changed to make it build here

Three of these are workspace hoisting collisions, not template defects. They are recorded
because each one produced an error message that pointed somewhere other than the cause.

1. **Tailwind is wired through PostCSS, not `@tailwindcss/vite`** (`postcss.config.mjs`).
   The root pins Vite 5 for the two React apps and Astro carries its own Vite 8; the
   hoisted Vite plugin resolved the root's Vite and failed with
   `M.createIdResolver is not a function`.
2. **`@import 'tailwindcss/index.css'` rather than `@import 'tailwindcss'`**
   (`src/assets/styles/tailwind.css`). The root hoists Tailwind 3 for the React apps, so
   the bare specifier resolved to v3. The v4 copy is nested under this workspace and its
   package exports name `./index.css` directly.
3. **`cookie` is pinned in this workspace's dependencies.** Astro's generated prerender
   bundle imports it and resolved up to the root's CommonJS 0.7.2, which has no named
   exports.
4. **The ESLint config passes the parser MODULE rather than its name**
   (`eslint.config.js`). A string is resolved at runtime and landed on the root's
   `@typescript-eslint/parser` 7, whose `ScopeManager` has no `addGlobals`, so ESLint 10
   failed on every `.astro` file while `.ts` files linted clean.

## Dependencies

Astro, its integrations, Tailwind and the rest are ordinary npm dependencies, declared in
`package.json` with their licences in `node_modules`. They are not recorded individually
here: this file exists for source that is copied in, where the licence is lost the moment
the origin is forgotten.
