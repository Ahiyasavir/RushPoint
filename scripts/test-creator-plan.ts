// The community plan's arithmetic, and that every door out of an account is gated (change: community-plan).
import { readFileSync } from 'node:fs';
import {
  COMMUNITY_PEOPLE, COMMUNITY_RUNS, COMMUNITY_TEAMS, launchMoment, planAllowsLaunch, planContactUrl,
  planRunLimits, resolveCreatorPlan, runHasRoomForPeople,
} from '../packages/shared/src/creatorPlan';

let failed = 0;
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failed++;
};
const src = (p: string) => readFileSync(p, 'utf8');

ok(COMMUNITY_RUNS === 3 && COMMUNITY_TEAMS === 3 && COMMUNITY_PEOPLE === 15, 'the plan is 3 launches, 3 teams, 15 people');

const fresh = resolveCreatorPlan(undefined);
ok(fresh.plan === 'community' && fresh.runsLeft === 3, 'an account with no document starts with 3 launches');
ok(!fresh.canMoveGames, 'a community game stays in its account');
ok(resolveCreatorPlan({ runsUsed: 'x', extraRuns: -4 }).runsLeft === 3, 'a malformed document reads as the default');
ok(resolveCreatorPlan({ plan: 'gold' }).plan === 'community', 'an unknown plan is community, not unlimited');
ok(resolveCreatorPlan({ runsUsed: 9 }).runsLeft === 0, 'launches left never go below zero');
ok(resolveCreatorPlan({ runsUsed: 3, extraRuns: 2 }).runsLeft === 2, 'opened launches add up');
ok(!planAllowsLaunch(resolveCreatorPlan({ runsUsed: 3 })), 'the fourth launch is refused');
ok(planAllowsLaunch(resolveCreatorPlan({ runsUsed: 2 })), 'the third launch is allowed');

const owner = resolveCreatorPlan({ runsUsed: 50 }, { admin: true });
ok(owner.plan === 'unlimited' && planAllowsLaunch(owner) && owner.canMoveGames, 'the admin has no limits, whatever is stored');
ok(planRunLimits(owner, 'team') === null, 'an unlimited run stamps no limit');
const opened = resolveCreatorPlan({ plan: 'unlimited' });
ok(opened.canMoveGames && planAllowsLaunch(opened), 'an account he opened has no limits');
ok(resolveCreatorPlan(undefined, { defaultPlan: 'unlimited' }).plan === 'unlimited', 'the default plan is the caller\'s to set');
ok(resolveCreatorPlan({ plan: 'community' }, { defaultPlan: 'unlimited' }).plan === 'community', 'a stored plan beats the default');

ok(planRunLimits(fresh, 'team')?.maxParticipants === 3, 'a team game holds 3 teams');
ok(planRunLimits(fresh, 'individual')?.maxParticipants === 15, 'an individual game holds 15 people, each one a team');
ok(planRunLimits(fresh, 'team')?.maxPeople === 15, 'a team game holds 15 people in all');

ok(runHasRoomForPeople({}, 40), 'a run with no limit has room');
ok(runHasRoomForPeople({ maxPeople: 15, peopleCount: 10 }, 5), 'exactly 15 fit');
ok(!runHasRoomForPeople({ maxPeople: 15, peopleCount: 11 }, 5), 'a team that would make 16 does not');
ok(!runHasRoomForPeople({ maxPeople: 15, peopleCount: 15 }, 0), 'a nameless team still counts as one person');

const first = launchMoment(fresh);
ok(first?.launchNumber === 1 && first.leftAfter === 2 && !first.last, 'the first launch leaves 2');
const lastOne = launchMoment(resolveCreatorPlan({ runsUsed: 2 }));
ok(lastOne?.launchNumber === 3 && lastOne.last, 'the third launch is the last');
ok(launchMoment(resolveCreatorPlan({ runsUsed: 3 })) === null, 'no launch, no moment');
ok(launchMoment(owner) === null, 'the admin is never interrupted');

const url = planContactUrl('שלום עולם');
ok(url.startsWith('https://wa.me/972559641404?text='), 'the link opens a chat with his number');
ok(url.includes(encodeURIComponent('שלום')), 'the message is encoded into the link');

// Every door out of an account, and every way in.
const games = src('functions/src/games/index.ts');
const share = src('functions/src/games/share.ts');
const runs = src('functions/src/runs/index.ts');
ok(/assertCanMoveGames\(uid, [^,]+, 'publish'\)/.test(games), 'publishing is gated');
ok(/assertCanMoveGames\(uid, [^,]+, 'export'\)/.test(games), 'the game file is gated');
ok(/assertCanMoveGames\(uid, [^,]+, 'import'\)/.test(games), 'importing a file is gated');
ok(share.includes('ownerMayShareGames'), 'copy and launch through a link check the OWNER\'s plan');
ok(share.slice(share.indexOf('async function loadUsableLink')).slice(0, 900).includes('ownerMayShareGames'), 'the check sits in the one function every link door passes');
ok(runs.includes('planRunLimits('), 'a run stamps the plan\'s limits');
ok(runs.includes('assertCanLaunch('), 'a prepared run is refused early, not on the morning');
ok(runs.includes('runHasRoomForPeople('), 'joining checks the head count');

process.exit(failed ? 1 : 0);
