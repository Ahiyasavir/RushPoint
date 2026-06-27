# Proposal — Universal share branding (logo + link + QR on every image)

## Why

Every image the app emits is a free billboard — but today only **one** artifact is branded, and
weakly. `apps/play-web/src/lib/storyCard.ts` draws a **text** wordmark ("RUSHPOINT") plus a CTA URL
on the finish/brag story card. Nothing else is branded: a participant who saves or shares an
individual task **photo** posts an unbranded image, and there is no machine-readable way for a viewer
to act on a shared image — they must retype a URL. The viral loop leaks at exactly the moment of
peak organic reach (a kid posting event photos to a story).

This change makes **brand + link + a scannable QR ride along on every image the app produces**, via a
single reusable watermark helper — so every share is recognizably RushPoint and one scan away from
joining or building a game.

## What Changes

> Observable behavior. No game/run/scoring logic, no Firestore writes — this is client-side image
> composition over existing share flows.

- Every shared image (the finish/brag **story card**, the new **run recap collage**
  ([`run-recap`](../run-recap/proposal.md)), and an **individual task photo** a participant chooses
  to share) carries a consistent **brand stamp**: the RushPoint **logo mark** (the actual icon, not
  just text) + the app URL, placed on the side so it never covers the subject.
- Every shared image also carries a **scannable QR** that resolves to the right destination
  (promo/join/play), so a viewer can scan-to-act instead of retyping a link.
- Participants can **share an individual task photo** from the run, watermarked, directly to their
  native share sheet / stories.
- If the logo image fails to load, the stamp **gracefully falls back** to the existing text wordmark
  so a share never fails.

## Capabilities

### New Capabilities
- `share-branding`: a reusable brand-watermark (logo + app link + scannable QR) composited onto every
  image the app shares, plus an individual-photo share path. Story cards and the run-recap collage
  consume the same helper.

### Modified Capabilities
<!-- None — introduced as a new capability; becomes the baseline at archive time. -->

## Surfaces touched

- **play-web:** `apps/play-web/src/lib/storyCard.ts` (replace ad-hoc wordmark with the shared stamp),
  new `apps/play-web/src/lib/brandWatermark.ts` (the helper + pure layout/QR-target math), new
  `apps/play-web/src/lib/sharePhoto.ts` (individual-photo share), the TaskRunner/Final/Play surfaces
  that expose a "share photo" action.
- **shared:** `packages/shared/src` — `resolveShareQrTarget()` + `computeWatermarkLayout()` pure
  helpers (testable without a DOM).
- **Tooling:** add a `qrcode` dependency (client QR generation; no server round-trip, no static asset).
- **Tests:** new `scripts/test-watermark.ts` (layout + QR-target pure logic). UI proven via preview.
- **No callable, no Firestore rules, no shared run/team types** are touched.

## Non-goals

- **No server-side image rendering / watermarking of stored photos** — branding is applied at share
  time on the client, not baked into the uploaded Storage object.
- **No `?ref=` referral injection** into share links here (the finish footer already carries it;
  out of scope for this change).
- **No animated / video montage** — still images only.
- **No change to what photos exist or how they're stored / moderated** — that's the run's existing flow.
