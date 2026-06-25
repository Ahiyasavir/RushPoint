# Proposal — Complete Hebrew localization for play-web (full he/en i18n layer)

## Why

`apps/play-web` (the participant + staff app) has **no translation layer at all** — every
user-facing string is hardcoded English (`"Enter the access code…"`, `"🏁 Join the race"`,
`"I'm staff →"`, `"Adventure not found"`). The product is Hebrew-first (creator-web already defaults
to Hebrew via `apps/creator-web/src/i18n.ts`), so participants who receive a join code currently land
in a fully English app. When the app language is Hebrew, **100% of the chrome must render in Hebrew**
with zero English leakage or untranslated fallback strings.

## What Changes

> Observable behavior. The participant app renders entirely in Hebrew by default, with an English
> toggle. User-authored content (game title/description) is never translated — only app chrome.

- A new play-web i18n layer (`HE`/`EN` maps + a `useT()` hook) mirroring creator-web, **Hebrew by
  default**, `dir="rtl"` for Hebrew.
- Every hardcoded chrome string in `screens/*` and `components/*` is replaced with a `t.*` lookup.
- Language resolves from a stored preference (reuse `store.ts`); falls back to Hebrew.
- The two translation maps have **identical key sets** so no key is ever missing in Hebrew mode
  (the cause of English fallback), enforced by a pure-logic test.

## Capabilities

### New Capabilities
- `play-web-i18n`: a he/en translation layer for the participant + staff app, Hebrew-default, with a
  key-parity + no-English-leakage guarantee enforced in the test lane.

### Modified Capabilities
<!-- None — this is additive chrome localization; no callable or data-model change. -->

## Surfaces touched

- **play-web:** new `src/i18n.ts` (HE/EN maps, `useT()`, `dir`); `src/store.ts` (persist a `lang`
  preference); all `src/screens/*` (Join, Play, Final, GamePromo, StaffConsole, PublicLeaderboard)
  and `src/components/*` (TaskRunner, LiveOps, ConnectionBanner, NavMap) swap literals for `t.*`.
- **Tests:** `scripts/test-i18n-parity.ts` (pure: key parity + no-Latin-in-HE for BOTH apps).
- **No callable change**, no shared-type change, no Firestore change.

## Non-goals

- No translation of user-authored content (game title/description keep `dir="auto"`).
- No locale auto-detection from the browser/run config (deferred; stored preference + Hebrew default).
- No creator-web string changes beyond fixing any leak the parity test surfaces.
- No RTL layout redesign beyond setting `dir` and preferring logical (`ms-`/`text-start`) classes.
