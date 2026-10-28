// The setup walk's phone swipe (28.10): pinned so a swipe can never fight the screen's own scroll,
// the map or a field. See apps/creator-web/src/lib/setupSwipe.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { swipeVerdict, swipePull, SWIPE_PULL_MAX, NO_SWIPE_SELECTOR, typingNow } from '../apps/creator-web/src/lib/setupSwipe';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`);
  if (!cond) failures++;
}
const base = { dx: 0, dy: 140, ms: 250, atTopAtStart: true, atBottomAtStart: true };

ok('a quick swipe up on a screen that fits goes on', swipeVerdict(base) === 'next');
ok('a quick swipe down on a screen that fits goes back', swipeVerdict({ ...base, dy: -140 }) === 'back');
ok('a swipe up while the screen still has more below only scrolls', swipeVerdict({ ...base, atBottomAtStart: false }) === null);
ok('a swipe down while the screen is scrolled only scrolls', swipeVerdict({ ...base, dy: -140, atTopAtStart: false }) === null);
ok('a short flick does nothing', swipeVerdict({ ...base, dy: 40 }) === null);
ok('a slow drag (reading) does nothing', swipeVerdict({ ...base, ms: 2000 }) === null);
ok('a sideways swipe does nothing', swipeVerdict({ ...base, dx: 150, dy: 90 }) === null);
ok('garbage does nothing', swipeVerdict({ ...base, ms: 0 }) === null && swipeVerdict({ ...base, dy: NaN }) === null);
ok('multi-line boxes never start a swipe', NO_SWIPE_SELECTOR.includes('textarea'));
const flowSrc = readFileSync(join(process.cwd(), 'apps/creator-web/src/components/SetupFlow.tsx'), 'utf8');
ok('the map may start one only because the walk map needs two fingers to move', /<LocationStep[^/]{0,300}cooperativeGestures/.test(flowSrc));
ok('a two-finger touch is never a swipe', /e\.touches\.length !== 1/.test(flowSrc));
ok('a one-line field does start one (the fields sit where a thumb swipes)', !/(^|, )input(,|$)/.test(NO_SWIPE_SELECTOR));
ok('no swipe while typing', typingNow({ tagName: 'INPUT' } as Element) && typingNow({ tagName: 'TEXTAREA' } as Element) && !typingNow({ tagName: 'BUTTON' } as Element) && !typingNow(null));

// The screen follows the finger past its end (28.10: "the scroll looks stuck").
const pullBase = { dx: 0, dy: 100, atTopAtStart: true, atBottomAtStart: true, canGoBack: true, canGoOn: true };
ok('dragging up at the bottom moves the screen up with the finger', swipePull(pullBase) === -50);
ok('dragging down at the top moves it down', swipePull({ ...pullBase, dy: -100 }) === 50);
ok('the follow is capped', swipePull({ ...pullBase, dy: 900 }) === -SWIPE_PULL_MAX);
ok('mid-screen it does not move (the page scrolls instead)', swipePull({ ...pullBase, atBottomAtStart: false }) === 0);
ok('nothing to pull towards on the last screen or the first', swipePull({ ...pullBase, canGoOn: false }) === 0 && swipePull({ ...pullBase, dy: -100, canGoBack: false }) === 0);
ok('a sideways drag does not pull', swipePull({ ...pullBase, dx: 200 }) === 0);

const flow = readFileSync(join(process.cwd(), 'apps/creator-web/src/components/SetupFlow.tsx'), 'utf8');
ok('the walk uses swipeVerdict', flow.includes('swipeVerdict('));
ok('the walk checks NO_SWIPE_SELECTOR and typing', flow.includes('NO_SWIPE_SELECTOR') && flow.includes('typingNow(document.activeElement)'));
ok('a swipe never launches the game (only item and plan screens go on)', /swipeNext[\s\S]{0,300}beat\.kind === 'item' \|\| beat\.kind === 'plan'/.test(flow));

console.log(failures === 0 ? '\n✅ setup swipe: ALL PASS' : `\n❌ setup swipe: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
