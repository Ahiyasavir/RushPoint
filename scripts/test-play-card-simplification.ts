// Pure-logic tests for the player-screen simplification (change: play-card-simplification).
//
// Three decisions were pulled out of PlayScreen/TaskRunner so they could be
// reasoned about — and tested — without a DOM:
//
//   1. selectMissionNotice   — ONE status line, not four stacked boxes.
//   2. planMissionActions    — one primary action; recovery behind an overflow.
//   3. planMoreDrawer        — six always-mounted panels become one tabbed drawer.
//
// The load-bearing property in all three is that nothing a player NEEDS can be
// hidden: a blocking cooldown always wins the notice slot, a lone secondary
// action never gets buried in a menu, and a drawer tab never appears for a
// feature that has nothing in it (which would re-create the empty-section
// clutter the drawer exists to remove).
//
// No emulator, no DOM.
//   npx tsx scripts/test-play-card-simplification.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnswerCostDisplay } from '../packages/shared/src/wrongAnswerPenalty';
import { selectMissionNotice } from '../apps/play-web/src/lib/missionNotice';
import { planMissionActions, type MissionActionId } from '../apps/play-web/src/lib/missionActions';
import { planMoreDrawer, type DrawerTabId } from '../apps/play-web/src/lib/moreDrawer';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const cost = (over: Partial<AnswerCostDisplay> = {}): AnswerCostDisplay => ({
  level: 'points', freeAttemptsLeft: 0, nextPoints: 0, nextCooldownSeconds: 0, ...over,
} as AnswerCostDisplay);

// ── selectMissionNotice ──────────────────────────────────────────────────────
console.log('\n── selectMissionNotice ──');

check('nothing to say yields no banner', selectMissionNotice({}) === null);
check('a null input does not throw', selectMissionNotice(null) === null);
check('an undefined input does not throw', selectMissionNotice(undefined) === null);

check('only a paused clock yields the paused banner',
  selectMissionNotice({ pausesTimer: true })?.kind === 'paused');

check('free tries read as GOOD news, not a warning',
  selectMissionNotice({ answerCost: cost({ freeAttemptsLeft: 2 }) })?.tone === 'good');

const pts = selectMissionNotice({ answerCost: cost({ nextPoints: 25, nextCooldownSeconds: 30 }) });
check('a points cost wins over its own seconds', pts?.kind === 'cost' && pts.points === 25, JSON.stringify(pts));

check('a time_only run (0 points) falls back to the seconds wording',
  selectMissionNotice({ answerCost: cost({ nextCooldownSeconds: 45 }) })?.kind === 'costTime');

check('a cost object with nothing at stake renders nothing',
  selectMissionNotice({ answerCost: cost() }) === null);

check('…but still lets a paused clock through',
  selectMissionNotice({ answerCost: cost(), pausesTimer: true })?.kind === 'paused');

// THE priority property: a blocking lockout must never be hidden behind anything.
const blocked = selectMissionNotice({
  cooldownLeft: 12,
  answerCost: cost({ freeAttemptsLeft: 3, nextPoints: 50, nextCooldownSeconds: 60 }),
  pausesTimer: true,
});
check('a live cooldown outranks EVERY other status',
  blocked?.kind === 'cooldown' && blocked.seconds === 12, JSON.stringify(blocked));

check('free tries outrank the paused clock (a rule beats a courtesy)',
  selectMissionNotice({ answerCost: cost({ freeAttemptsLeft: 1 }), pausesTimer: true })?.kind === 'freeTries');

check('a zero cooldown is not a lockout',
  selectMissionNotice({ cooldownLeft: 0, pausesTimer: true })?.kind === 'paused');
check('a negative cooldown is not a lockout',
  selectMissionNotice({ cooldownLeft: -5, pausesTimer: true })?.kind === 'paused');
check('a NaN cooldown is not a lockout',
  selectMissionNotice({ cooldownLeft: Number.NaN, pausesTimer: true })?.kind === 'paused');

// Interpolated values must never be NaN — they go straight into player-facing copy.
const junk = selectMissionNotice({
  answerCost: cost({ freeAttemptsLeft: Number.NaN as unknown as number, nextPoints: Number.POSITIVE_INFINITY, nextCooldownSeconds: 20 }),
});
check('a non-finite cost never leaks NaN into the copy',
  junk === null || Object.values(junk).every((v) => typeof v !== 'number' || Number.isFinite(v)),
  JSON.stringify(junk));

