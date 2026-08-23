## Context

play-web has no component test runner, so this is a **UI lane** — a presentational regrouping of
three existing share triggers. It shares a file with the in-flight `finish-moment-polish` change
(which edits the share-success confirmation, badge refetch, and reveal sound). This change touches
only the **placement** of the share triggers and must not touch share behaviour, so the two can land
in either order with a trivial merge (they edit adjacent but distinct concerns).

## Current state (re-confirmed)

`apps/play-web/src/screens/FinalScreen.tsx`:

- **Recap card** — the `🗂️ recapTitle` `<Card>` with the stat grid, then:
  ```
  <Button className="mt-4" disabled={busy} onClick={share}>
    {busy ? t.final.shareCreating : shared ? t.final.shareSaved : t.final.shareBtn}
  </Button>
  {firstPhotoUrl && (
    <button disabled={busy} onClick={sharePhotoFn}
      className="mt-2 w-full min-h-[44px] text-sm text-ink-fire disabled:opacity-50">
      {t.final.sharePhoto}
    </button>
  )}
  ```
- **Podium card** — `{podium.length > 0 && (<Card>…<Button variant="ghost" className="mt-3 w-full" disabled={busy} onClick={sharePodiumFn}>{t.final.sharePodium}</Button></Card>)}`.

So: primary story share + photo share on the recap card, podium share buried in the podium card lower
down. `share`, `sharePhotoFn`, `sharePodiumFn` are all gated by the shared `busy` flag; existing i18n
keys `shareBtn` / `sharePhoto` / `sharePodium` / `shareCreating` / `shareSaved` exist in both dicts.

## The fix

On the **recap card**, keep the primary `share` button, then render a single **"more ways to share"**
row directly beneath it that contains whichever secondary triggers apply:

- the photo trigger (`sharePhotoFn`, `t.final.sharePhoto`) when `firstPhotoUrl`,
- the podium trigger (`sharePodiumFn`, `t.final.sharePodium`) when `podium.length > 0`.

Both keep `disabled={busy}` and their existing callbacks. When neither condition holds, the row is
absent and only the primary button shows (same as a photoless/podiumless finish today).

In the **podium card**, remove the embedded `sharePodiumFn` `<Button>`; everything else in that card
stays. The podium share now lives in the recap row.

The "more ways to share" row is a simple flex/stack of the secondary triggers styled consistently
(secondary weight, `min-h-[44px]` tap targets) — no new component, no disclosure logic required
(keep it a always-shown row of the applicable variants; a collapsible is optional and not needed for
two items).

## RTL / i18n notes

- HE is default. Use logical Tailwind only (`mt-*`, `gap-*`, `w-full`, `text-start`); no
  physical-direction classes. play-web reverses the zinc scale — reuse the existing secondary-button
  classes already on the photo button.
- **No new strings.** Reuse `final.shareBtn` / `final.sharePhoto` / `final.sharePodium` /
  `final.shareCreating` / `final.shareSaved`. No hardcoded UI literal, no em-dash.
- Run `npm run i18n:check:strict` — no dictionary change, so PART A parity is untouched and there is
  zero new PART B.

## Test strategy

Presentational **UI lane** — no pure decision is added (the conditions `firstPhotoUrl` and
`podium.length > 0` already exist and are unchanged). Verify via `npm run typecheck` · `npm run lint`
· `npm run play:build` · `npm run bundle:budget` · `npm run i18n:check:strict`. Manual: on a finish
with a photo and a podium, the recap card shows the primary share plus a single row exposing photo +
podium share; the podium card no longer carries its own share button; each trigger still produces its
respective card; a finish with no photo/no podium shows only the primary button.

## Non-regression checklist

- All three share outputs (story / photo / podium) still reachable; callbacks unchanged.
- `busy` gating and the `shared`/`shareSaved` confirmation semantics untouched (owned by
  `finish-moment-polish`; this change does not alter them).
- Podium card reveal (medals/names/scores/animation) unchanged apart from the removed button.
- No new i18n key; parity + PART B unchanged.
