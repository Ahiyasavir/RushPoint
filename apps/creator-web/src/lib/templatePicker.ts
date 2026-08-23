// Pure ordering/language-resolution logic for the Dashboard's template picker
// (change: admin-manage-game-templates). Extracted out of DashboardPage.tsx so it
// is testable without rendering the component — see
// scripts/test-template-picker-order.ts.
//
// "Blank" itself is NOT modeled here: it stays a hardcoded, always-first,
// client-side special case in DashboardPage.tsx (per design decision — it is not
// a real admin-editable template). This module only orders/resolves the
// Firestore-backed templates that come AFTER it.
import type { TemplateGroupEntry, TemplateVariant } from '../services/calls';

export interface ResolvedTemplate {
  groupKey: string;
  templateEmoji?: string;
  variant: TemplateVariant;
}

/**
 * Which language variant of a template group to show a creator using the app in
 * `currentLang`: their own language if the admin has authored it, else the
 * Hebrew original (every template has at least an 'he' variant in practice,
 * since that is the app's default authoring language), else whatever exists —
 * a template a creator can't read in their language is still better than one
 * they can't see at all.
 */
export function resolveTemplateVariant(
  group: Pick<TemplateGroupEntry, 'variants'>,
  currentLang: string,
): TemplateVariant | undefined {
  if (group.variants[currentLang]) return group.variants[currentLang];
  if (group.variants.he) return group.variants.he;
  const keys = Object.keys(group.variants).sort();
  return keys.length > 0 ? group.variants[keys[0]] : undefined;
}

/**
 * Template groups sorted by `templateOrder` (undefined last, ties broken by
 * title for determinism), each resolved to the one variant to render for
 * `currentLang`. A group somehow left with no variants at all is dropped
 * (defensive — every group is constructed server-side with at least one).
 */
interface Resolving extends ResolvedTemplate {
  templateOrder?: number;
}

export function orderTemplatesForPicker(
  groups: readonly TemplateGroupEntry[],
  currentLang: string,
): ResolvedTemplate[] {
  const resolved: Resolving[] = [];
  for (const g of groups) {
    const variant = resolveTemplateVariant(g, currentLang);
    if (variant) resolved.push({ groupKey: g.groupKey, templateEmoji: g.templateEmoji, templateOrder: g.templateOrder, variant });
  }
  resolved.sort((a, b) => {
    const orderDiff = (a.templateOrder ?? Infinity) - (b.templateOrder ?? Infinity);
    if (orderDiff !== 0) return orderDiff;
    return a.variant.title.localeCompare(b.variant.title);
  });
  return resolved.map(({ groupKey, templateEmoji, variant }) => ({ groupKey, templateEmoji, variant }));
}
