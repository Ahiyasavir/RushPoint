# Visual design review — play-web Join screen

**Date:** 2026-07-28 · **Branch:** topographic-maps · **Reviewer:** design-review pass
**Method:** Playwright, real device profiles (Pixel 7 412×915 @2.625x, iPhone SE 375×667 @2x), light scheme, Hebrew default + English toggle. No backend (join step 1 renders without one).
**Scope:** review only — no source files were changed.

## Verdict

The user is right, and the diagnosis is more specific than "it looks bad": **the screen looks broken in its empty state and fine in its filled state.** Everything below flows from that. Type the code in and the screen is genuinely good (see `join-pixel7-field-typed-crop.png`). Land on it cold — which is what every real participant does — and it presents a code field that appears to already contain `ABC123` sitting above a washed-out, semi-transparent "המשך" button. The unavoidable read is *"there's a value in the box but the button is dead — this thing is broken."*

Layered on top of that are one measured layout collision, one duplicated icon, and a five-deep stack of identically-styled 11px grey lines under the CTA that has no hierarchy at all.

Two of the four suspicions in the brief are **confirmed**, one is **partly confirmed**, one is **refuted**:

| Suspicion | Verdict |
|---|---|
| 1. Placeholder reads as a filled value | **CONFIRMED — and it is the whole problem** |
| 2. Staff block + creator link dominate / make the page noisy | **CONFIRMED (noise), partly refuted (dominate)** — they don't outrank the CTA, but they're an undifferentiated grey mush and the staff link outranks the *other* secondary links |
| 3. Vertical rhythm inconsistent after padding trim | **PARTLY CONFIRMED** — the hero/field/CTA rhythm is fine; there is a measured 103px dead hole lower down on Pixel 7 |
| 4. Primary action below the fold | **REFUTED** — the CTA is comfortably above the fold on both devices (bottom at y=475 of an 839px viewport on Pixel 7; y=475 of 568 on iPhone SE). Don't "fix" this. |

---

## Screenshots

All paths absolute, under `C:\Users\savir\Projects\Rushpoint\docs\design-review\`:

| File | What it shows |
|---|---|
| `join-pixel7-field-empty-crop.png` | **The money shot.** Tight crop of label + field + CTA in the empty state. This one image is the bug report. |
| `join-pixel7-field-typed-crop.png` | Same crop with `KX7Q42` typed. Shows how good it looks when it works. |
| `join-pixel7-he-fold.png` | Hebrew, Pixel 7, above the fold |
| `join-pixel7-he-fullpage.png` | Hebrew, Pixel 7, full page |
| `join-pixel7-he-typed.png` | Hebrew, Pixel 7, code entered |
| `join-pixel7-en-fold.png` / `join-pixel7-en-fullpage.png` | English/LTR, Pixel 7 |
| `join-iphonese-he-fold.png` / `join-iphonese-he-fullpage.png` | Hebrew, iPhone SE (the tight one) |
| `join-iphonese-en-fold.png` / `join-iphonese-en-fullpage.png` | English, iPhone SE |
| `terms-pixel7-fold.png` / `terms-pixel7-fullpage.png` | `/terms` legal route |
| `measurements.json` | Raw computed styles + geometry backing every number below |

> **Capture caveat:** with no emulator running, the `publicGames/{DEMO_GAME_ID}` probe (`JoinScreen.tsx:83-94`) fails, so `demoReady` stays `false` and the **"נסו משחק לדוגמה" demo block is absent from every screenshot.** In production it renders between the CTA and the staff block and adds ~90px — a 44px pill plus another 11px grey caption. That makes finding #4 below strictly worse than the screenshots show.

---

## Findings, ranked

### S1 — CRITICAL: the placeholder is styled as content, not as a hint

**File:** `apps/play-web/src/screens/JoinScreen.tsx:294-319` (placeholder on :300, classes on :307 and :310) · string at `apps/play-web/src/i18n.ts:44` (HE) and `:656` (EN).

Measured computed style of `::placeholder`:

| | Placeholder | Real typed value | Body secondary text |
|---|---|---|---|
| Colour | `#78716c` (`zinc-500`) | `#1c1917` (`zinc-100`) | `#78716c` (`zinc-500`) |
| Contrast on white | **4.80:1** | 16.4:1 | 4.80:1 |
| Size | 20px | 30px | 11–16px |
| Weight | **700** | 700 | 400 |
| Family | mono | mono | sans |

Three things are wrong at once, and they compound:

1. **Contrast is far too high.** 4.80:1 is a *passing AA body-text* ratio. A placeholder should read as absent — roughly 2.5–3:1. As specified, the hint has the same contrast as every real sentence on the page.
2. **It inherits `font-bold` and `font-mono` from the input.** `placeholder:` only overrides size and tracking (`:310`), never weight or family. So `ABC123` is bold monospace — the exact typographic signature of an entered access code.
3. **It sits in an autofocused field with an active orange focus ring** (`codeRef.current?.focus()` at `:99`, ring at `:312`). Focus ring + bold mono text = "this field is active and filled."

