// score.mjs — product-first weighted task ranking.
// Priority order (by weight): User value > Admin value > Event-day reliability > Product risk > Cleanup.
// Cleanup work scores low by construction and is only chosen when it unblocks product work or fixes
// failing validation (the selector enforces that exception).

const DIM_LABELS = {
  userImpact: 'improves the player experience',
  adminImpact: 'improves organizer / control-room tooling',
  reliability: 'increases event-day reliability',
  productRisk: 'de-risks the product / event',
  cleanupValue: 'code / docs cleanup'
};

function clamp(n) { return Math.max(0, Math.min(5, Number(n) || 0)); }

export function scoreTask(task, config) {
  const w = config.scoring.weights;
  const d = task.dims || {};
  const contrib = {
    userImpact: w.userImpact * clamp(d.userImpact),
    adminImpact: w.adminImpact * clamp(d.adminImpact),
    reliability: w.reliability * clamp(d.reliability),
    productRisk: w.productRisk * clamp(d.productRisk),
    cleanupValue: w.cleanupValue * clamp(d.cleanupValue)
  };
  // Category-priority bonus: smart stations > builder/admin tools > player flow > social > reliability.
  const catBonus = (config.scoring.categoryBonus || {})[task.goal] || 0;
  const total = Object.values(contrib).reduce((a, b) => a + b, 0) + catBonus;
  // One-line reason = the dimension contributing the most weighted points.
  const top = Object.entries(contrib).sort((a, b) => b[1] - a[1])[0][0];
  const dims = `U${clamp(d.userImpact)} A${clamp(d.adminImpact)} R${clamp(d.reliability)} P${clamp(d.productRisk)} C${clamp(d.cleanupValue)}`;
  return { total, contrib, reason: `${DIM_LABELS[top]} (${dims})` };
}

// A task is "cleanup" when its only real value is tidiness (cleanup dominates and there is no
// meaningful user/admin/reliability value).
export function isCleanup(task) {
  const d = task.dims || {};
  const product = Math.max(clamp(d.userImpact), clamp(d.adminImpact), clamp(d.reliability), clamp(d.productRisk));
  return clamp(d.cleanupValue) >= product && product <= 1;
}

export function isProduct(task) {
  return !isCleanup(task);
}

// Rank backlog by total score; tie-break toward the better player/organizer experience, then lower effort.
export function rankBacklog(tasks, config) {
  return tasks
    .map((t) => ({ task: t, ...scoreTask(t, config), cleanup: isCleanup(t) }))
    .sort((a, b) =>
      b.total - a.total ||
      clamp(b.task.dims?.userImpact) - clamp(a.task.dims?.userImpact) ||
      clamp(b.task.dims?.adminImpact) - clamp(a.task.dims?.adminImpact) ||
      (a.task.effort ?? 3) - (b.task.effort ?? 3)
    );
}

export function productShare(tasks) {
  if (!tasks.length) return 0;
  return tasks.filter(isProduct).length / tasks.length;
}