// ── planMissionActions ───────────────────────────────────────────────────────
console.log('\n── planMissionActions ──');

check('no actions available yields no menu',
  planMissionActions({}).overflow.length === 0 && !planMissionActions({}).showMenu);

const one = planMissionActions({ hasLocation: true });
check('ONE action renders inline, never as a one-item menu',
  one.showMenu === false && one.soleAction === 'navigate', JSON.stringify(one));

const two = planMissionActions({ hasLocation: true, hasHint: true });
check('two actions become a menu', two.showMenu === true && two.soleAction === null, JSON.stringify(two));

const all = planMissionActions({ hasLocation: true, hasHint: true, canRequestHelp: true });
check('the order is navigate → hint → help',
  JSON.stringify(all.overflow) === JSON.stringify(['navigate', 'hint', 'help']), JSON.stringify(all.overflow));

// A FREE hint is escalated by the server precisely so a stuck team takes it —
// hiding it in a menu would defeat the escalation.
check('a FREE hint stays inline, never in the overflow',
  !planMissionActions({ hasHint: true, hintFree: true, hasLocation: true }).overflow.includes('hint'));
check('a PAID hint does go to the overflow',
  planMissionActions({ hasHint: true, hasLocation: true }).overflow.includes('hint'));

check('an already-sent help request is a receipt, not a repeatable action',
  !planMissionActions({ hasLocation: true, canRequestHelp: true, helpSent: true }).overflow.includes('help'));

// A viewer's controls are inert — offering them would be a lie.
check('a read-only viewer is offered nothing',
  planMissionActions({ hasLocation: true, hasHint: true, canRequestHelp: true, readOnly: true }).overflow.length === 0);

check('showMenu and soleAction are never both set',
  [one, two, all].every((p) => !(p.showMenu && p.soleAction !== null)));

check('soleAction is always inside overflow when set',
  [one, two, all].every((p) => p.soleAction === null || p.overflow.includes(p.soleAction)));

// ── planMoreDrawer ───────────────────────────────────────────────────────────
console.log('\n── planMoreDrawer ──');

const none = planMoreDrawer({});
check('no features means NO drawer at all', none.empty === true && none.defaultTab === null);
check('a null input does not throw', planMoreDrawer(null).empty === true);

// The regression this design exists to avoid: an empty feature must not become a
// permanently-visible empty tab.
check('zero trackables produce no trackables tab',
  !planMoreDrawer({ trackableCount: 0, hasBoard: true }).tabs.some((t) => t.id === 'trackables'));
check('zero zones produce no zones tab',
  !planMoreDrawer({ zoneCount: 0, hasBoard: true }).tabs.some((t) => t.id === 'zones'));
check('a solo team gets no devices tab',
  !planMoreDrawer({ hasTeammateDevices: false, hasBoard: true }).tabs.some((t) => t.id === 'devices'));

const full = planMoreDrawer({
  hasBoard: true, hasFeed: true, hasChat: true,
  trackableCount: 2, zoneCount: 3, hasTeammateDevices: true,
});
check('every feature in play yields all six tabs, in order',
  JSON.stringify(full.tabs.map((t) => t.id))
    === JSON.stringify(['board', 'feed', 'chat', 'trackables', 'zones', 'devices'] as DrawerTabId[]),
  JSON.stringify(full.tabs.map((t) => t.id)));

check('with nothing waiting, the first tab opens', full.defaultTab === 'board');

const unread = planMoreDrawer({ hasBoard: true, hasChat: true, unreadChat: 3 });
check('unread chat opens the CHAT tab, not the first one', unread.defaultTab === 'chat', JSON.stringify(unread));
check('the unread count rides on the tab', unread.tabs.find((t) => t.id === 'chat')?.badge === 3);
check('the closed drawer carries the total badge', unread.totalBadge === 3);

check('an unread count with no chat tab cannot strand the badge',
  planMoreDrawer({ hasBoard: true, unreadChat: 5 }).totalBadge === 0);

check('a negative unread count is not a badge',
  planMoreDrawer({ hasBoard: true, hasChat: true, unreadChat: -2 }).totalBadge === 0);
check('a NaN unread count is not a badge',
  planMoreDrawer({ hasBoard: true, hasChat: true, unreadChat: Number.NaN }).totalBadge === 0);

check('defaultTab is always one of the returned tabs',
  [none, full, unread].every((p) => p.defaultTab === null || p.tabs.some((t) => t.id === p.defaultTab)));