And the kicker: directly beneath it, the CTA is `disabled` at `opacity: 0.4` (measured). **The screen simultaneously says "you have entered a code" and "you cannot continue."** That contradiction is what "looks terrible" actually means here. Compare `join-pixel7-field-empty-crop.png` against `join-pixel7-field-typed-crop.png` — the filled state is clean and confident; the empty state looks like a failed render.

Note the codebase already got the *hard* part right: the CLAUDE.md-documented reversed zinc scale is not a mistake here, the author knew `zinc-500` is dark. The mistake is reusing the generic secondary-text token for a placeholder, where "dark enough to read comfortably" is precisely the wrong goal.

**Fix (in order of preference):**

- **Best — drop the placeholder entirely.** There is already a real visible label (`הקוד שלכם` / `Your code`, `:290-292`), added deliberately per the comment at `:285-289`. `ABC123` adds no information the label doesn't carry, and a fake-looking value is worse than nothing. Delete `placeholder={t.join.codePlaceholder}` on `:300` and the `placeholder:*` classes on `:310`. This is a one-line change that fixes the whole complaint.
- **If you want to keep a format hint**, make it unmistakably not-a-value: add `placeholder:font-sans placeholder:font-normal placeholder:text-base` alongside a dedicated dim token (a new `placeholder` colour around `#a8a29e`/`zinc-600`, ≈2.4:1) and change the copy to something no one could mistake for a code — e.g. `6 תווים` / `6 characters`. Do **not** just lighten the colour and leave it bold mono; weight and family are doing as much damage as contrast.
- Either way, add a `placeholder` entry to the a11y scan or a note so it does not regress: the rule is *placeholders never share the secondary-text token*.

### S2 — HIGH: the toggle cluster physically collides with the app icon

**File:** `JoinScreen.tsx:248` (`absolute top-4 end-4`) vs the hero icon at `:228-236`.

Measured, and it overlaps in **both** languages:

| | Toggle cluster | App icon | Overlap |
|---|---|---|---|
| Pixel 7 Hebrew | x 16→185, y 40→84 | x 174→238, y 64→128 | **11px × 20px** |
| Pixel 7 English | x 233→396, y 40→84 | x 174→238, y 64→128 | **5px × 20px** |
| iPhone SE Hebrew | (same pattern, worse) | | visible in screenshot |

The cause is structural, not a magic number: the cluster is `absolute` with no width, so it shrink-wraps its three 44px targets (~165–170px total) and grows *inward* from whichever edge `end-4` resolves to — left in RTL, right in LTR. The hero icon is horizontally centred. On a 375–412px viewport there is only ~100–120px of clearance per side, so the innermost toggle (🔊) lands on top of the icon. You can see the sound button's circular border cutting across the orange tile in `join-iphonese-he-fold.png` and `join-iphonese-en-fold.png`. It reads as a rendering glitch.

**Fix:** stop letting the two compete for the same band. Either
(a) give the hero its own row — make the toggle strip a normal `flex justify-between` bar *above* the icon rather than absolutely positioned over it, or
(b) keep it absolute but push the hero down (`pt-10` → `pt-14` on `:221`) so the icon starts below y=88, or
(c) collapse three toggles into one overflow/settings button (44px total instead of ~170px), which also cuts the visual noise at the top of a screen whose only job is "type a code."

Option (a) is the honest fix; (b) is the one-token fix. Note that (b) costs ~16px of the vertical budget, which the Pixel 7 English layout (see S7) cannot spare without also doing S5.

### S3 — HIGH: the disabled CTA looks broken rather than inactive

**File:** `apps/play-web/src/components/ui.tsx:40` — `disabled:opacity-40` on the shared `Button`; used at `JoinScreen.tsx:333-340`.

`opacity: 0.4` is applied to the whole element, so:

- The rich `#C2410C → #B45309` gradient washes to a muddy salmon.
- The white label drops to roughly 1.9:1 against that wash — unreadable at a glance.
- The **page's dot-grid background shows straight through the button** (clearly visible in `join-pixel7-field-empty-crop.png`). A solid-fill control you can see the wallpaper through does not read as "disabled", it reads as "failed to paint".
- The heavy orange glow shadow is *not* faded proportionally in perception, so the button still emits a coloured halo while looking dead. Glowing and disabled at the same time is incoherent.

**Fix:** replace blanket opacity with an explicit disabled skin — a flat neutral fill, no gradient, **no shadow**, and a label colour chosen for contrast (e.g. `disabled:bg-zinc-700 disabled:text-zinc-500 disabled:shadow-none` in the reversed scale, i.e. a light grey chip with legible grey text). This is a shared-component change, so it improves every disabled CTA in play-web, not just Join. Verify the result against `scripts/test-play-a11y-scan.ts` contrast expectations.

