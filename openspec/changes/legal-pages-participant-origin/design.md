## Context

Verified state before this change:

- `apps/creator-web/src/pages/LegalPage.tsx` (1127 lines) holds BOTH the document bodies (a
  `SECTIONS` constant: `privacy`/`terms` × `he`/`en`, each `{ title, updated, body }` markdown) and a
  React `renderMarkdown()` for the six constructs the bodies use (`## h2`, `### h3`, `> quote`, a
  whole-line `**bold**` paragraph, `- list item`, plain paragraph, blank spacer).
- `apps/creator-web/src/pages/legalMarkdown.ts` holds the two pure helpers `escapeHtml` /
  `renderInline` (escape-then-bold, so policy text can never inject markup), already covered by
  `scripts/test-legal-page-polish.ts`.
- creator-web mounts it with react-router: `App.tsx:161-162`, `<Route path="/privacy">` and
  `<Route path="/terms">`, component lazy-loaded (`App.tsx:22`).
- play-web has no router and no legal screen. `apps/play-web/src/lib/playRoute.ts` resolves ten
  query-param routes from `window.location.search`; `App.tsx` renders each branch, all lazy screens
  behind `lazyWithRetry`.
- `scripts/check-bundle-budget.mjs` enforces the play-web entry chunk: 255,000 gzip / 975,000 raw,
  262,000 initial gzip, plus forbidden markers. It is part of `npm run verify`.
- Apps resolve `@rushpoint/shared` to `packages/shared/src` via a Vite alias and a tsconfig path;
  `scripts/` and `functions/` resolve it to the BUILT `packages/shared/dist`.

## Goals / Non-Goals

**Goals**
- `/terms` and `/privacy` on the participant origin render the actual documents, in production and
  behind the playtest tunnel.
- Exactly one copy of the policy text in the repo.
- Zero added bytes to the play-web entry chunk.
- No regression to any existing play-web route, and none to `https://rushpoint-creator.web.app/privacy`.

**Non-Goals**
- Editing the policy text. Not one sentence.
- Adding routes beyond the two.
- Adding a router to play-web.
- Unifying the two apps' visual rendering of the documents (different design systems; see D4).

## Decisions

### D1 — Render the documents IN play-web; do not redirect to `/creator/terms`

Considered:

1. **Redirect** `/terms` → `/creator/terms` (or to the creator hosting origin).
2. **Server-side rewrite** in `firebase.json` pointing the play site's legal paths at creator-web.
3. **Render in play-web** (chosen).

Rejected (1): a redirect throws the participant out of the app they are mid-run in. play-web is an
installed-capable PWA with a service worker and a persisted session; navigating to a different
application (different origin in production, different Vite base under the tunnel) unloads the
shell, loads a second React app, and offers no way back to the run. It is also the wrong app: the
creator console is a dark, sign-in-gated, creator-oriented surface. A participant asked to accept
terms should read them where they are.

Rejected (2): Firebase Hosting cannot rewrite one site's path to another site's build output — the
two targets have separate `public` directories. It would have to be an external redirect, i.e. (1)
with extra deploy coupling. It would also make the tunnel and production diverge, since the tunnel
has no Hosting layer at all.

Chosen (3): the participant origin owns the participant-facing legal documents. It works identically
in production, under the tunnel, and on `localhost:5181`, with no hosting configuration change.

Cost accepted: play-web needs its own presentation of the documents (D4) and must not regress its
bundle budget (D5). Both are bounded and verified.

### D2 — `firebase.json` is NOT changed

Both hosting targets already carry `{"source": "**", "destination": "/index.html"}`. That rewrite is
precisely what an SPA that reads `location.pathname` needs: the server hands `/terms` the app shell
and the app decides. Adding a legal-specific rewrite would be a no-op at best.

Consequence to state loudly: because the fix is in the built `apps/play-web/dist`, **production needs
a hosting deploy** (`npm run deploy:hosting`). Nothing about `rushpoint-creator.web.app/privacy`
changes — its route, its component, its markup and its lazy boundary are untouched — but it too only
picks up the shared-content refactor when creator-web is next built and deployed, and the rendered
output is byte-identical either way (D4).

### D3 — Shared content lives in `packages/shared/src`, imported by DEEP path, never via the barrel

Two new files:

- `packages/shared/src/legalMarkdown.ts` — `escapeHtml`, `renderInline` (moved verbatim from
  creator-web) plus `parseLegalMarkdown(body): LegalBlock[]`, a pure line-to-block tokenizer.
- `packages/shared/src/legalContent.ts` — `LegalDocType`, `LegalDoc`, `LEGAL_DOCS` (the `SECTIONS`
  constant moved verbatim: same titles, same `updated` strings, same bodies, character for
  character).

