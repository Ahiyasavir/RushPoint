## Why

RushPoint has two origins and both are application shells. `rush-point.com` answers with a
join code box, `creator.rush-point.com` with a sign in screen. The `seo-landing-pages`
change put twelve indexable occasion pages on the apex, which gives search engines
something to rank, but it deliberately produced *leaf* pages: a visitor who wants to know
who builds this, read anything written recently, or send a message has nowhere to go.

There is also an authoring problem underneath the content problem. Every word on both
origins today is either a React component or a generated file, so publishing a post means
a developer, a commit and a deploy. That is a rate limiter on the one activity that
compounds organic search: publishing regularly. The person who has things to say about
running field games is the owner, not a build pipeline.

## What Changes

- A new **marketing site** is introduced as a third deployable surface: a static site
  built by Astro, served from its own Firebase Hosting target, with root relative URLs so
  it can later take over the primary address by changing DNS rather than by rebuilding.
- The site publishes four kinds of page, each in Hebrew and English: a **home/welcome**
  page, a **story** page, a **contact** page, and a **blog** (an index plus a page per
  post). Posts carry images and video.
- Posts and pages become **content files in the repository**, not components. They are
  authored as Markdown with typed frontmatter and validated at build time, so a malformed
  post fails the build instead of rendering broken.
- A browser based authoring UI (**Decap CMS**) is served from the site at an admin route
  and commits directly to the GitHub remote. The site is fully functional without it: the
  CMS is a second way to write the same files, never the source of truth.
- A new **`submitContactMessage` callable** accepts the contact form. It is
  unauthenticated by necessity (the sender is a stranger), so it is rate limited, size
  bounded, and validated server side, and it is added to the declared public callable
  allowlist with its reason.
- Language pairing, hreflang symmetry, canonical self reference and the no dash copy rule
  are extended to cover this surface, reusing the derivations and the shared leak
  predicate that already govern the landing pages rather than restating them.

Not breaking: both existing hosting targets, their rewrites, and the twelve landing pages
are untouched.

## Non-goals

- **The landing pages are not migrated into Astro.** They ship, they are gate tested, and
  moving working output between generators buys nothing today. The registry stays where it
  is; a later change can adopt it once the Astro surface has proven itself.
- **The site does not become the primary address in this change.** No DNS is moved, no
  apex is reassigned, no redirect is added. This change only makes that move *possible*
  without rework.
- **No third party form, analytics, comment, or newsletter service is added.** The contact
  path terminates at the existing backend.
- **No CMS hosted service and no Netlify account.** Decap runs from our own static files
  against our own GitHub repository.
- **The OAuth application that Decap logs in through is not created here.** It requires
  credentials only the account owner can issue; the change ships the site, the admin route
  and the configuration, and records the credential step as operator work.
- **No server rendering and no runtime framework on the page.** Output is static HTML, in
  keeping with the reason the landing pages are static.
- **Nothing is copied from a project without checking its licence.** Only permissively
  licensed (MIT/Apache) code is reused, with licence text and attribution retained.

## Capabilities

### New Capabilities

- `marketing-site`: a static, bilingual, publishable marketing surface, separate from
  both applications, that is content driven rather than component driven and is portable
  to a different address without rework.
- `contact-message`: an unauthenticated, abuse bounded path for a stranger to send a
  message to the product owner, and for that message to be durably readable afterwards.

### Modified Capabilities

- `ui-text-standards`: the no dash rule currently names translation map values, visible
  JSX text, page metadata, and static landing page copy. Marketing site content is a
  fourth surface of user facing copy with the same reach, and it lives in Markdown, which
  none of the existing scans reach.
- `seo-landing-pages`: the requirement that the landing pages are linked rather than
  orphaned currently points only at the creator console's unauthenticated surface. The
  marketing site becomes a second, better linking surface, and the two sets of pages must
  reference each other rather than form two disconnected islands.

## Impact

**New surface.** `apps/marketing/` joins the npm workspaces. It is a build only workspace:
no Firebase SDK, no shared client runtime, no authentication.

**New dependency.** Astro (MIT) and its official integrations. This is the first static
site generator in the repository. It is confined to the new workspace, so neither app's
bundle budget nor build graph is affected. Decap CMS is loaded by the admin page only.

**Backend.** One new callable in `functions/`, re-exported from `functions/src/index.ts`,
with a typed wrapper. It is unauthenticated, so it must be added to `PUBLIC_CALLABLES` in
`scripts/lib/callableHardening.mjs` with a justification, and it must have an e2e scenario
before it can be green: the callable coverage guard fails a callable that no test invokes.
Messages are stored in a server write only collection, so `firestore.rules` gains a deny
rule for it.

**Hosting.** `firebase.json` gains a third hosting target. Unlike the two applications it
carries no catch all rewrite, because a static site has real files at real paths and a
rewrite would mask a missing page as a soft 200.

**Gates.** The new workspace declares `typecheck`, `lint` and `build` scripts so turbo
actually runs them; a React or content workspace with no lint script is silently not
linted while the gauntlet still reports success. New pure suites join the auto discovered
`scripts/test-*.ts` lane. `npm run verify` gains the marketing build.

**Not touched.** creator-web, play-web, `packages/shared` runtime code, scoring, routing,
run state, and the emulator lanes.