Doing S1 + S3 together is what actually fixes "looks terrible." Neither alone is enough: fix only the placeholder and you still have a ghost button; fix only the button and you still have a phantom code.

### S4 — MEDIUM: five identical grey lines under the CTA, with no grouping

**File:** `JoinScreen.tsx:329-331` (oneDeviceNote), `:346-357` (demo, hidden in captures), `:362-372` (staff), `:377-385` (create-your-own), `:406-408` (noAccountNeeded), `:409` (LegalFooter).

Everything below the CTA is `text-[11px] text-zinc-500` — measured identical colour `rgb(120,113,108)` and identical 11px size on **five** consecutive paragraphs, at y = 388, 539, 570, 715, 748 (Pixel 7 Hebrew). There is not one rule, card, background change or spacing step between them. Four unrelated ideas (one-phone-per-team · staff sign-in · become a creator · no account needed) are rendered as one undifferentiated texture. The eye has nothing to grip, which is a large part of the "noisy" feeling.

Sub-problems inside that block:

- **The staff link is the heaviest thing on the page after the CTA** — 14px `zinc-400` (`#57534e`, darker than everything around it), centred, emoji-prefixed, with a caption under it. It reads like a **section heading**, not a demoted secondary action. It is not competing with the CTA (good), but it *is* beating the demo entry and the creator link, which is backwards: the staff path is for a handful of organisers, the demo path is for every code-less installer. The heading-like styling also works against the whole point of the `:359-361` comment, which is to make players *not* tap it.
- **`oneDeviceNote` is stranded between the field and the CTA** (`:329-331`, y=388, immediately above the button at y=415). An 11px grey caveat wedged into the primary action's breathing room is the single worst place for it — it interrupts field→button, which should be the tightest coupling on the page.
- **`createOwnCta` mixes a 400-weight grey sentence with a bold underlined `ink-fire` link** on one 11px line. At 11px the underline plus bold plus colour is three emphasis signals on ~4 words; it flickers.

**Fix:**
1. Move `oneDeviceNote` **below** the CTA (or fold it into the label/helper line above the field). Field → button should be uninterrupted.
2. Insert one real separator after the primary block — a `border-t border-glass-border` with generous `pt-6` — and put demo/staff/creator *below* it. One horizontal rule buys more clarity here than any amount of copy editing.
3. Give the three secondary paths **one** shared treatment and rank them by audience size: demo (most players) → creator → staff (fewest). Right now the order is demo → staff → creator and the weights are staff > creator = demo.
4. Demote the staff link to the same 11px/`zinc-500` register as its neighbours, or move it into a footer row next to the legal links where organisers will still find it and players will not.

### S5 — MEDIUM: a 103px dead hole on Pixel 7

**File:** `JoinScreen.tsx:388` — `<div className="mt-auto pt-4">` on the how-it-works trio.

Measured on Pixel 7 Hebrew: the create-your-own line ends at y=587; the how-it-works grid starts at y=690. **103px of nothing.** On iPhone SE the content overflows so `mt-auto` collapses and the gap is 0 — which is why the rhythm reads as *inconsistent*: the same screen is comfortably packed on the small phone and has a visible hole on the large one. `mt-auto` inside a `flex-1` column produces exactly this: whatever slack the viewport happens to have, dumped in one place.

**Fix:** replace `mt-auto` with a deliberate fixed step (`mt-8` / `mt-10`) so the gap is the same on every device, and let the trailing space fall at the bottom of the page where empty space is normal. If you specifically want the trio pinned to the bottom, distribute the slack instead (`justify-between` on the section, or `space-y-*` on a wrapper) rather than dropping all of it into one seam.

### S6 — LOW: 🔑 means two different things on one screen

**File:** `JoinScreen.tsx:368` (staff sign-in) and `:391` (the `how1Label` "הצטרפו / Join" card).

The same key emoji marks "event staff sign in" and "enter your code to join" — the two actions the `:359-361` comment says players already confuse. Visible ~200px apart in `join-iphonese-he-fullpage.png`. Give one of them a different glyph; 🎟️ or 🔢 for the join card, or drop the emoji from the staff link entirely when you demote it per S4.

### S7 — LOW: 24px overflow on Pixel 7 in English

Measured `scrollHeight` vs `innerHeight`: Pixel 7 Hebrew 839 / 839 (**exact fit**), Pixel 7 English 863 / 839 (**24px over**). English's `oneDeviceNote` wraps to two lines where Hebrew fits one, and that is the entire deficit.

24px is the worst possible overflow amount — enough to show a scrollbar and a clipped legal footer, not enough to signal there's anything worth scrolling to. Fixing S5 (reclaim 103px) makes this vanish with room to spare, and with the demo block present in production both languages overflow anyway. So: **treat S5 as the fix for S7**, and do not chase the 24px on its own.

