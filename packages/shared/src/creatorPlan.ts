// The plan a creator is on (change: community-plan). Pure and total: a missing or malformed plan
// document reads as the default, never as a throw and never as "no limits".
//
// `community` is what everyone starts on: 3 real launches, up to 3 teams and 15 people in a run, and
// the game stays in the account (no gallery, no file, no copy or launch through a share link). A test
// drive is never counted. `unlimited` is the platform admin and anyone he opens up.
//
// Launches are counted from `runsUsed`, not by counting runs, so deleting a game gives nothing back and
// everything launched before this plan existed starts from zero.

export type CreatorPlanId = 'community' | 'unlimited';

export const COMMUNITY_RUNS = 3;
export const COMMUNITY_TEAMS = 3;
export const COMMUNITY_PEOPLE = 15;

/** The number a creator writes to for more launches, as wa.me wants it. */
export const PLAN_CONTACT_PHONE = '972559641404';

export interface CreatorPlanDoc {
  plan?: unknown;
  runsUsed?: unknown;
  extraRuns?: unknown;
}

export interface CreatorPlanView {
  plan: CreatorPlanId;
  runsUsed: number;
  /** All the launches this account has: the 3 it starts with plus what was opened for it. */
  runsTotal: number;
  runsLeft: number;
  maxTeams: number | null;
  maxPeople: number | null;
  /** Gallery, game file, copy and launch through a link: anything that moves a game out of the account. */
  canMoveGames: boolean;
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function resolveCreatorPlan(
  doc: CreatorPlanDoc | null | undefined,
  opts: { admin?: boolean; defaultPlan?: CreatorPlanId } = {},
): CreatorPlanView {
  const stored = doc?.plan === 'unlimited' || doc?.plan === 'community' ? doc.plan : null;
  const plan: CreatorPlanId = opts.admin === true ? 'unlimited' : (stored ?? opts.defaultPlan ?? 'community');
  const runsUsed = count(doc?.runsUsed);
  if (plan === 'unlimited') {
    return { plan, runsUsed, runsTotal: 0, runsLeft: 0, maxTeams: null, maxPeople: null, canMoveGames: true };
  }
  const runsTotal = COMMUNITY_RUNS + count(doc?.extraRuns);
  return {
    plan, runsUsed, runsTotal, runsLeft: Math.max(0, runsTotal - runsUsed),
    maxTeams: COMMUNITY_TEAMS, maxPeople: COMMUNITY_PEOPLE, canMoveGames: false,
  };
}

/** May this account start one more real run? */
export function planAllowsLaunch(view: CreatorPlanView): boolean {
  return view.plan === 'unlimited' || view.runsLeft > 0;
}

/**
 * What a run stamps at launch. `participantCount` counts teams in a team game and people in an
 * individual one, because there a person IS a team: 3 teams would mean 3 people, which is not the promise.
 * Null when the plan sets no limit.
 */
export function planRunLimits(view: CreatorPlanView, mode: unknown): { maxParticipants: number; maxPeople: number } | null {
  if (view.maxTeams === null || view.maxPeople === null) return null;
  return { maxParticipants: mode === 'team' ? view.maxTeams : view.maxPeople, maxPeople: view.maxPeople };
}

/** Would these people push the run past its head count? A run with no limit always has room. */
export function runHasRoomForPeople(run: { maxPeople?: unknown; peopleCount?: unknown }, joining: number): boolean {
  if (typeof run.maxPeople !== 'number') return true;
  return count(run.peopleCount) + Math.max(1, count(joining)) <= run.maxPeople;
}

/** The link that opens a chat with the message already written. */
export function planContactUrl(message: string): string {
  return `https://wa.me/${PLAN_CONTACT_PHONE}?text=${encodeURIComponent(message)}`;
}

/** What the phone says before a launch: which launch this is, and what is left after it. */
export function launchMoment(view: CreatorPlanView): { launchNumber: number; leftAfter: number; last: boolean } | null {
  if (view.plan !== 'community' || view.runsLeft <= 0) return null;
  const leftAfter = view.runsLeft - 1;
  return { launchNumber: view.runsUsed + 1, leftAfter, last: leftAfter === 0 };
}
