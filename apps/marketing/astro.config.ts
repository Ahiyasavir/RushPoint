import path from 'path';
import { fileURLToPath } from 'url';

import { defineConfig, fontProviders } from 'astro/config';

import { unified } from '@astrojs/markdown-remark';

import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import partytown from '@astrojs/partytown';
import icon from 'astro-icon';
import compress from 'astro-compress';
import type { AstroIntegration } from 'astro';

import { WEB_FONTS } from '@rushpoint/brand';

import astrowind from './vendor/integration';

import { readingTimeRemarkPlugin, responsiveTablesRehypePlugin } from './src/utils/frontmatter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const hasExternalScripts = false;
const whenExternalScripts = (items: (() => AstroIntegration) | (() => AstroIntegration)[] = []) =>
  hasExternalScripts ? (Array.isArray(items) ? items.map((item) => item()) : [items()]) : [];

export default defineConfig({
  output: 'static',

  // Prefetch OFF. The template prefetched every link entering the viewport,
  // which downloads whole pages a reader never opens. On a twelve page static
  // site the saving is imperceptible, and the cost lands on exactly the reader
  // this site is written for: someone on a phone, on mobile data. It also left
  // 2.4 KB of script on pages that otherwise need none.
  prefetch: false,

  // Fonts come from the brand package, which is the single source (see
  // packages/brand/tokens.mjs). Nothing about the typeface is decided here.
  //
  // The `hebrew` subset is the whole point of this block. Both faces used to be
  // loaded latin-only, and the previous display face had no Hebrew glyphs at
  // all, so every Hebrew character on a Hebrew-first site was rendered by the
  // browser's default font. The site had a brand typeface in English and Arial
  // in Hebrew, which is the half most readers actually see.
  // Fetched from Fontsource at build time and then self hosted, so the browser
  // never touches a third party. The fetch is the one part that needs the
  // network: jsdelivr failed intermittently here (two of three attempts for one
  // file), and Astro caches per file afterwards, so a retried build succeeds.
  // The installed @fontsource-variable/* packages are kept as the record of
  // which versions the brand is pinned to.
  fonts: WEB_FONTS.map((font) => ({
    provider: fontProviders.fontsource(),
    name: font.family,
    cssVariable: font.cssVariable,
    weights: font.weights,
    styles: ['normal'],
    subsets: font.subsets,
    fallbacks: ['sans-serif'],
  })),

  integrations: [
    sitemap(),
    mdx(),
    icon({
      include: {
        tabler: ['*'],
        'flat-color-icons': [
          'template',
          'gallery',
          'approval',
          'document',
          'advertising',
          'currency-exchange',
          'voice-presentation',
          'business-contact',
          'database',
        ],
      },
    }),

    ...whenExternalScripts(() =>
      partytown({
        config: { forward: ['dataLayer.push'] },
      })
    ),

    compress({
      // csso off on purpose: its parser doesn't understand the media range
      // syntax Tailwind v4 emits for breakpoints (`@media (width>=48rem)`) and
      // silently drops every one of those blocks — the site then renders as if
      // all `md:`/`lg:` classes were missing. lightningcss parses it correctly.
      CSS: { csso: false, lightningcss: { minify: true } },
      HTML: {
        'html-minifier-terser': {
          removeAttributeQuotes: false,
        },
      },
      Image: false,
      JavaScript: true,
      SVG: false,
      Logger: 1,
    }),

    astrowind({
      config: './src/config.yaml',
    }),
  ],

  image: {
    // Astro's default Sharp service handles local images.
    //
    // Most remote CDN images (Unsplash, Cloudinary, Imgix…) are routed by
    // src/components/common/Image.astro through `unpic`, which rewrites the
    // URL with CDN-side query parameters and serves it straight from the
    // provider — Astro never downloads it, so they don't need to be listed.
    //
    // `domains` only matters for remote URLs that fall through to Astro's
    // native <Image /> (i.e. providers Unpic can't detect, like Pixabay).
    // Listed entries are authorized to be processed by Sharp.
    domains: ['cdn.pixabay.com'],

    // Emit responsive styles for the native <Image layout=…> used by
    // src/components/common/Image.astro (local images). Utility classes on
    // each usage still win, since these styles use low-specificity selectors.
    responsiveStyles: true,
  },

  markdown: {
    processor: unified({
      remarkPlugins: [readingTimeRemarkPlugin],
      rehypePlugins: [responsiveTablesRehypePlugin],
    }),
  },

  vite: {
    // Tailwind is applied via postcss.config.mjs, not a Vite plugin. See that file.
    resolve: {
      alias: {
        '~': path.resolve(__dirname, './src'),
      },
    },
  },
});