### S8 — NIT: letter-spaced code is optically off-centre

**File:** `JoinScreen.tsx:307` — `text-center ... tracking-[0.5em]`.

CSS letter-spacing adds the space *after* the final glyph, so a centred letter-spaced string sits ~half a letter-space left of true centre. Visible in `join-pixel7-field-typed-crop.png` as a slight leftward bias. Standard fix: `text-indent: 0.5em` on the input (or a matching `padding-inline-start`) to push the run back into optical centre. Cosmetic; only worth doing while you are already in this file.

---

## What is GOOD — do not regress these

Enumerated deliberately, because the fixes above touch the same lines.

1. **The filled state is genuinely well designed.** `join-pixel7-field-typed-crop.png`: 30px bold mono at `tracking-[0.5em]` in a tall white well, with a confident burnt-orange CTA directly beneath. That is a better code-entry field than most apps ship. **Every fix must preserve the filled state exactly** — S1 in particular should touch only `placeholder:*` and the `placeholder` attribute, never the base `text-3xl font-mono font-bold tracking-[0.5em]`.
2. **Label instead of placeholder-as-label** (`:285-292`). The reasoning in that comment is correct and the accessible name survives typing. Removing the placeholder (S1, preferred fix) *strengthens* this decision rather than undoing it.
3. **The primary action is above the fold on both devices** — CTA bottom at y=475 against a 568px iPhone SE viewport. The brief worried about this; it is fine. None of the recommended fixes may push it down.
4. **Tap targets.** Every interactive element measured ≥44px: toggles 44, CTA 60, staff 44. `TAP_TARGET` and the `min-h-[44px]` discipline are being applied consistently.
5. **Text contrast on the reversed scale.** The `ink-*` tokens are doing their job — `ink-fire` `#B03A0B` at 6.08:1 for the create-a-game link, `zinc-100` `#1c1917` for input text, `zinc-200` for card labels. The only contrast complaint in this review is that the *placeholder* is too high, which is the opposite of the usual problem. The `.ink-*` comment block in `tailwind.config.js:37-45` is exemplary and should stay.
6. **RTL is correct.** `dir` flips to `rtl`/`ltr` cleanly, logical properties (`end-4`, `ms-`) are used throughout, the Hebrew trailing punctuation renders correctly, `dir="ltr"` is correctly pinned on the code field so the Latin code isn't reordered, and the English layout is a clean mirror with no stranded elements. The only RTL-adjacent defect is S2, and that is a sizing problem that happens in LTR too — not an RTL bug.
7. **The hero.** Gradient-clipped `RushPoint` wordmark, the rounded app-icon tile with its warm double shadow, and the radial glow are the strongest brand moment in the app. Keep them; S2's fix should move things *around* the icon, not shrink it.
8. **The how-it-works trio** (`:389-405`) is a well-proportioned three-up: white/70 cards, staggered fade-up, clear icon → label → sub hierarchy. It is the only part of the lower page that *has* hierarchy. Do not delete it while cleaning up S4 — it is the fix pattern the grey-text block should imitate, not another victim.
9. **`/terms`** (`terms-pixel7-fold.png`): back link, title, last-updated stamp, HE/EN segmented control, numbered sections with rules, generous 1.6ish line-height, correct RTL, bold inline emphasis. Clean, readable, no issues found. The 8967px length is expected for legal prose.
10. **Loading/animation restraint.** `animate-race-in` on entry and staggered `animate-fade-up` (80ms steps) on the cards are subtle and don't fight the content.

---

## Suggested order of work

1. **S1 + S3 together** (`JoinScreen.tsx:300,310` + `ui.tsx:40`). This is ~90% of the perceived problem and is a handful of lines. Re-shoot `join-pixel7-field-empty-crop.png` to confirm.
2. **S2** (`JoinScreen.tsx:221,248`) — one measured collision, one-token fix available.
3. **S4 + S5** together (`JoinScreen.tsx:329-409`) — the separator, the reorder, the fixed gap. This is the real layout work and it resolves S7 as a side effect.
4. **S6, S8** — nits, fold in while you're already there.

Reminder from CLAUDE.md: any of these touches play-web UI, so `npm run i18n:check:strict` must come out clean, plus `npm run play:build` and `npm run bundle:budget`. S3 touches shared `ui.tsx`, so re-check `scripts/test-play-a11y-scan.ts` for contrast assertions on the new disabled skin.

---
---

# ADDENDUM — verification pass after fixes (2026-07-28)

Re-captured with the identical method (Playwright, Pixel 7 + iPhone SE, Hebrew + English, fold + fullPage). New files are prefixed `after-`; the originals are untouched for before/after comparison.

## Scorecard

