# @rushpoint/marketing

The public marketing site: the home page, the story, contact, and the blog, in
Hebrew and English. Static output, no framework runtime, its own Firebase Hosting
target.

It is not part of the product. Nothing here reads a user's data or renders
anything a signed in creator or participant sees. The one thing it talks to is
the contact callable on the API.

## Where things are

| Path | What |
|---|---|
| `src/utils/i18n.ts` | The SINGLE declaration of the origin, the two languages, and every URL derived from them. `scripts/lib/marketingSite.ts` re-exports it so the test lane and the pages cannot describe two different sites. |
| `src/pages/[lang]/` | Every page. There is no unprefixed route: `/` is a redirect, declared in `firebase.json`. |
| `src/copy/` | Page copy as data, Hebrew authored rather than translated. |
|  `src/data/post/` | Blog posts. What Decap writes. |
| `src/config.yaml` | Astro's own view of the same origin, plus default metadata. |
| `public/admin/` | The Decap CMS admin surface. Disallowed in `robots.txt`, `noindex`, and absent from the sitemap. |

## Running it

```bash
npm run marketing:build
```

`npm run verify` builds it, then `scripts/check-marketing-output.ts` reads the
BUILT output: canonicals, the hreflang cluster, the sitemap set, the feed,
`robots.txt`, that no page pulls in a framework runtime, and that nothing exceeds
a phone's width. Source can be right while output is wrong, so that check reads
`dist`, never `src`.

The pure lane (`npm test`) covers what does not need a build:
`test-marketing-content.ts` (frontmatter, draft handling, language correctness),
`test-marketing-hosting.ts` (the hosting contract, including the absence of a
catch all rewrite) and `test-marketing-attribution.ts` (the vendored template's
licence and the absence of its branding).

## Provenance

This workspace is vendored third party source, adapted. The template it came
from, its licence, its copyright holder and everything stripped or replaced are
recorded in [THIRD_PARTY.md](THIRD_PARTY.md), which is the single place that
names them so a rename upstream cannot leave a stale second copy here.
