## 1. Vendor the template and make it build in this repository

- [x] 1.1 Copy AstroWind into `apps/marketing/`, stripping the demo pages (`homes/*`, `landing/*`, `pricing`, `services`), the template's own agent instruction files (`CLAUDE.md`, `AGENTS.md`, `.agents/`), the deployment configuration for platforms we do not use (`netlify.toml`, `Dockerfile`, `docker-compose.yml`, `nginx/`, `.github/`), and `privacy.md`/`terms.md`. Keep `LICENSE.md`.
- [x] 1.2 Add `apps/marketing` to the npm workspaces, rename the package to `@rushpoint/marketing`, and declare `build`, `typecheck`, `lint`, `dev` and `preview` scripts so turbo actually runs its gates. Install and confirm `npm run build --workspace=apps/marketing` succeeds on the untouched template.
- [x] 1.3 Confirm turbo really runs the new gates: run `npm run lint` and `npm run typecheck` and find `@rushpoint/marketing:lint` and `@rushpoint/marketing:typecheck` in the output. A gate that never ran is indistinguishable in a summary from one that passed.
- [x] 1.4 Write `apps/marketing/THIRD_PARTY.md` recording AstroWind, its MIT licence and its copyright holder, and what was changed. Verify `LICENSE.md` is present.

## 2. The site origin is declared once (RED first)

- [x] 2.1 Write `scripts/test-marketing-output.ts` asserting that every absolute self URL in the built output begins with the declared origin, and that no other origin of ours appears. Run it and confirm it fails against the template's placeholder origin, for that reason.
- [x] 2.2 Introduce the single origin declaration and route the template's site config, canonical, Open Graph and sitemap generation through it. Confirm 2.1 passes.
- [x] 2.3 Prove the check bites: temporarily hardcode one page's canonical to a different host, confirm the test fails and names it, then revert.

## 3. Bilingual routing and derived alternates (RED first)

- [x] 3.1 Extend `scripts/test-marketing-output.ts` with page pairing, `lang`/`dir` agreement, hreflang symmetry, self reference and exactly one `x-default`. Run it and confirm it fails because no `/he/` or `/en/` page exists yet.
- [x] 3.2 Restructure routing so every page lives under `/he/…` or `/en/…`, and derive the alternate set by prefix swap. Confirm 3.1 passes.
- [x] 3.3 Prove symmetry is derived rather than authored: mutate the derivation so one page names the wrong counterpart while the entry count stays correct, confirm the symmetry check fails naming both directions, then revert.
- [x] 3.4 Add the `/` redirect to `/he/` as a declared single path redirect, and assert no catch all rewrite exists for this target.

## 4. Content shape and draft handling (RED first)

- [x] 4.1 Write `scripts/test-marketing-content.ts` asserting required frontmatter fields, rejection of a wrongly typed field, slug stability independent of title, newest first ordering, draft exclusion, language correctness via the shared `scripts/lib/i18nLeak.ts` predicate, and that the scan reached a non zero number of files. Run it and confirm it fails.
- [x] 4.2 Define the content collection schema (title, description, language, slug, publication date, draft, optional cover image and video) and wire the published set filter that the index, sitemap and feed all read. Confirm 4.1 passes.
- [x] 4.3 Prove a malformed post fails the build: temporarily remove a required field from a post, confirm the build fails naming the file, then revert.
- [x] 4.4 Prove the vacuous pass is closed: temporarily point the content scan at an empty directory and confirm it fails on the reach assertion rather than reporting green.

## 5. Author the pages and posts

- [x] 5.1 Write the home page in Hebrew and English: what RushPoint is, who it is for, and a way in.
- [x] 5.2 Write the story page in both languages.
- [x] 5.3 Write the contact page in both languages, with the form.
- [x] 5.4 Write the blog index and at least two real posts per language, authored in Hebrew rather than translated.
- [x] 5.5 Replace the template's branding, navigation, footer, colors and images with RushPoint's, and remove every remaining piece of template placeholder copy.

