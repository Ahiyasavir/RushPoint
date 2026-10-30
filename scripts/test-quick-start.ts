// The instant first build (change: first-visit-instant-build).
import assert from 'node:assert/strict';
import { readStartOccasion, quickGameTitle, wantsMissionFeed, MISSION_FEED_NAV_STATE } from '../apps/creator-web/src/lib/quickStart';
import {
  initialSmartBuildState, smartBuildReducer, currentSmartBuildQuestion, isSmartBuildComplete,
  smartBuildProgress, smartBuildAnswers, hasLeftSmartBuild, SMART_BUILD_QUESTION_ORDER, SMART_BUILD_WHO,
  SMART_BUILD_DURATIONS, SMART_BUILD_AREAS, SMART_BUILD_OCCASIONS,
} from '../apps/creator-web/src/lib/smartBuildWizard';
import { composeGame, seededRng } from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';

// Only a known occasion from the site counts.
assert.equal(readStartOccasion('?start=game&occasion=birthday'), 'birthday');
assert.equal(readStartOccasion('?start=game&occasion=other'), 'other');
assert.equal(readStartOccasion('?start=game&occasion=nope'), null);
assert.equal(readStartOccasion('?occasion=birthday'), null, 'without start=game it is not an instruction');
assert.equal(readStartOccasion('?start=game'), null);
assert.equal(readStartOccasion(null), null);

// Three questions when the front page already asked, four when it did not.
const asked = initialSmartBuildState({ quick: true, occasion: 'birthday' });
assert.equal(currentSmartBuildQuestion(asked), 'who');
assert.equal(asked.answers.occasion, 'birthday');
assert.equal(smartBuildProgress(asked).total, 3);
const notAsked = initialSmartBuildState({ quick: true });
assert.equal(currentSmartBuildQuestion(notAsked), 'occasion');
assert.equal(smartBuildProgress(notAsked).total, 4);

// The questionnaire ends after the last QUICK question, and back still leaves through the top.
let s = asked;
for (const q of ['who', 'duration', 'areas']) {
  assert.equal(currentSmartBuildQuestion(s), q);
  assert.equal(isSmartBuildComplete(s), false);
  s = smartBuildReducer(s, { type: 'next' });
}
assert.equal(isSmartBuildComplete(s), true);
assert.equal(hasLeftSmartBuild(smartBuildReducer(asked, { type: 'back' })), true);

// The long questionnaire is untouched.
assert.equal(smartBuildProgress(initialSmartBuildState()).total, SMART_BUILD_QUESTION_ORDER.length);

// Asks for nothing the creator did not offer: no prep, no pins.
assert.equal(smartBuildAnswers(asked).prepEffort, 1);
assert.equal(smartBuildAnswers(asked).locationMissions, false);

// Every path of one tap per question must end in a game.
const copy = new Proxy({}, { get: () => (() => 'x') }) as never;
let composed = 0;
for (const occasion of SMART_BUILD_OCCASIONS) {
  for (const who of SMART_BUILD_WHO) {
    for (const minutes of SMART_BUILD_DURATIONS) {
      for (const area of SMART_BUILD_AREAS) {
        let st = initialSmartBuildState({ quick: true, occasion });
        st = smartBuildReducer(st, { type: 'setAnswer', key: 'who', value: who.id });
        st = smartBuildReducer(st, { type: 'setAnswer', key: 'minutes', value: minutes });
        st = smartBuildReducer(st, { type: 'toggleArea', area });
        const r = composeGame(TASK_BANK, smartBuildAnswers(st), copy, seededRng(7));
        assert.ok(r && r.stages.length > 0 && r.stages.every((x) => x.tasks.length > 0), `${occasion}/${who.id}/${minutes}/${area}`);
        composed++;
      }
    }
  }
}
assert.ok(composed > 100, 'the sweep really ran');

// A blank name reads like a game, never like an error.
const titles = { birthday: 'B', other: 'O' } as Record<string, string>;
assert.equal(quickGameTitle('', 'birthday', titles, 'U'), 'B');
assert.equal(quickGameTitle('  ', 'nope', titles, 'U'), 'O');
assert.equal(quickGameTitle('שלי', 'birthday', titles, 'U'), 'שלי');
assert.equal(quickGameTitle('', 'birthday', {}, 'U'), 'U');

assert.equal(wantsMissionFeed(MISSION_FEED_NAV_STATE), true);
assert.equal(wantsMissionFeed({ rpOpenSetup: true }), false, 'a resumed walk does not replay the feed');
assert.equal(wantsMissionFeed(null), false);
console.log(`test-quick-start: passed, ${composed} answer paths composed`);