Neither is re-exported from `packages/shared/src/index.ts`. The barrel is imported by play-web's
entry graph; a ~60 KB string constant sitting in it would depend entirely on rollup tree-shaking to
stay out of the entry chunk, and the budget is the thing this change must not break. A deep import
(`@rushpoint/shared/legalContent`) makes the boundary explicit and unconditional. Both apps' Vite
aliases already match prefixed specifiers; both apps' tsconfigs gain a `"@rushpoint/shared/*"` path
entry so `tsc` resolves them the same way.

`apps/creator-web/src/pages/legalMarkdown.ts` becomes a re-export of the shared helper module using
a *relative* path, so `scripts/test-legal-page-polish.ts` (run by `tsx`, which resolves
`@rushpoint/shared` to `dist`, not `src`) keeps working unchanged and the existing coverage keeps
guarding the escape-then-bold ordering.

`functions/` is unaffected: it imports the barrel, which does not reference either new module.

### D4 — One tokenizer, two renderers

The document bodies are shared; the *presentation* cannot be, because the two apps have disjoint
design tokens (creator-web: `--ink-1` / `--surface-0` / `--rp-border`; play-web: the reversed zinc
scale, `app-bg`, `accent` — verified absent in `apps/play-web/src/index.css`). Sharing the component
would mean shipping creator-web's dark-console CSS variables into the participant app.

So the *parsing* moves to `parseLegalMarkdown()` in shared — one authority for what a `##` line
means and for the escape-then-bold ordering — and each app maps the resulting blocks to its own
markup. creator-web's `renderMarkdown()` becomes that map, emitting **the same elements with the same
class strings as today**, so its rendered output is unchanged.

Block kinds: `h2`, `h3`, `quote`, `strong` (a whole-line bold paragraph), `li`, `blank`, `p`. Blocks
that carry inline markup expose pre-escaped `html`; `h2`/`h3`/`strong` expose plain `text` (they are
rendered as React children today and must stay that way — no `dangerouslySetInnerHTML` where there
was none).

### D5 — Lazy-loaded, budget-verified

`LegalScreen` is registered exactly like every other play-web route:
`lazyWithRetry('legal', () => import('./screens/LegalScreen'))`. The screen is the only importer of
`@rushpoint/shared/legalContent`, so the prose lands in the `legal` chunk. `npm run bundle:budget` is
run before and after and both numbers are reported; the budget is a ratchet and this change must not
move it.

### D6 — Path handling: an optional `pathname` on the existing pure resolver

No router. `PlayRouteInput` gains `pathname?: string`, and a new exported pure helper
`resolveLegalPath(pathname): LegalDocType | null` normalizes: strip the query/hash if a caller passes
a full URL-ish string, strip a trailing slash, lowercase, compare against exactly `/terms` and
`/privacy`. Anything else returns `null`.

Precedence: **legal is checked first**, ahead of staff. A legal path is an explicit, unambiguous
navigation and must win over a stored staff session or a leftover query param; the alternative
(placing it last) would let a persisted session hide the Privacy Policy from the person trying to
read it. `clearSession` is `false` on the legal route — reading the terms must never cost a player
their run.

`App.tsx` passes `window.location.pathname` at both call sites (the boot-time stale-session check and
the render-time resolve) and renders `LegalScreen` inside the existing `Suspense`, with the standard
`routeFallback` spinner. The legal branch returns before `resumeOrJoin`, so it does not perturb the
"resume vs join" logic at the bottom of the component.

`base` note: play-web is served at origin root in dev, under the tunnel and in production (only
creator-web has a `/creator/` base), so a bare `/terms` comparison is correct for every environment
this app runs in.

### D7 — The proxy: pin, do not re-route

`resolveProxyTarget('/terms')` and `resolveProxyTarget('/privacy')` **already** return the play-web
port — they match none of the emulator substrings and none of the `/creator` prefixes, so they fall
into the default branch. The tunnel bug was never the proxy; it was play-web having nothing to render.

What is missing is *protection*: the emulator rules are substring matches (`p.includes('/storage')`,
`p.includes('/functions')`), so a future rule could silently capture a public legal path, and nothing
would catch it. The change therefore adds explicit regression assertions to
`scripts/test-playtest-links.ts` pinning `/terms`, `/privacy`, their trailing-slash and
query-string forms to play-web, and pinning `/creator/terms`, `/creator/privacy` and `/creator/` to
creator-web. The function is documented with a comment saying why those paths matter. This is an
honest "already correct, now guarded" rather than a manufactured fix.

