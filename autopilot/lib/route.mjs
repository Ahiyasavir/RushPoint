// route.mjs — decide which model the IMPLEMENTER uses for a given task.
// Policy (product-first): Sonnet ONLY for low-risk *mechanical cleanup*. Anything product-facing —
// smart stations, admin, social, scoring, matchmaking, game builder, review flows, access codes,
// reliability/recovery, or UX — stays on Opus. "Even slightly product facing → Opus."
// Selector and reviewer are always Opus (configured separately).
import { isCleanup } from './score.mjs';

export function pickImplementerModel(task, config) {
  const r = config.implementerRouting;
  const opus = config.models.implementerHigh;
  const sonnet = config.models.implementerLow;
  const text = [task.title, task.notes, task.rationale, ...(task.implementationHints || [])]
    .filter(Boolean).join(' ').toLowerCase();

  // 1) Whole categories that always require Opus (product/UX/admin/gameplay/etc.).
  if (r.alwaysOpusGoals.includes(task.goal)) {
    return { model: opus, tier: 'opus', reason: `goal "${task.goal}" is product-facing` };
  }

  // 2) Keyword triggers: product / architecture / UX / smart-stations / data-model surface.
  const hit = r.alwaysOpusKeywords.find((k) => text.includes(k));
  if (hit) {
    return { model: opus, tier: 'opus', reason: `mentions "${hit}" (product/architecture/UX-sensitive)` };
  }

  // 3) Anything that scores as product (not pure cleanup) stays on Opus, even if slightly so.
  if (!isCleanup(task)) {
    return { model: opus, tier: 'opus', reason: 'has product value (not pure cleanup) — Opus for safety' };
  }

  // 4) True low-risk mechanical cleanup → Sonnet.
  if (r.sonnetEligibleGoals.includes(task.goal) && (task.risk ?? 5) <= r.lowRiskMaxRisk) {
    return {
      model: sonnet, tier: 'sonnet',
      reason: `low-risk (${task.risk}/5) mechanical cleanup in "${task.goal}", no product surface`
    };
  }

  // 5) Default to Opus.
  return { model: opus, tier: 'opus', reason: `risk ${task.risk ?? '?'}/5 or unclassified — Opus for safety` };
}
