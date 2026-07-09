# Proposal — White-label Pro tier

## Why

Professional operators (tour companies, event agencies) want the experience to feel like *their*
product, not RushPoint's. A white-label option — remove the RushPoint branding, add their own logo —
is a classic upsell that justifies a higher tier and lands the most valuable, highest-retention
customers. It also makes RushPoint's own virality a *paid feature to turn off*, which is healthy.

## What Changes

> Observable behavior. A new entitlement flag gates branding visibility across share surfaces.

- A **white-label entitlement** (above standard Pro) lets a creator set their own brand (logo +
  name) and **suppress the "Powered by RushPoint" footer**, the share-card wordmark, and the recap
  branding for their runs.
- The participant finish footer, story cards, recap collage, and podium share **respect the
  entitlement**: white-label runs show the creator's brand; non-white-label runs keep RushPoint's.
- The entitlement is **server-validated** (read from the wallet/plan), never a client toggle —
  removing RushPoint branding requires an active white-label subscription.

## Capabilities

### New Capabilities
- `white-label-pro`: a server-validated white-label entitlement that replaces RushPoint branding on a
  creator's run share surfaces with the creator's own brand.

### Modified Capabilities
<!-- The share-branding stamp and the finish footer read the entitlement to decide whose brand to show. -->

## Surfaces touched

- **shared types:** extend the plan/entitlement model with a `whiteLabel` flag + `brand` (logo URL,
  name); pure `resolveRunBrand(entitlement, gameBranding)` helper (whose brand + whether to show the
  RushPoint footer).
- **Billing:** the white-label entitlement is granted via the existing Pro/credit billing path
  (`subscribePro` extended or a new SKU); `launchRun` seals the entitlement onto the run.
- **play-web:** finish footer, `storyCard`/recap/podium share read `resolveRunBrand`. **creator-web:**
  a white-label settings panel (logo + name), Pro-gated.
- **Tests:** `scripts/test-run-brand.ts` (brand-resolution truth table); e2e (entitlement sealed at launch).

## Non-goals

- No custom domain hosting (branding only, not a vanity URL).
- No removal of legal/ToS attribution required for compliance.
- No white-label of the creator console chrome itself (run-facing surfaces only).
