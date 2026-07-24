# Design

## The two current share sites (confirmed)

### `apps/play-web/src/screens/RunRecap.tsx:39-49`
```ts
async function share() {
  if (!data) return;
  setBusy(true);
  try {
    await shareRecap(data.photos, {
      title: data.title,
      ctaUrl: window.location.href,
      text: t.recap.shareText({ game: data.title }),
    });
  } finally { setBusy(false); }   // no catch, return value discarded
}
```

### `apps/play-web/src/screens/ChallengeTeaser.tsx:73-81`
```ts
async function share() {
  await shareChallenge({
    gameId, taskId,
    question: task?.title ?? '',
    gameName,
    playBaseUrl: window.location.origin,
    ctaText: t.challenge.shareText({ game: gameName || 'RushPoint' }),
  });   // no try, no busy state, return value discarded
}
```

## Key correction to the finding

The finding frames this as an *uncaught throw*. It is not: both
`shareRecap` (`recapCollage.ts:70-91`) and `shareChallenge`
(`challengeCard.ts:89-112`) are already total — every path returns a
`ShareResult` and the outer body is wrapped in `catch { return 'failed'; }`. The
defect is purely at the **call site**: the returned outcome is never read, so a
`'failed'` outcome produces no feedback. A `catch` in the caller is therefore
belt-and-suspenders, not the fix; **reading the outcome is the fix**.

## Reference pattern to mirror — the finish screen

`FinalScreen.share()` (`FinalScreen.tsx:142-161`) is the established shape:

```ts
const result = await shareStoryCard({ … }, text);
// A native share ('shared'), download or clipboard copy confirms; a
// cancellation resolves to 'failed', so it stays silent — no false "shared!".
if (result === 'downloaded' || result === 'copied' || result === 'shared') {
  setShared(true); setTimeout(() => setShared(false), 2500);
}
```

We mirror this shape (transient boolean → confirmation label → auto-clear), and
extend it so a **genuine failure** is not swallowed.

## The `'cancelled'` distinction (cancel vs. failure)

Today the lib collapses a user-cancel and a real error into `'failed'`:

```ts
try { await nav.share({ files: [file], … }); return 'shared'; } catch { return 'failed'; }
```

`navigator.share` rejects with a `DOMException` named `AbortError` when the user
dismisses the OS share sheet. We widen the outcome union to
`'shared' | 'downloaded' | 'copied' | 'failed' | 'cancelled'` and, in each
`nav.share` `catch`, return `'cancelled'` for an `AbortError` and `'failed'`
otherwise:

```ts
catch (e) { return (e as { name?: string })?.name === 'AbortError' ? 'cancelled' : 'failed'; }
```

This keeps a cancel quiet (matching how the finish screen treats a cancel as a
no-op) **without** also silencing a real failure. `shareRecap` and
`shareChallenge` each have two `nav.share` sites (the file-share branch and the
url-only branch) — both get the same treatment. `sharePhoto` is left as-is (out
of scope; it may adopt `'cancelled'` later).

## Caller behaviour after the change

Both `RunRecap.tsx` and `ChallengeTeaser.tsx` gain a small transient
feedback state (e.g. `shareNote: 'ok' | 'copied' | null`) rendered as an inline
line near the share button, auto-cleared after ~2.5s:

| outcome                          | caller does                                                              |
|----------------------------------|--------------------------------------------------------------------------|
| `'shared' \| 'downloaded' \| 'copied'` | positive confirmation (reuse `t.<block>.shareSaved`)                |
| `'failed'`                       | `navigator.clipboard.writeText(shareUrl)` then show `t.<block>.shareFailed` (a "couldn't share, link copied" line); if even clipboard rejects, still show the line |
| `'cancelled'`                    | nothing — quietly end, no false success                                  |

`ChallengeTeaser.share()` also gains the `busy` guard the recap already has, so a
double-tap can't fire two share sheets. The clipboard fallback URL is the same
one the lib already uses (`window.location.href` for recap; the challenge deep
link is inside the lib, so the caller falls back to `window.location.href`,
which is the teaser's own shareable URL).

## i18n

Confirmed present: `t.final.shareSaved` (HE `i18n.ts:293` `'✓ נשמר!'`, EN `:861`
`'✓ Saved!'`) and a top-level `linkCopied` (HE `:97`/`:545`, EN `:667`/`:1110`).
The `recap` block (HE `:572`, EN `:1137`) and `challenge` block (HE `:99`, EN
`:669`) have **no** share-result key today.

Add to BOTH the `recap` and `challenge` blocks, in BOTH HE and EN (no em-dash,
routed through `t.*`):
- `shareSaved` — positive confirmation, e.g. HE `'✓ הקישור הועתק'` / EN `'✓ Link copied'`
  (or reuse the existing `'✓ נשמר!'` / `'✓ Saved!'` wording for parity with `final`).
- `shareFailed` — failure fallback, e.g. HE `'לא הצלחנו לשתף, הקישור הועתק'` /
  EN `'Could not share, link copied'`.

Reuse over invention: if preferred, the positive case can reuse
`t.final.shareSaved` and the top-level `linkCopied` directly rather than adding a
per-block `shareSaved`; only `shareFailed` is genuinely new. Either way the copy
must exist in HE and EN and pass `npm run i18n:check:strict` (HE reads HE, EN
reads EN, no hardcoded component string).

## Testing

- **UI lane** (no component test runner exists for play-web): the change is
  verified via the preview tools + `npm run i18n:check:strict` for the new copy.
  The pure `scripts/lib/playA11yScan.ts` sweep still applies to any new markup
  (logical Tailwind classes, no icon-only nameless button).
- **Extractable pure helper (preferred RED-first target):** the outcome→feedback
  mapping is a pure function and should be extracted so it is unit-testable
  without a DOM. Add e.g. `shareOutcomeFeedback(result): 'confirm' | 'fallback' |
  'silent'` in a small play-web lib and a `scripts/test-*.ts` (auto-discovered by
  the aggregator) asserting: `'shared'|'downloaded'|'copied' ⇒ 'confirm'`,
  `'failed' ⇒ 'fallback'`, `'cancelled' ⇒ 'silent'`. This is the RED test the TDD
  ordering wants; the caller then consumes the mapped verdict.
- **Bundle:** assert no new eager import of the collage/canvas modules — the
  dynamic `import('../lib/…')` pattern (as `FinalScreen` uses) is preserved so
  `npm run bundle:budget` stays green.
