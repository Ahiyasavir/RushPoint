## 1. Vendor the template and make it build in this repository

- [x] 1.1 Copy AstroWind into `apps/marketing/`, stripping the demo pages (`homes/*`, `landing/*`, `pricing`, `services`), the template's own agent instruction files (`CLAUDE.md`, `AGENTS.md`, `.agents/`), the deployment configuration for platforms we do not use (`netlify.toml`, `Dockerfile`, `docker-compose.yml`, `nginx/`, `.github/`), and `privacy.md`/`terms.md`. Keep `LICENSE.md`.
- [x] 1.2 Add `apps/marketing` to the npm workspaces, rename the package to `@rushpoint/marketing`, and declare `build`, `typecheck`, `lint`, `dev` and `preview` scripts so turbo actually runs its gates. Install and confirm `npm run build --workspace=apps/marketing` succeeds on the untouched template.
- [x] 1.3 Confirm turbo really runs the new gates: run `npm run lint` and `npm run typecheck` and find `@rushpoint/marketing:lint` and `@rushpoint/marketing:typecheck` in the output. A gate that never ran is indistinguishable in a summary from one that passed.
- [x] 1.4 Write `apps/marketing/THIRD_PARTY.md` recording AstroWind, its MIT licence and its copyright holder, and what was changed. Verify `LICENSE.md` is present.

## 2. The site origin is declared once (RED first)

- [ ] 2.1 Write `scripts/test-marketing-output.ts` asserting that every absolute self URL in the built output begins with the declared origin, and that no other origin of ours appears. Run it and confirm it fails against the template's placeholder origin, for that reason.
- [ ] 2.2 Introduce the single origin declaration and route the template's site config, canonical, Open Graph and sitemap generation through it. Confirm 2.1 passes.
- [ ] 2.3 Prove the check bites: temporarily hardcode one page's canonical to a different host, confirm the test fails and names it, then revert.

## 3. Bilingual routing and derived alternates (RED first)

- [ ] 3.1 Extend `scripts/test-marketing-output.ts` with page pairing, `lang`/`dir` agreement, hreflang symmetry, self reference and exactly one `x-default`. Run it and confirm it fails because no `/he/` or `/en/` page exists yet.
- [ ] 3.2 Restructure routing so every page lives under `/he/…` or `/en/…`, and derive the alternate set by prefix swap. Confirm 3.1 passes.
- [ ] 3.3 Prove symmetry is derived rather than authored: mutate the derivation so one page names the wrong counterpart while the entry count stays correct, confirm the symmetry check fails naming both directions, then revert.
- [ ] 3.4 Add the `/` redirect to `/he/` as a declared single path redirect, and assert no catch all rewrite exists for this target.

## 4. Content shape and draft handling (RED first)

- [ ] 4.1 Write `scripts/test-marketing-content.ts` asserting required frontmatter fields, rejection of a wrongly typed field, slug stability independent of title, newest first ordering, draft exclusion, language correctness via the shared `scripts/lib/i18nLeak.ts` predicate, and that the scan reached a non zero number of files. Run it and confirm it fails.
- [ ] 4.2 Define the content collection schema (title, description, language, slug, publication date, draft, optional cover image and video) and wire the published set filter that the index, sitemap and feed all read. Confirm 4.1 passes.
- [ ] 4.3 Prove a malformed post fails the build: temporarily remove a required field from a post, confirm the build fails naming the file, then revert.
- [ ] 4.4 Prove the vacuous pass is closed: temporarily point the content scan at an empty directory and confirm it fails on the reach assertion rather than reporting green.

## 5. Author the pages and posts

- [ ] 5.1 Write the home page in Hebrew and English: what RushPoint is, who it is for, and a way in.
- [ ] 5.2 Write the story page in both languages.
- [ ] 5.3 Write the contact page in both languages, with the form.
- [ ] 5.4 Write the blog index and at least two real posts per language, authored in Hebrew rather than translated.
- [ ] 5.5 Replace the template's branding, navigation, footer, colors and images with RushPoint's, and remove every remaining piece of template placeholder copy.

## 6. Crawler surfaces (RED first)

- [ ] 6.1 Extend `scripts/test-marketing-output.ts` with sitemap set equality against the published set, `robots.txt` allowing every published path and advertising the sitemap, the feed listing published posts and no draft, and `/admin/` being disallowed, `noindex`, and absent from the sitemap. Run it and confirm it fails.
- [ ] 6.2 Configure the sitemap, `robots.txt` and feed to generate from the published set. Confirm 6.1 passes.
- [ ] 6.3 Assert no framework runtime or hydration bundle is referenced by the home, story, blog index or post pages.

