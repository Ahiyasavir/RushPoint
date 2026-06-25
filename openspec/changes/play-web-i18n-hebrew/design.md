## Context

creator-web localizes via a single `apps/creator-web/src/i18n.ts` module: a `Lang = 'he' | 'en'`
type, two literal objects `HE` and `EN` (with `EN: typeof HE` so TypeScript enforces the same shape),
and `translations: Record<Lang, typeof HE>`. Components read the active map and `t.dir`.

play-web has nothing equivalent — strings are inline JSX literals across ~10 screens/components. We
port the creator-web pattern, default to Hebrew, and add a runtime hook so screens can read `t`
without prop-drilling.

## Goals / Non-Goals

**Goals:**
- A play-web `i18n.ts` with `HE`/`EN` maps of identical shape, Hebrew default, `dir` per language.
- A `useT()` hook returning the active map; language persisted via `store.ts`.
- Replace 100% of chrome literals in play-web screens/components with `t.*`.
- A pure-logic parity test that fails if any HE key is missing (English-fallback cause) or any HE
  leaf value contains non-whitelisted Latin text.

**Non-Goals:**
- Translating user content; browser locale detection; RTL visual redesign; creator-web rewrite.

## Decisions

### D1 — Mirror creator-web's `EN: typeof HE` shape lock
`HE` is the source of truth; `EN: typeof HE` forces compile-time key parity. `translations:
Record<Lang, typeof HE>`. This makes a missing key a **typecheck failure**, and the runtime parity
test is a second belt-and-suspenders guard (catches `as` casts / dynamic keys).

### D2 — `useT()` hook + stored preference
Add `lang` to the persisted session/preferences in `store.ts` (`loadLang()`/`saveLang()`), default
`'he'`. `useT()` reads it via a small React context provider mounted in `App.tsx`, returning
`{ t, lang, setLang, dir }`. Setting `dir` on the app root mirrors creator-web.

### D3 — Namespacing
Group keys by screen to keep the map readable and the swap mechanical: `join`, `play`, `final`,
`promo`, `staff`, `board`, `liveOps`, `connection`, `common`. Function-valued entries (e.g.
`tooFar: (m: number) => …`) are allowed exactly as creator-web does.

### D4 — Whitelist for the no-Latin-in-HE assertion
Brand/units that legitimately stay Latin in Hebrew copy: `RushPoint`, `Pro`, `QR`, `SOS`, `Google`,
`₪`, and emoji. The parity test strips these before scanning for `[A-Za-z]`.

## Test strategy

**Pure logic** — `scripts/test-i18n-parity.ts` (aggregator-picked, no emulator):
1. Import `translations` from BOTH `apps/creator-web/src/i18n.ts` and `apps/play-web/src/i18n.ts`.
2. `keysDeep(HE)` deep-equals `keysDeep(EN)` for each app (recurses objects, ignores function vs
   string leaf type) — proves no key missing in either language.
3. For each app's `HE` map, every string leaf, after removing the whitelist + emoji, contains **no**
   `[A-Za-z]{2,}` run — proves no English leakage in Hebrew mode.
4. (Guard) the whitelist itself is a small explicit array so additions are reviewed.

**UI verification** (preview tools): load play-web with `lang='he'`, snapshot Join + Final +
StaffConsole, confirm zero English chrome; toggle to `en`, confirm English renders and `dir` flips.

## Risks / Trade-offs

- [Risk: a screen literal missed in the swap] → the no-Latin-in-HE test scans the maps, not the JSX,
  so a *missed* literal stays English on screen but won't fail the test. Mitigation: the swap task
  lists every screen/component file explicitly, and UI verification snapshots the main screens.
- [Risk: importing app source into a tsx test pulls in React/Vite-only modules] → `i18n.ts` is pure
  (no React imports in the maps themselves); keep the `useT()` hook in a separate file
  (`i18nContext.tsx`) so the test imports only `translations` from `i18n.ts`.
- [Trade-off: Hebrew default changes current English behavior for existing testers] → intended; an
  English toggle remains via `setLang('en')`.