| Finding | Status |
|---|---|
| S1 placeholder reads as a value | FIXED |
| S2 toggle/icon collision | FIXED (measured, both languages) |
| S3 disabled CTA | **NOT FIXED — REGRESSED. Now worse than before.** |
| S4 grey-wall / shelf grouping | FIXED |
| S5 103px dead hole | FIXED |
| S6 duplicate key emoji | FIXED (bonus) |
| S7 Pixel 7 EN overflow | FIXED on Pixel 7; slightly worse on iPhone SE |
| — | **NEW: staff link tap target 44px -> 17px** |

Four of five landed cleanly. One did not land at all, and it is the one that matters most.

## After-screenshots

`C:\Users\savir\Projects\Rushpoint\docs\design-review\`

| File | What it shows |
|---|---|
| `after-cta-disabled-probe.png` | **The new bug.** Tight crop of the disabled CTA. |
| `after-cta-enabled-probe.png` | Same crop, enabled — for comparison |
| `after-join-pixel7-field-empty-crop.png` | Empty field, Pixel 7 HE |
| `after-join-pixel7-field-typed-crop.png` | Filled field — regression check |
| `after-join-pixel7-he-fold.png` / `-fullpage.png` | Hebrew, Pixel 7 |
| `after-join-pixel7-he-typed.png` | Hebrew, Pixel 7, code entered |
| `after-join-pixel7-en-fold.png` / `-fullpage.png` | English, Pixel 7 |
| `after-join-iphonese-he-fold.png` / `-fullpage.png` | Hebrew, iPhone SE |
| `after-join-iphonese-en-fold.png` / `-fullpage.png` | English, iPhone SE |
| `after-measurements.json` | Raw computed styles + geometry |

---

## 1. Is the empty state fixed?

**Half.** The field: yes, completely. The CTA: no — it went backwards.

**Field — fixed, exactly as intended.** Measured `placeholder` attribute is `null`, value `""`. The field renders as a clean empty white well with the focus ring and the codeLabel above it. Nothing reads as pre-filled. The base styling is untouched (`30px` / `letter-spacing 15px` / weight `700` / JetBrains Mono / `#1c1917`), so the filled state is identical to before — confirmed against `after-join-pixel7-field-typed-crop.png`. This was the single biggest contributor to "looks terrible" and it is gone.

**CTA — the fix did not apply, and the failure mode is worse than the bug it replaced.** `disabled:bg-zinc-800` sets `background-color`. The `primary` variant's `bg-gradient-to-r from-[#C2410C] to-[#B45309]` sets **`background-image`**. They are *different CSS properties*, so nothing is overridden — the gradient paints on top of the background colour and the muted fill is never visible. Measured on the disabled button in all four device/language profiles:

```
backgroundColor : rgb(231, 229, 228)   <- set, but painted UNDER
backgroundImage : linear-gradient(to right, rgb(194,65,12), rgb(180,83,9))   <- what you actually see
color           : rgb(87, 83, 78)
opacity         : 1
```

So the disabled CTA is now a **fully saturated, fully opaque orange button** — visually indistinguishable from the enabled one — with dark slate text on it. See `after-cta-disabled-probe.png`.

The 6.08:1 figure is a measurement of the wrong layer: it compares `#57534e` against the *background-color* `#e7e5e4`, which never reaches the screen. Against the gradient that actually paints, the label measures **1.47:1 at the left end and 1.52:1 at the right**. The label is barely legible.

Net effect: before, the button looked broken but at least looked *unavailable*. Now it looks completely available. A player who lands cold sees a big confident orange Continue, taps it, and nothing happens — no state change, no message, no feedback. That is a worse failure than the original, because it invites the tap.