## 7. Cross linking with the landing pages (RED first)

- [ ] 7.1 Extend `scripts/test-landing-pages.ts` to assert every landing page links to a marketing site page of the same language, and that the marketing site links back to at least one landing page. Run it and confirm it fails.
- [ ] 7.2 Add the link to the landing page registry and the link back on the marketing site. Regenerate the landing pages with `npm run seo:build` and confirm 7.1 passes and the drift check stays green.

## 8. The no dash rule reaches Markdown (RED first)

- [ ] 8.1 Plant a dash separator in a marketing content file, run `scripts/test-no-dashes.ts`, and confirm it passes today, proving the gap.
- [ ] 8.2 Add PART E scanning marketing content frontmatter and body, exempting list markers, thematic breaks, setext underlines and code, with a reach assertion. Confirm it catches the planted dash and names the field, then remove the plant.

## 9. The contact callable (RED first, coverage guard is the starting state)

- [ ] 9.1 Add the contact scenario to `scripts/e2e-verify.mjs`: accept a valid message, reject missing field, wrong type and oversize with invalid argument, treat null and absent identically for the optional field, refuse past the rate limit with resource exhausted, and refuse `listContactMessages` for a non admin. Run `npm run e2e` and confirm it fails because the callables do not exist.
- [ ] 9.2 Add the deny rule for `contactMessages` in `firestore.rules` and its rules suite assertions, and confirm client read and write are both denied.
- [ ] 9.3 Implement `submitContactMessage`: validate and bound every field, rate limit server side, stamp arrival time on the server, and store. Re-export it from `functions/src/index.ts`.
- [ ] 9.4 Implement `listContactMessages`, admin only and audit logged.
- [ ] 9.5 Add both to the declared lists in `scripts/lib/callableHardening.mjs`: `submitContactMessage` to `PUBLIC_CALLABLES` with its reason, `listContactMessages` to the audit list. Run `scripts/test-callable-hardening.ts`.
- [ ] 9.6 Route the contact notification through the existing `deliver` seam in `functions/src/runs/runSummaryEmail.ts`, best effort and a logged no-op without a provider key.
- [ ] 9.7 Add the typed wrapper and wire the site's contact form to it, posting to the declared API origin. Confirm 9.1 passes and the callable coverage guard is green.

## 10. Owner readable messages

- [ ] 10.1 Add a minimal admin view listing contact messages, following the existing `/admin/users` pattern, rendering message content as text and never as markup.

## 11. Deployment wiring

- [ ] 11.1 Add the third hosting target to `firebase.json` pointing at `apps/marketing/dist`, with the single `/` redirect and no catch all rewrite. Extend `scripts/lib/buildArtifactGuard.mjs` and its test so the new target's asset base and serve path are covered by `npm run base:check`.
- [ ] 11.2 Add the marketing build to `npm run verify`'s builds phase, and a `preview` entry so the built site can be served locally.

## 12. CMS configuration

- [ ] 12.1 Write `scripts/test-marketing-cms-config.ts` comparing the Decap field set against the content schema in both directions. Run it and confirm it fails against the template's stock configuration.
- [ ] 12.2 Re-point the Decap collections at our content shape, our two languages and our repository, restricted to the content directory. Confirm 12.1 passes.
- [ ] 12.3 Prove the site does not depend on the CMS: build with the admin assets removed and confirm every published page is still emitted.
- [ ] 12.4 Write the operator checklist for the GitHub OAuth application and the token exchange endpoint on the VPS, including the exact steps and what stays broken until they are done.

## 13. Gates

- [ ] 13.1 Run `npm run verify` and confirm every gate is green, including the new marketing build and `i18n:check:strict` with zero new PART B findings.
- [ ] 13.2 Run `npm run e2e` and confirm it is green, including the new contact scenario and the callable coverage guard.
- [ ] 13.3 Run the Firestore rules suite and confirm the `contactMessages` denials pass.
- [ ] 13.4 Serve the built site and verify with the preview tools: a Hebrew page renders RTL with full content, its English counterpart renders LTR, the language switch works, a blog post renders with its image and video, the contact form submits and reports its outcome, and no page logs a console error.
