// White-label Pro (change: white-label-pro). The single source of truth for which
// brand a run's share surfaces (finish footer, story card, recap collage, podium)
// display, and whether the "Powered by RushPoint" footer shows. The decision is
// made here — never from a client flag — so a white-label entitlement can't be
// faked. Pure; no Firestore, no DOM.

/** The white-label entitlement sealed onto a run (or read from the owner wallet). */
export interface WhiteLabelEntitlement {
  whiteLabel?: boolean;
  brand?: { name?: string; logoUrl?: string } | null;
}

/** What share surfaces should render. */
export interface ResolvedRunBrand {
  whiteLabel: boolean;        // true only when fully white-labeled (entitlement + brand name)
  wordmark: string;          // brand name to stamp (creator brand or "RushPoint")
  logoUrl?: string;          // brand logo when white-labeled
  showRushpointFooter: boolean; // whether to show the "Powered by RushPoint" upsell
}

const RUSHPOINT = 'RushPoint';

/**
 * Resolve the brand for a run's share surfaces. A run is white-labeled only when
 * it carries the entitlement AND a non-empty brand name — otherwise it falls back
 * cleanly to RushPoint branding with the footer (no half-branded state).
 */
export function resolveRunBrand(
  entitlement: WhiteLabelEntitlement | null | undefined,
  gameBranding?: { name?: string } | null,
): ResolvedRunBrand {
  const brandName = entitlement?.brand?.name?.trim();
  const isWhiteLabel = !!entitlement?.whiteLabel && !!brandName;

  if (isWhiteLabel) {
    return {
      whiteLabel: true,
      wordmark: brandName!,
      logoUrl: entitlement!.brand!.logoUrl || undefined,
      showRushpointFooter: false,
    };
  }

  return {
    whiteLabel: false,
    wordmark: gameBranding?.name?.trim() || RUSHPOINT,
    logoUrl: undefined,
    showRushpointFooter: true,
  };
}