// ── totality sweep ───────────────────────────────────────────────────────────
console.log('\n── totality ──');
let threw = '';
const junkValues = [undefined, null, Number.NaN, Infinity, -1, 0, 1, 'x', {}, []] as unknown[];
for (const v of junkValues) {
  try {
    selectMissionNotice({ pausesTimer: v as boolean, cooldownLeft: v as number, answerCost: v as AnswerCostDisplay });
    planMissionActions({ hasLocation: v as boolean, hasHint: v as boolean, canRequestHelp: v as boolean, readOnly: v as boolean });
    planMoreDrawer({ hasBoard: v as boolean, unreadChat: v as number, trackableCount: v as number, zoneCount: v as number });
  } catch (e) {
    threw = `${JSON.stringify(v)}: ${String(e)}`;
  }
}
check('none of the three throw on junk input', threw === '', threw);

// A non-boolean truthy value must NOT enable a feature — these are strict checks
// on purpose, because the callers read straight off a server payload.
check('a truthy non-boolean does not enable a drawer tab',
  planMoreDrawer({ hasBoard: 'yes' as unknown as boolean }).empty === true);
check('a truthy non-boolean does not enable a mission action',
  planMissionActions({ hasHint: 'yes' as unknown as boolean }).overflow.length === 0);

// ── wiring guards ────────────────────────────────────────────────────────────
console.log('\n── wiring ──');
const runner = readFileSync(join(process.cwd(), 'apps/play-web/src/components/TaskRunner.tsx'), 'utf8');
check('TaskRunner uses the notice selector', /selectMissionNotice/.test(runner));
// TaskRunner reaches the planner THROUGH MissionExtras, so assert the real chain
// rather than a name that a refactor legitimately moved.
check('TaskRunner renders the consolidated overflow', /<MissionExtras/.test(runner));
const extras = readFileSync(join(process.cwd(), 'apps/play-web/src/components/MissionExtras.tsx'), 'utf8');
check('MissionExtras is driven by the action planner', /planMissionActions/.test(extras));
// The navigate link used to render as a sibling of the distance badge; it is now
// passed INTO the overflow. Assert on the structure, not on whitespace.
check('the navigate link is handed to the overflow, not rendered beside the badge',
  /navigate=\{<NavigateHereLink/.test(runner));
const play = readFileSync(join(process.cwd(), 'apps/play-web/src/screens/PlayScreen.tsx'), 'utf8');
check('PlayScreen uses the drawer planner', /planMoreDrawer/.test(play));

// ── regression: MissionExtras must remount per mission ──────────────────────
// TaskRunner itself is never remounted between missions (no key at its
// PlayScreen call site — everything there resets via effects keyed on taskId
// instead, per the existing ExpiryCountdown/OrderingEntry convention). Found
// during review: MissionExtras owns LOCAL open/closed menu state with no such
// reset, so a menu left open on one mission would still read open the instant
// the poll reassigned the next one — a stale recovery menu on a new mission the
// player never opened. `key={task.id}` forces the remount ExpiryCountdown and
// OrderingEntry already rely on for exactly this reason.
check('MissionExtras remounts per mission (key={task.id}), matching ExpiryCountdown/OrderingEntry',
  /key=\{task\.id\}\s*\n\s*hasLocation=/.test(runner));

// ── regression: chat unread must stay in sync WHILE the tab is open ─────────
// The original ChatSection kept the "seen" marker in step with EVERY arriving
// message for as long as the panel stayed open (a second effect keyed on
// `messages`), not just at the moment it was opened. Found during review: the
// first draft of useTeamChat only synced ONCE, on open — so a message arriving
// while the player was actively looking at the open chat tab would still read
// as unread on the closed drawer's badge. `viewing` must gate a `messages`-keyed
// effect, not a one-shot call from onActiveTabChange.
check('useTeamChat takes a "viewing" flag (not just a one-shot mark-seen call)',
  /function useTeamChat\(ctx: Session, teamId: string, viewing: boolean\)/.test(play));
check('the seen marker re-syncs on every arriving message while viewing (not once)',
  /useEffect\(\(\) => \{\s*\n\s*if \(!viewing \|\| !teamId \|\| unreadCount === 0\) return;/.test(play));
check('MoreDrawer reports viewing STOPPING too (null), not just which tab opened',
  /onActiveTabChange\?\.\(open \? active : null\)/.test(play));

console.log(`\n${failures === 0 ? 'ALL PLAY-CARD TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
