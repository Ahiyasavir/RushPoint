// Presentation-field normalizers for the Builder (change: surface-invisible-fields).
//
// `coverImage` and `branding` were both fully rendered downstream and completely
// unauthorable: the promo hero reads game.coverImage, and branding.primaryColor is the
// accent of five participant screens while branding.name overrides the displayed game
// name in four more. The only way to get either was importing a game file.
//
// These are pure TOTAL functions: junk input returns `undefined`, never throws and
// never propagates a half-typed value into a persisted document.
import type { GameBranding } from '@rushpoint/shared';

/**
 * Accept a URL only over https, mirroring the rule the game-intro primer already
 * applies to its image. Anything else — http, javascript:, data:, scheme-less,
 * unparseable, blank — is "unset", so a creator who pastes half a URL gets no cover
 * image rather than a broken hero on the public promo page.
 */
export function normalizeHttpsUrl(raw: string | undefined | null): string | undefined {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/** #rgb / #rrggbb, case-insensitive. */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Normalize a brand accent to a lowercase six-digit hex literal.
 *
 * The accent is interpolated into `style` on five participant screens, so it is
 * constrained to a hex literal at the point of authorship — a colour, and only a
 * colour, reaches the render. Named CSS colours are rejected deliberately: accepting
 * them would mean the stored value is no longer a single normalized shape.
 */
export function normalizeBrandColor(raw: string | undefined | null): string | undefined {
  const trimmed = (raw ?? '').trim();
  if (!HEX_COLOR.test(trimmed)) return undefined;
  const hex = trimmed.slice(1).toLowerCase();
  return hex.length === 3
    ? `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
    : `#${hex}`;
}

/**
 * Does this branding object carry anything worth persisting?
 *
 * The participant screens resolve the displayed name as `branding?.name ?? title`, so
 * persisting `{ name: '' }` would render an EMPTY game name everywhere — a cleared
 * brand section must become `undefined`, not an object of empty strings.
 */
export function hasBrandingValue(branding: GameBranding | undefined | null): boolean {
  if (!branding) return false;
  return [branding.name, branding.primaryColor, branding.logoUrl]
    .some((v) => typeof v === 'string' && v.trim().length > 0);
}