## 6. Crawler surfaces (RED first)

- [x] 6.1 Extend `scripts/test-marketing-output.ts` with sitemap set equality against the published set, `robots.txt` allowing every published path and advertising the sitemap, the feed listing published posts and no draft, and `/admin/` being disallowed, `noindex`, and absent from the sitemap. Run it and confirm it fails.
- [x] 6.2 Configure the sitemap, `robots.txt` and feed to generate from the published set. Confirm 6.1 passes.
- [x] 6.3 Assert no framework runtime or hydration bundle is referenced by the home, story, blog index or post pages.

## 7. Cross linking with the landing pages (RED first)

- [x] 7.1 Extend `scripts/test-landing-pages.ts` to assert every landing page links to a marketing site page of the same language, and that the marketing site links back to at least one landing page. Run it and confirm it fails.
- [x] 7.2 Add the link to the landing page registry and the link back on the marketing site. Regenerate the landing pages with `npm run seo:build` and confirm 7.1 passes and the drift check stays green.

## 8. The no dash rule reaches Markdown (RED first)

- [x] 8.1 Plant a dash separator in a marketing content file, run `scripts/test-no-dashes.ts`, and confirm it passes today, proving the gap.
- [x] 8.2 Add PART E scanning marketing content frontmatter and body, exempting list markers, thematic breaks, setext underlines and code, with a reach assertion. Confirm it catches the planted dash and names the field, then remove the plant.

## 9. The contact callable (RED first, coverage guard is the starting state)

- [x] 9.1 Add the contact scenario to `scripts/e2e-verify.mjs`: accept a valid message, reject missing field, wrong type and oversize with invalid argument, treat null and absent identically for the optional field, refuse past the rate limit with resource exhausted, and refuse `listContactMessages` for a non admin. Run `npm run e2e` and confirm it fails because the callables do not exist.
- [x] 9.2 Add the deny rule for `contactMessages` in `firestore.rules` and its rules suite assertions, and confirm client read and write are both denied.
- [x] 9.3 Implement `submitContactMessage`: validate and bound every field, rate limit server side, stamp arrival time on the server, and store. Re-export it from `functions/src/index.ts`.
- [x] 9.4 Implement `listContactMessages`, admin only and audit logged.
- [x] 9.5 Add both to the declared lists in `scripts/lib/callableHardening.mjs`: `submitContactMessage` to `PUBLIC_CALLABLES` with its reason, `listContactMessages` to the audit list. Run `scripts/test-callable-hardening.ts`.
- [x] 9.6 Route the contact notification through the existing `deliver` seam in `functions/src/runs/runSummaryEmail.ts`, best effort and a logged no-op without a provider key.
- [x] 9.7 Add the typed wrapper and wire the site's contact form to it, posting to the declared API origin. Confirm 9.1 passes and the callable coverage guard is green.
  - DEVIATION: the typed wrapper (`services/calls.ts`) exists for the ADMIN side only. The site's own form posts through a page local `fetch`, not a wrapper module, because the page ships zero JavaScript files: its script is inline `define:vars`, which cannot import. A wrapper here would mean a bundled script on every contact page, which contradicts the no framework runtime requirement that section 6.3 asserts. The API origin is still declared once, in `src/utils/i18n.ts`.

## 10. Owner readable messages

- [x] 10.1 Add a minimal admin view listing contact messages, following the existing `/admin/users` pattern, rendering message content as text and never as markup.

## 11. Deployment wiring

- [x] 11.1 Add the third hosting target to `firebase.json` pointing at `apps/marketing/dist`, with the single `/` redirect and no catch all rewrite. Extend `scripts/lib/buildArtifactGuard.mjs` and its test so the new target's asset base and serve path are covered by `npm run base:check`.
- [x] 11.2 Add the marketing build to `npm run verify`'s builds phase, and a `preview` entry so the built site can be served locally.

## 12. CMS configuration

