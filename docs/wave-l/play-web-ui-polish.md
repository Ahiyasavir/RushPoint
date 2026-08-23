# Wave L — play-web UI/UX polish (participant app)

Behavior-preserving visual/organization pass on the participant + staff phone app
(`apps/play-web`). Mobile-first, Hebrew-first/RTL, light "Warm Trail" theme. No
logic, flow, or wiring changes; nothing removed. Every user-facing string still
routes through `t.*` (no new keys were required for this pass).

## Context

`apps/play-web` is a very mature surface (dozens of prior polish waves). The screens
already have strong hero moments, empty/loading/error states, RTL correctness, and
colourblind cues. The highest-value *safe* improvement here was therefore
**consistency + accessibility of the repeated building blocks**, which ripples across
every surface, rather than re-skinning already-good screens.

## Changes

### 1. Shared primitive — `Collapsible` (`components/ui.tsx`) — NEW

The participant app had **three** hand-rolled collapsible-section headers with
subtly different padding, tap-target height, and chevron glyphs:

| Surface | Was |
|---|---|
| Live-ops leaderboard peek (`LiveOps.tsx`) | `px-3 py-2`, `▲`/`▼` glyph swap |
| Photo feed section (`PlayScreen.tsx` → `FeedSection`) | `px-3 py-2`, `▲`/`▼` |
| Team↔HQ chat section (`PlayScreen.tsx` → `ChatSection`) | `px-3 py-2`, `▲`/`▼` |

**Why it mattered:** the `py-2` header was ~32px tall — below the 44px accessible
tap-target minimum on a phone — and the three panels stacked directly on top of one
another in the in-game scroll region with inconsistent rhythm and no `aria-expanded`.

**After:** one `Collapsible` shell used by all three:
- comfortable **≥44px** touch target (`py-3 min-h-[44px]`)
- `aria-expanded` for assistive tech + a visible focus ring
- a **single chevron that rotates** on open (delightful, not noisy) instead of
  swapping two different glyphs
- `text-start` so RTL headers align correctly

State stays **fully controlled by the caller** (`open` / `onToggle`), so all existing
behaviour is preserved byte-for-byte — including `ChatSection`'s open-time
"mark thread read" side effect and the unread-dot logic, and `FeedSection` /
`ChatSection` keeping their lazy `Suspense`-mounted panels (offline `lazyWithRetry`
chunks untouched).

Before → after (per surface): identical open/close behaviour and content; taller,
consistent header; animated chevron; a11y attributes added.

### 2. Ghost `Button` legibility (`components/ui.tsx`)

Secondary ("ghost") buttons used `text-zinc-500` (`#78716c`) on the near-white
surface — a borderline ~4:1 contrast for a control label. Bumped to `text-zinc-400`
(`#57534e`) and added `font-semibold` so secondary actions read clearly without
competing with the fire-gradient primary CTA. This improves every ghost button
across the app in one place: FinalScreen (Leave, Share podium), PublicLeaderboard
(Share, Enter code), GamePromo (Have a code), etc. — reinforcing the "one obvious
primary action per screen" hierarchy (primary stays the warm gradient; secondary is
now a legible-but-quiet outline).

## Surfaces reviewed, intentionally left as-is

These were audited and judged already-strong; touching them would be churn/risk
without a clear win:

- **JoinScreen** — full-bleed gradient hero, large centred code field, 3-tile
  "how it works", "no account needed" reassurance, sound/colourblind/language
  toggles. Clear single CTA. Left unchanged.
- **FinalScreen / PublicLeaderboard / GamePromo** — celebratory hero + medal
  rows + share moments already polished; benefit indirectly from the ghost-button
  fix.
- **TaskRunner / NavMap / ConnectionBanner / InRunAlerts** — strong hierarchy and
  offline states; no safe structural change identified within this pass.

## Testing

This pass is **visual + structural only** — no pure logic helper was extracted, so
there is no new `scripts/test-*.ts` (the constraint's RED-first rule applies to pure
helpers; `Collapsible` is a controlled presentational React component). Verified by
static reasoning + the constrained-env gates below (no emulator / no shared|functions
build / no play:build, per the wave-L constraints — parent runs `play:build` at
integration).

Gates run green:
- `npx tsc --noEmit -p apps/play-web/tsconfig.json` — 0 errors
- `npx eslint` on changed files — 0 errors (only pre-existing non-null-assertion
  warnings in untouched code)
- `npx tsx scripts/check-i18n.ts` — PART A + PART B clean
- `npx tsx scripts/test-no-dashes.ts` — clean

## Files touched

- `apps/play-web/src/components/ui.tsx` — new `Collapsible`; ghost `Button` contrast
- `apps/play-web/src/components/LiveOps.tsx` — `LeaderboardPeek` uses `Collapsible`
- `apps/play-web/src/screens/PlayScreen.tsx` — `FeedSection` + `ChatSection` use `Collapsible`
