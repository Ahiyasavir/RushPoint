import type { Team } from '@rushpoint/shared';

const SLOT_POINT_VALUES = {
  green: 100,
  orange: 150,
  gold: 200,
};

const COMPLETION_BONUS = 500;
const SPEED_BONUS_MAX = 1000;
const SPEED_BONUS_THRESHOLD_MINUTES = 120; // top speed bonus window

/**
 * Computes the final team score:
 *   base slot points + judge basket score + speed bonus - clue penalties
 */
export function calculateScore(
  team: Team,
  judgeBasketScore: number,   // 0–100 from judge
  durationMinutes: number,
): number {
  const slotPoints = team.slots
    .filter((s) => s.status === 'completed')
    .reduce((sum, s) => sum + SLOT_POINT_VALUES[s.type], 0);

  const allCompleted = team.slots.every((s) => s.status === 'completed');
  const completionBonus = allCompleted ? COMPLETION_BONUS : 0;

  // Speed bonus: linear decay from SPEED_BONUS_MAX down to 0 over threshold window
  const speedBonus = allCompleted
    ? Math.max(0, SPEED_BONUS_MAX * (1 - durationMinutes / SPEED_BONUS_THRESHOLD_MINUTES))
    : 0;

  const basketBonus = Math.round(judgeBasketScore * 3); // 0–300 pts

  return Math.round(
    slotPoints + completionBonus + speedBonus + basketBonus - team.bonusPenalty,
  );
}