- [x] 12.1 Write `scripts/test-marketing-cms-config.ts` comparing the Decap field set against the content schema in both directions. Run it and confirm it fails against the template's stock configuration.
- [x] 12.2 Re-point the Decap collections at our content shape, our two languages and our repository, restricted to the content directory. Confirm 12.1 passes.
- [x] 12.3 Prove the site does not depend on the CMS: build with the admin assets removed and confirm every published page is still emitted.
- [x] 12.4 Write the operator checklist for the GitHub OAuth application and the token exchange endpoint on the VPS, including the exact steps and what stays broken until they are done.

## 13. Gates

- [x] 13.1 Run `npm run verify` and confirm every gate is green, including the new marketing build and `i18n:check:strict` with zero new PART B findings.
- [x] 13.2 Run `npm run e2e` and confirm it is green, including the new contact scenario and the callable coverage guard.
- [x] 13.3 Run the Firestore rules suite and confirm the `contactMessages` denials pass.
- [x] 13.4 Serve the built site and verify with the preview tools: a Hebrew page renders RTL with full content, its English counterpart renders LTR, the language switch works, a blog post renders with its image and video, the contact form submits and reports its outcome, and no page logs a console error.
  - VERIFIED: Hebrew renders `dir="rtl"` with full content, English `dir="ltr"`, both light and dark; the language switch reaches the true counterpart on every standing page and on a paired post (14.7); a post renders its cover image with a responsive srcset and its video in a 16:9 frame; the form posts the correct callable envelope to the declared API origin, reports success and each of the four failure outcomes in the page's own language, keeps what the sender wrote on every failure, and clears the fields only on success; no console errors on any page; zero JavaScript files shipped.
  - HOW THE MEDIA AND THE FORM WERE VERIFIED WITHOUT SIDE EFFECTS: no shipped post carries media yet, because there is no real photography for these posts and a stock cover would be exactly the template filler that section 5.5 removed. The rendering path was proved by planting an image and a video on one post, confirming the output, and reverting. The form was exercised against a stubbed `fetch` rather than the live API: a real submission would have reached production, and the production origin allow list has not been updated yet (DEPLOY.md section 12C), so it would have proved nothing except that the operator step is outstanding.

## 14. The site wears the product's colours (added mid implementation)

- [x] 14.1 Replace the template's palette with the product's: rp-fire primary, rp-plasma accent, the ink scale, play-web's warm page surface, and a brand tinted selection colour. The template shipped a blue primary, a purple accent and `lavender`.
- [x] 14.2 Load the product's display face (Space Grotesk, the apps' `font-brand` / `--rp-font-display`) and point `--aw-font-heading` at it. A heading face named but never loaded falls back silently.
- [x] 14.3 Redefine the `slate`, `gray` and `blue` SCALES rather than only the semantic tokens. The template writes those directly in dozens of class strings, mostly under `dark:`, so token only changes left dark mode on the template's cool navy while light mode was warm.
- [x] 14.4 Define `text-heading`, which the template's Headline component was already writing with nothing defining it, and give `text-page` a fallback. Both were silently inheriting.
- [x] 14.5 Replace the remaining unpaired physical direction classes (`ml-2`, `mr-4`) with logical ones. Hebrew is the default language here, so an unpaired `ml-` is a mainline bug.
- [x] 14.6 Write `scripts/test-marketing-theme.ts`, reading the brand OUT of the apps' own configuration rather than restating it, so a one sided change to the brand fails. Prove it bites by pointing the primary back at the template's blue.
- [x] 14.7 Fix the language switch, which pointed at the other language's HOME from every page. It now links to the page's own counterpart, taken from the very same alternate set the page publishes as hreflang, so a reader and a crawler cannot be told different things. An unpaired post falls back to the other home, which is the honest answer. Asserted in `check-marketing-output.ts` part F2.
- [x] 14.8 Add `BlogPosting` structured data to posts, and resolve the cover image to an absolute built URL rather than publishing the raw `~/assets/...` authoring path, which would have named a file that exists nowhere. Asserted in part G2, parsed rather than pattern matched.
