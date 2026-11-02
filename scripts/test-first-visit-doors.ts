// Three doors found by the 1.11 deploy checks, each invisible to every other gate: a stranger starting
// a game from someone's game link, the event date reachable only inside the setup walk, and the run
// emails left on the provider's sandbox sender, which refuses every address but the account owner's.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const gate = read('apps/creator-web/src/components/AuthGate.tsx');
assert.match(gate, /onStart=\{[\s\S]{0,500}nav\('\/', \{ replace: true \}\)[\s\S]{0,80}setStartingGuest\(true\)/, 'starting a game leaves the address it arrived on');

const builder = read('apps/creator-web/src/pages/BuilderPage.tsx');
assert.match(builder, /functions\/not-found/, 'a missing game is told apart from a failed load');
assert.match(builder, /<EventDateRow /, 'the event date can be changed from the game settings');

const compose = read('docker-compose.api.yml');
assert.doesNotMatch(compose, /onboarding@resend\.dev/, 'no production mail leaves from the sandbox sender');
assert.match(compose, /RUN_SUMMARY_EMAIL_FROM: "RushPoint <hello@rush-point\.com>"/);

// His notes of 1.11: several places must be answerable, the arrow must not point at the swap button.
const wizard = read('apps/creator-web/src/components/SmartBuildWizard.tsx');
const areas = wizard.slice(wizard.indexOf("id: 'areas'"), wizard.indexOf("id: 'people'"));
assert.match(areas, /MultiChoiceCardRow/, 'the place question takes several places');
assert.doesNotMatch(areas, /autoAdvance/, 'the place question never moves on by itself');
const feed = read('apps/creator-web/src/components/MissionFeed.tsx');
assert.ok(feed.indexOf('{f.swipeHint}') > feed.indexOf('{f.swap}'), 'the scroll hint sits under the swap button, its arrow pointing away from it');

console.log('first-visit doors: 8 of 8 hold');