**Fix — one token:** add `disabled:bg-none` (Tailwind's `background-image: none`) ahead of the fill:

```
disabled:bg-none disabled:bg-zinc-800 disabled:text-zinc-400 disabled:shadow-none disabled:cursor-not-allowed
```

Everything else in the S3 change is correct and should stay. Verified independently: `disabled:shadow-none` **works** — the disabled button measures an all-zero `box-shadow`, and the enabled button correctly retains `rgba(255,87,34,0.4) 0 4px 16px, rgba(255,87,34,0.25) 0 1px 4px`. The glowing-dead-button half of S3 is genuinely fixed; only the fill is wrong. `cursor: not-allowed` also applies correctly.

After adding `bg-none`, re-measure — the label/fill pair should then genuinely be `#57534e` on `#e7e5e4` = 6.08:1, which is the right target.

## 2. Did the toggle/icon collision go away in both languages?

**Yes — measured, not eyeballed.** `overlapIconToggles: false` in all four profiles.

| Profile | Toggle row (y) | Icon (y) | Vertical clearance | Overlap |
|---|---|---|---|---|
| Pixel 7 HE | 12 -> 56 | 60 -> 124 | 4px | none |
| Pixel 7 EN | 12 -> 56 | 60 -> 124 | 4px | none |
| iPhone SE HE | 12 -> 56 | 60 -> 124 | 4px | none |
| iPhone SE EN | 12 -> 56 | 60 -> 124 | 4px | none |

Moving the cluster into normal flow was the right call — a flex sibling structurally cannot overlap the icon, so this class of bug is now impossible rather than merely avoided. The row is full-width (`w: 364` on Pixel 7, `272` on SE) with `justify-end`, and it mirrors correctly: packed left in RTL, right in LTR.

**One caveat: 4px of clearance is very tight.** In `after-join-iphonese-en-fold.png` and `after-join-pixel7-he-fold.png` the innermost toggle still *looks* like it is touching the icon, because the icon's `0 8px 32px rgba(255,87,34,0.45)` glow extends well past its box and the toggle sits inside that halo. It is no longer a defect — but if you want it to read as clearly separated rather than narrowly missing, `mb-1` -> `mb-3` on the toggle row buys 8px. Note that on Pixel 7 there is currently zero vertical slack (see item 3 of section 5), so that costs overflow.

## 3. Does the lower shelf read as a separate zone?

**Yes. This is the cleanest of the four fixes.** The `border-t` hairline at y=495 sits 24px below the CTA and does exactly the job a wall of text could not: it says "everything under here is not your path." In `after-join-pixel7-he-fold.png` the page now has three legible bands — hero, primary action, other-audience shelf, plus the how-it-works strip — where before it had two and a smear.

Specifically resolved:
- **Ranking corrected.** Creator link at y=512, staff at y=537. More common need first, rarest last, as recommended.
- **Weights equalised.** Both entries measure 11px. The old 14px `zinc-400` heading-like staff link is gone, so it no longer outranks its neighbours. Within the shelf the creator link is `ink-fire` orange and the staff link is `zinc-400` grey — a deliberate, correct secondary ranking rather than the accidental inversion before.
- **Key emoji removed** from the staff link, so it now means exactly one thing on the page (the "join" how-to card). S6 fixed as a side effect.
- **Dead space gone.** Rule-bottom to grid-top is a consistent **32px** in every one of the four profiles — the same rhythm on a small phone and a large one, which was the actual S5 complaint. The Pixel 7 103px hole is gone.

One thing left on the table: `oneDeviceNote` is still wedged between the field and the CTA (y=384, button at y=411). Recommendation 1 of S4 was to move it below the CTA so field-to-button is uninterrupted. Not done, still worth doing, but with the shelf in place it is now a minor rhythm nit rather than part of a grey wall.

## 4. Did you regress anything from the GOOD list?

**One regression, and it is not a visual one.**

**Tap target: the staff link went from 44px to 17px.** Measured heights of every interactive element on the screen:

```
sound     44  ok       colorblind 44  ok       lang 44  ok
code input 80  ok      CTA        60  ok
creator link ("build a game")   14  FAIL
staff link                      17  FAIL   <- was 44 before
Terms / Privacy                 14  (pre-existing, LegalFooter)
```

The old staff control carried `min-h-[44px] px-3`; the rewrite made it a bare inline `<button>` inside a `<p>`, so it lost the minimum. Item 5 of the GOOD list was specifically "every interactive element measured >=44px — `TAP_TARGET` and the `min-h-[44px]` discipline are being applied consistently." That is no longer true, and this is a control organisers tap outdoors on event day.

The creator `<a>` at 14px is *not* a regression — it was an inline prose link before too, and inline links in a sentence are conventionally exempt. The Terms/Privacy links are pre-existing `LegalFooter`. Only the staff button changed.

Fix: give the staff button back `inline-flex items-center min-h-[44px] px-3` (it can stay visually 11px — height and font size are independent), or make the whole shelf row the target. Worth checking whether `scripts/test-play-a11y-scan.ts` covers icon-only buttons only or all controls; if the latter, this may already be red.

**Everything else on the GOOD list survived:**

1. **Filled state identical** — `30px` / `ls 15px` / weight `700` / JetBrains Mono / `#1c1917`, all unchanged. The base classes were correctly left alone.
2. **Label-not-placeholder** — the `<label htmlFor>` is intact and is now the *only* naming mechanism, which strengthens the original decision.
3. **CTA above the fold** — bottom at y=471 on both devices (SE viewport 568). Actually 4px better than before.
4. Tap targets — see above (the one regression).
5. **Contrast tokens** — `ink-fire` on the creator link, `zinc-100` input text, `zinc-200` card labels all unchanged. (The disabled-CTA contrast problem is the `bg-none` bug, not a token change.)
6. **RTL** — `dir` flips cleanly, the new flex row mirrors correctly, no stranded elements in either direction.
7. **Hero** — icon, gradient wordmark, glow all intact; `pt-10 -> pt-3` moved it up without shrinking anything.
8. **How-it-works trio** — untouched. Still 3-up at y=604, h=88, same `bg-white/70` cards, same icon/label/sub hierarchy, same 80ms staggered `animate-fade-up`. No regression.
9. `/terms` — not in the change surface, not re-reviewed.
10. **Animation restraint** — unchanged.

## 5. Anything NEW that's wrong?

1. **[HIGH] The disabled-CTA gradient** — section 1 above. This is the one blocking item.
2. **[MEDIUM] Staff tap target 44px -> 17px** — section 4 above.
3. **[LOW] iPhone SE got slightly taller.** Page height moved 764 -> **789** (HE) and 764 -> **804** (EN); overflow against the 568px viewport grew from 196px to 221/236px. The toggle row now occupies 48px of real flow height, and `pt-10 -> pt-3` only gave back 28px. Pixel 7 came out ahead — **839/839 in Hebrew and 839/839 in English, an exact fit with zero overflow**, versus 24px of overflow in English before — so the trade is large-phone perfection for ~30px more scroll on a phone that already scrolled. Acceptable; flagging only so it is a decision rather than a surprise. Note there is now **zero slack on Pixel 7**, so any future addition (including the demo block, still invisible in these captures — no emulator) pushes it back into overflow.
4. **[LOW] Two underline styles inside the shelf.** The creator link is bold + underlined + `ink-fire`; the staff link is bold + underlined + `zinc-400`. Both underlined and bold at 11px is a lot of emphasis for a deliberately quiet zone. Consider dropping the bold from the staff entry and letting colour alone carry the ranking.
5. **[NIT] S8 unaddressed** — the letter-spaced code is still ~half a letter-space left of optical centre (`letter-spacing: 15px` with `text-center`). Cosmetic, unchanged, still fixable with `text-indent: 0.5em`.

## Verdict

Ship-blocking: **the `disabled:bg-none` one-liner.** Without it the primary CTA lies about its own state, which is a functional defect, not a cosmetic one — and it is the *only* thing standing between this screen and a clean pass. Fix that plus the 44px staff target and the join screen goes from "looks terrible" to genuinely good; the field, the shelf, the rhythm and the collision are all properly solved.

---
---

# ADDENDUM 2 — second verification pass (2026-07-28)

Targeted re-verification of the two follow-up fixes, plus a diagnosis of the reported "enabled CTA renders grey". Pixel 7 profile, Hebrew. New files prefixed `after2-`.

| Item | Status |
|---|---|
| 1. Disabled CTA `bg-none` | **FIXED — confirmed on device profile** |
| 2. Staff tap target 44px | **FIXED — confirmed, still reads as quiet text** |
| 3. Shelf with two entries, no caption | **Reads correctly** |
| 4. "Enabled CTA is grey" | **NOT A DEFECT — measurement artifact. Cause identified.** |

Files: `after2-cta-disabled.png` · `after2-cta-enabled.png` · `after2-shelf.png` · `after2-join-pixel7-he-fold.png` · `after2-measurements.json`

## 1. Disabled CTA — fixed

Measured with `element.disabled === true` asserted:

```
backgroundImage : none                                  <- was the orange gradient
backgroundColor : rgb(231, 229, 228)                    <- now the layer that actually paints
color           : rgb(87, 83, 78)
boxShadow       : all-zero (three null shadows)
--tw-shadow     : 0 0 #0000
cursor          : not-allowed
```

**Contrast against the painting layer: 6.08:1.** That figure is now real — `background-image` is `none`, so `background-color` is genuinely what reaches the screen. `after2-cta-disabled.png` shows a flat, opaque light-grey chip with legible dark-grey text: no orange, no glow, and no dot-grid bleeding through. It reads as "not yet", which is exactly what was wanted.

## 2. Staff tap target — fixed

```
height     : 44px      (was 17px)
min-height : 44px
display    : inline-flex
padding    : 0px 12px
font-size  : 11px      <- unchanged, still quiet
font-weight: 700
color      : rgb(87, 83, 78)   (zinc-400)
decoration : underline
```

Real 44px target with 11px type — height and font size correctly decoupled. In `after2-shelf.png` it still reads as a quiet text link, not a button: no fill, no border, no chip. The extra height is invisible padding, which is the right outcome.

Every interactive element on the screen is now ≥44px except the inline prose links (creator link, Terms, Privacy), which are inline-in-sentence and conventionally exempt — and unchanged from before this work.

## 3. Shelf with two entries and no caption — reads correctly

```
hairline rule   y 495
creator line    y 512  h 17
staff link      y 537  h 44
rule -> grid gap       32px
page            839 / 839  (exact fit, zero overflow — unchanged)
```

The staff `<p>` now contains exactly one child (the button); the caption is gone. It still reads correctly, and arguably better: `כניסת מארגנים` / `Organizer sign in` does the disambiguation work the hint used to do, because the noun itself says who it is for. The original failure mode was `אני צוות` ("we are a team"), which named the *wrong* group — that is fixed by the word choice, not by the caption. Dropping the caption also removes the last of the stacked 11px grey lines, so the shelf is now two clean entries under a rule.

Two entries is enough structure for a rule to be worth it — it still reads as a distinct "not your path" zone rather than a stray pair of links. No change needed.

Minor, unchanged from Addendum 1 item 4: both entries are bold + underlined at 11px, which is a lot of emphasis for a deliberately quiet zone. Dropping `font-bold` from the staff entry would let colour alone carry the ranking. Cosmetic, optional.

## 4. "Enabled CTA renders grey with no shadow" — not a defect

**I cannot reproduce it, and I found the cause of the reading.**

Measured with `element.disabled === false` asserted and settled:

```
color           : rgb(255, 255, 255)     <- white, as authored
backgroundImage : linear-gradient(to right, rgb(194,65,12), rgb(180,83,9))
boxShadow       : rgba(255,87,34,0.4) 0 4px 16px, rgba(255,87,34,0.25) 0 1px 4px
--tw-shadow     : 0 4px 16px rgba(255,87,34,0.40), 0 1px 4px rgba(255,87,34,0.25)
cursor          : pointer
contrast        : 5.18:1 (left stop) / 5.02:1 (right stop)  — passes AA
```

`after2-cta-enabled.png` confirms it visually: saturated orange gradient, crisp white label, orange glow present.

**Cause of the grey reading: `transition-all duration-150`.** The button carries a 150ms transition on *all* properties. When it flips disabled → enabled, `color` and `box-shadow` **interpolate** over 150ms while `background-image` **snaps** instantly (there is no interpolation between `none` and a gradient). Sampling `getComputedStyle` during that window returns the in-flight value. I sampled it frame by frame:

| t after enable | `disabled` | `color` | shadow | bg-image |
|---|---|---|---|---|
| before | true | `rgb(87,83,78)` | none | none |
| +0ms | **false** | **`rgb(87,83,78)`** | **none** | gradient |
| +16ms | **false** | **`rgb(87,83,78)`** | **none** | gradient |
| +50ms | false | `rgb(164,162,159)` | glow | gradient |
| +100ms | false | `rgb(242,241,241)` | glow | gradient |
| +150ms | false | `rgb(255,255,255)` | glow | gradient |

The +0ms and +16ms rows are **exactly** the reported symptom: `disabled === false`, `color: rgb(87,83,78)`, no glow, gradient present. Any probe that reads the style within ~1–2 frames of the state change reproduces it perfectly. That also explains why it reproduced against git HEAD — the artifact is a property of the transition, not of the disabled skin, so it appears in any working tree where the button was recently enabled (and, at HEAD, `opacity-40` interpolating back to `1` produces the same class of transient).

**Ruled out, explicitly, as requested:**

- **`@media` / `@supports` nesting.** I enumerated every CSS rule in every stylesheet that matches this element and touches `color` / `background*` / `box-shadow` / the Tailwind shadow and gradient custom properties, recursing into conditional groups. **Zero matches came from inside any `@media` or `@supports` block.** Every relevant rule is top-level.
- **The `!py-4 !text-lg !rounded-2xl` important modifiers.** These emit `!important` on exactly three declarations — measured `padding: 16px 0px`, `fontSize: 18px`, `borderRadius: 16px`. None of them touches `color`, `box-shadow`, or any background property, so they cannot be involved.
- **A specificity accident.** `.text-white` is `(0,1,0)`. `.disabled\:text-zinc-400:disabled` is `(0,2,0)` — one class plus one pseudo-class. The disabled rule therefore wins *only while `:disabled` matches* and loses the moment it does not. Same arithmetic for `.disabled\:shadow-none:disabled` vs the arbitrary shadow utility. This is the intended cascade, working correctly.

**Severity: none. No fix needed, and I would not change anything.** The 150ms grey→white fade is real and is painted — a player who types the fourth character does briefly see the label warm up as the button comes alive — but it is a sub-perceptual 150ms crossfade that reads as polish, not as a glitch. The only thing worth taking away is a testing note: **assert the settled state before measuring a transitioned element** (wait >150ms, or read `getComputedStyle` after a `transitionend`), otherwise `transition-all` will hand back the previous state's values with the new `disabled` flag.

## Verdict

Both fixes land. The disabled CTA is now honest, the staff target is compliant without becoming loud, and the two-entry shelf reads as its own zone. The reported grey-CTA is a probe timing artifact, not a bug. Nothing on the GOOD list regressed: `after2-join-pixel7-he-fold.png` shows the filled state intact, the how-it-works trio intact, the toggle row clear of the icon, and the page still an exact 839/839 fit on Pixel 7.

Remaining open items are all optional and previously logged: `oneDeviceNote` still sits between the field and the CTA (S4 rec 1); the shelf uses two bold+underlined styles; the letter-spaced code is still ~half a letter-space left of optical centre (S8); and Pixel 7 has zero vertical slack, so the demo block will reintroduce overflow when a backend is present.