`scripts/proxy.mjs` imports `@rushpoint/shared` from `dist`, so anything here only takes effect after
the package is rebuilt and the proxy restarts. The live playtest stack is not restarted.

### D8 — i18n

The document titles and `updated` lines are already bilingual data. The only new UI chrome is a back
control, which goes through `t.*` in both dictionaries (`legal.back`, `legal.title`). The screen
opens in the app's active language and offers the same HE/EN document toggle creator-web has; the
toggle's own labels are the language *names* (`עברית` / `English`), which are deliberately not
switchable and are marked `// i18n-ignore` with that reason, exactly as the checker's contract
allows. `npm run i18n:check:strict` must add zero PART B findings.

## Risks / Trade-offs

- **Regressing the participant route table.** Highest-consequence risk: `resolvePlayRoute` runs on
  every participant load at a live event. Mitigation: the new branch triggers only on two exact
  paths; the test suite asserts that unknown paths, `/`, and an absent `pathname` produce results
  identical to today.
- **Bundle budget.** Mitigated by the deep import (no barrel), a dedicated lazy chunk, and a
  before/after `bundle:budget` measurement.
- **Divergent rendering between the apps.** Accepted and bounded: the *text* cannot diverge (one
  source), only the styling can, and each app styles it in its own design system by intent.
- **Not browser-verified.** A live playtest stack is serving from this tree and must not be
  restarted, and browser tools are out of scope for this change. Verification is: pure unit tests on
  the path resolver, the tokenizer and the proxy; a production build of both apps; the bundle
  budget; and a static read of the built play-web asset to confirm the prose is in a lazy chunk and
  not in the entry. The visual rendering of the new screen on a real phone is explicitly unverified.

## Test Strategy

**Lane: pure logic (`scripts/test-*.ts`, picked up by `scripts/run-unit-tests.mjs` via `npm test`).**
Chosen over creator-web vitest because (a) creator-web has no vitest project wired for `apps/`
(the vitest lane is `functions/`), (b) every existing test for `playRoute.ts`, `playtest.ts` and
`legalMarkdown.ts` already lives in that aggregator, and (c) all three units under test are pure and
DOM-free, so the tsx lane runs them with no emulator and no bundler.

`scripts/test-legal-routes.ts` (new):

- `resolveLegalPath`: `/terms` → `terms`; `/privacy` → `privacy`; `/terms/` and `/privacy/`
  (trailing slash) → same; `/TERMS`, `/Privacy` (mixed case) → same; `/terms?x=1` and
  `/privacy?lang=en#s3` (query/hash attached to the value) → same; `/` → `null`; `''`/`undefined` →
  `null`; `/termsofservice`, `/terms/extra`, `/creator/terms`, `/board` → `null`.
- `resolvePlayRoute` with `pathname`: `/terms` → `{ kind: 'legal', doc: 'terms' }` with
  `clearSession === false`, **with** a stored session, **with** a stored staff session, and with a
  `?code=` in the search — the document always wins and the session is never cleared.
- Non-regression: for `/`, `/anything-else`, and an omitted `pathname`, the resolved route deep-equals
  the route resolved today for the same search + session, across a representative sweep of the
  existing routes (staff, tv, recap, board, ceremony, challenge, code/join, play, promo, plain join).
- `parseLegalMarkdown`: one block per source line; `## X` → `h2` with `text: 'X'`; `### X` → `h3`;
  `> X` → `quote` with escaped-then-bolded `html`; a whole-line `**X**` → `strong` with `text: 'X'`;
  a line with an inner `**` pair is NOT `strong`; `- X` → `li` with `html`; `''` → `blank`; anything
  else → `p` with `html`. Escaping precedence: `<b> & "x"` in any inline block is escaped before
  `**bold**` becomes `<strong>` (the guard `scripts/test-legal-page-polish.ts` already owns for
  `renderInline`, re-asserted at the block level).
- Content integrity: `LEGAL_DOCS` has both doc types in both languages, each with a non-empty
  `title`, `updated` and `body`; the Hebrew bodies contain Hebrew characters and the English bodies
  do not; and no body contains a `|`-table row (the regression `legal-page-polish` P2 pinned).

`scripts/test-playtest-links.ts` (extended): the proxy assertions from D7.

`scripts/test-legal-page-polish.ts` (unchanged): still imports from
`apps/creator-web/src/pages/legalMarkdown`, which now re-exports the shared helpers — proving the
move preserved behavior.

**Gates:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run play:build`,
`npm run creator:build`, `npm run bundle:budget`, `npm run i18n:check:strict`. No emulator lane is
touched by this change (no callables, no rules), and the live stack is not restarted.
