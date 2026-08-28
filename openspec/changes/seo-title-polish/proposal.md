## Why

The page titles Google prints for this product read as file labels rather than as
invitations: `RushPoint: join a live real world field game` and
`RushPoint: build your own real world field game`. The colon is doing the work a
sentence should do, it costs characters at the front of the line where a search result
earns its click, and it repeats the brand in the position a reader scans first. Nine of the
twelve static landing pages carry the same construction.

`scripts/test-no-dashes.ts` already governs this exact surface (PART C scans `<title>`,
`description`, the Open Graph and Twitter fields, and the web manifest; PART D scans the
landing page registry), and the house pattern for joining a title to the brand is already
decided and written down in `apps/marketing/src/config.yaml`: a comma, never a dash. The
colon simply was never covered, so it survived in the copy with the widest reach we have.

## What Changes

- Every shipped page title is rewritten colon free and outcome first: the thing a reader
  gets leads, the brand follows after a comma, matching the marketing site's existing
  `%s, RushPoint` template.
  - `apps/play-web/index.html` and `apps/creator-web/index.html`: `<title>`, `og:title`
    and `twitter:title`.
  - `scripts/lib/landingPages.ts`: the nine landing page titles that carry a colon. The
    three that do not are already correct and are left alone.
  - The generated pages under `apps/play-web/public/{he,en}/` are regenerated from that
    registry by `npm run build:landing-pages`, as they always are.
- `scripts/test-no-dashes.ts` gains a colon rule, scoped to TITLES only:
  `<title>`, `og:title`, `twitter:title`, the manifest `name` / `short_name`, and the
  landing registry's `title` field. Descriptions, headings and body copy are untouched,
  because a colon inside a sentence is ordinary punctuation and only the title is the link.

## Non-goals

- No change to any `description`, heading, or body copy. The colon is a title problem.
- No change to the domain. `rush-point.com` contains a hyphen and that is the registered
  name; the dash standard has always exempted URLs and file paths for this reason.
- No change to `apps/marketing`. Its titles come from the content files through the
  `%s, RushPoint` template and are already colon free. The homepage redesign is a
  separate change (`marketing-home-cro-redesign`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ui-text-standards`: the standard currently governs dash separators in user-facing copy.
  It gains a companion rule for the colon, deliberately narrower in scope: titles only,
  because a title is a name and a colon inside one is a label, whereas a colon inside a
  sentence is punctuation.

## Impact

- **Surfaces touched:** `apps/play-web/index.html`, `apps/creator-web/index.html`,
  `scripts/lib/landingPages.ts` and its generated output under
  `apps/play-web/public/{he,en}/`, `scripts/test-no-dashes.ts`. No callable, no shared
  type, no rules change.
- **Tests / gates:** `scripts/test-no-dashes.ts` (extended), `scripts/test-landing-pages.ts`
  (the committed output must equal what the registry now produces, so a forgotten
  regeneration fails loudly), `scripts/test-i18n-parity.ts` and the marketing content
  suites unaffected. All reached by `npm run verify`.
- **SEO risk:** a title rewrite is a ranking input. These pages are days old and carry
  little accumulated authority, the keywords are preserved and moved EARLIER in the line,
  and the URLs do not change, so there is nothing to redirect.
