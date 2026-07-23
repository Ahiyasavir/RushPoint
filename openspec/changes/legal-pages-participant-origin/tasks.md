## 1. RED — failing tests first

- [x] 1.1 Create `scripts/test-legal-routes.ts` in house style (`ok(cond, msg)`, `passed`/`failed`,
      `process.exit(failed ? 1 : 0)`), importing `resolveLegalPath` / `resolvePlayRoute` from
      `../apps/play-web/src/lib/playRoute`, and `parseLegalMarkdown` / `LEGAL_DOCS` from
      `../packages/shared/src/legalMarkdown` and `../packages/shared/src/legalContent` (relative
      paths — the tsx lane resolves `@rushpoint/shared` to `dist`).
- [x] 1.2 Encode the `resolveLegalPath` cases from the design's Test Strategy: `/terms`, `/privacy`,
      trailing slash, mixed case, query string and fragment attached, `/`, empty/undefined, and the
      near-miss paths (`/termsofservice`, `/terms/extra`, `/creator/terms`, `/board`).
- [x] 1.3 Encode the `resolvePlayRoute` legal cases: `pathname: '/terms'` → `kind: 'legal'`, correct
      `doc`, `clearSession === false`, and precedence over a stored session, a stored staff session
      and a `?code=` search.
- [x] 1.4 Encode the non-regression sweep: for `/`, an unknown path and an omitted `pathname`, the
      resolved route deep-equals the route for the same search + session across staff / tv / recap /
      board / ceremony / challenge / code-join / play / promo / plain-join.
- [x] 1.5 Encode the `parseLegalMarkdown` block cases and the escape-then-bold ordering at block
      level, plus the `LEGAL_DOCS` integrity assertions (both docs × both languages non-empty;
      Hebrew bodies contain Hebrew, English bodies do not; no `|` table row).
- [x] 1.6 Extend `scripts/test-playtest-links.ts` with the `resolveProxyTarget` pins: `/terms`,
      `/privacy`, `/terms/`, `/privacy?lang=en` → play-web; `/creator/terms`, `/creator/privacy`,
      `/creator/` → creator-web.
- [x] 1.7 Run `npx tsx scripts/test-legal-routes.ts` and confirm it FAILS for the right reason (the
      new exports do not exist). Record the verbatim failure.

## 2. GREEN — shared content and tokenizer

- [x] 2.1 Add `packages/shared/src/legalMarkdown.ts`: `escapeHtml` and `renderInline` moved verbatim
      from `apps/creator-web/src/pages/legalMarkdown.ts`, plus `LegalBlock` and
      `parseLegalMarkdown(text): LegalBlock[]` matching creator-web's current line rules exactly.
- [x] 2.2 Add `packages/shared/src/legalContent.ts`: `LegalDocType`, `LegalDoc`, `LEGAL_DOCS` — the
      `SECTIONS` constant from `LegalPage.tsx` moved with the body text unchanged, character for
      character. Do NOT export either module from `packages/shared/src/index.ts`.
- [x] 2.3 Add the `"@rushpoint/shared/*"` path entry to `apps/play-web/tsconfig.json` and
      `apps/creator-web/tsconfig.json` so `tsc` resolves the deep specifier the way Vite already does.
- [x] 2.4 Replace `apps/creator-web/src/pages/legalMarkdown.ts` with a re-export of the shared helper
      module via a relative path, so `scripts/test-legal-page-polish.ts` keeps passing untouched.
- [x] 2.5 Rewrite `LegalPage.tsx` to import `LEGAL_DOCS` and `parseLegalMarkdown`, mapping blocks to
      the SAME elements and class strings it emits today. Delete the inlined `SECTIONS`. The
      component's props, lazy boundary and creator-web routes stay exactly as they are.

## 3. GREEN — participant app

- [x] 3.1 Add `resolveLegalPath` and the `legal` route to `apps/play-web/src/lib/playRoute.ts`:
      optional `pathname` on `PlayRouteInput`, legal checked FIRST, `clearSession: false`.
- [x] 3.2 Add `apps/play-web/src/screens/LegalScreen.tsx` — the only importer of
      `@rushpoint/shared/legalContent` — rendering blocks with play-web's own classes, RTL/LTR by
      document language, with a language toggle and a back control.
- [x] 3.3 Add the `legal` namespace to BOTH dictionaries in `apps/play-web/src/i18n.ts` (additive
      only; re-read the file immediately before editing — it is shared with other lanes).
- [x] 3.4 Wire it in `apps/play-web/src/App.tsx`: `lazyWithRetry('legal', …)`, pass
      `window.location.pathname` at both `resolvePlayRoute` call sites, render the legal branch inside
      the existing `Suspense` before every other branch.
- [x] 3.5 Document the legal paths in `resolveProxyTarget` (`packages/shared/src/playtest.ts`) —
      comment plus explicit intent — without altering the routing of any existing path.
- [x] 3.6 Run `npx tsx scripts/test-legal-routes.ts` and `npx tsx scripts/test-playtest-links.ts`; both
      GREEN.

## 4. Verify

- [x] 4.1 `npm run bundle:budget` BEFORE the play-web change is built and AFTER, recording the entry
      chunk raw/gzip both times. The budget numbers must not be raised.
- [x] 4.2 Confirm by reading the built output that the document text is in a lazy chunk and the entry
      chunk does not contain it.
- [x] 4.3 Gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run play:build`,
      `npm run creator:build`, `npm run bundle:budget`, `npm run i18n:check:strict`.
- [x] 4.4 `npx openspec validate legal-pages-participant-origin --strict`.
- [x] 4.5 Record what is NOT verified: no browser run, no emulator lane, live playtest stack not
      restarted, and the production deploy requirement for `apps/play-web/dist`.
