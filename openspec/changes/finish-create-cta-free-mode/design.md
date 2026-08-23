## Context

The finish-screen footer today (`apps/play-web/src/screens/FinalScreen.tsx:295-305`):

```tsx
{PAYMENTS_ENABLED && run.billingType !== 'pro' && (
  <a href={`${creatorUrl()}/?ref=${team.ownerUid}`} target="_blank" rel="noreferrer"
     className="block mt-2 rounded-2xl border border-glass-border bg-white/70 px-4 py-3 text-center hover:bg-white transition-colors">
    <div className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500 mb-0.5">
      <span>⚡</span> {t.final.poweredBy}
    </div>
    <div className="text-sm font-semibold" style={{ color: accent }}>
      {t.final.buildOwn}
    </div>
  </a>
)}
```

`PAYMENTS_ENABLED` is imported from `@rushpoint/shared` (`:2`) and is `false` at launch
(`packages/shared/src/freeMode.ts:17`). `creatorUrl()` (`lib/creatorUrl.ts`, already imported at
`:12`) is the deep link to the creator app used elsewhere on this screen (`:95, :113, :133, :143`).
`t.final.buildOwn` / `t.final.poweredBy` exist in both dictionaries (HE `i18n.ts:295-296`, EN
`:851-852`).

The single condition conflates three independent concerns: (a) show the invite, (b) suppress it for
Pro white-label, (c) attach the payments-only `?ref` reward. Only (b) should gate visibility.

## Goals / Non-Goals

**Goals:**
- Every finisher sees a create-your-own CTA, in free mode and paid mode.
- Referral reward and Pro white-label behavior are preserved exactly.

**Non-Goals:**
- Adding a second "play this game too" path (that is a separate finding, out of scope here).
- Any change to `freeMode.ts`, referral crediting, or the server.

## Decisions

### D1 — Visibility gates on Pro only; reward stays payments-gated

Change the render condition from
`PAYMENTS_ENABLED && run.billingType !== 'pro'` to `run.billingType !== 'pro'`, so the CTA renders in
both modes but stays hidden for Pro (white-label).

### D2 — The `?ref` tag is conditional on `PAYMENTS_ENABLED`, not the visibility

Build the href so the referral tag is only present when payments are on:

```tsx
const href = PAYMENTS_ENABLED ? `${creatorUrl()}/?ref=${team.ownerUid}` : creatorUrl();
```

When payments are off there is no free-run reward to claim, so linking to the plain `creatorUrl()`
is correct and avoids shipping a dead `?ref` param. When payments are on, behavior is byte-identical
to today.

### D3 — No copy change

The visible strings (`t.final.poweredBy`, `t.final.buildOwn`) already exist in HE + EN and already
route through `t.*`, so PART A stays clean and PART B gains no new hardcoded string. `⚡` is an emoji,
not translatable text.

## Risks / Trade-offs

- **The CTA now shows for `billingType === 'free'` and `'credit'`/`'test'` runs.** Intended — those
  are exactly the finishers we want to convert. Only Pro is suppressed, matching the white-label
  contract.
- **Navigation target for a logged-out participant.** `creatorUrl()` deep-links to the creator app,
  whose logged-out `AuthGate` is the marketing landing / signup surface (per project structure), so a
  stranger who taps it lands on a real create/sign-up entry point, not a dead route.

## Test Strategy

play-web has no component test runner. The condition is a trivial JSX gate with no extractable pure
helper, so this is verified by the UI lane:

- `npm run typecheck` · `npm run lint` · `npm run play:build` · `npm run creator:build` — green.
- `npm run i18n:check:strict` — clean, zero new PART B warnings (no new strings).
- Manual browser check (flagged, not a gate here): with `PAYMENTS_ENABLED = false`, finish a run and
  confirm the "Build your own field game" CTA appears and links to the creator app with no `?ref`;
  confirm a `billingType:'pro'` run shows no CTA.

## RTL / i18n notes

Both strings already render correctly in Hebrew (default) and English via `t.final.*`; the arrow glyph
in `buildOwn` is part of the existing localized string. No em-dashes introduced. No dictionary change.
