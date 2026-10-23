// A mission whose puzzle IS finding the place must not show the place (found 23.10).
//
// "Go to the place in the picture", the emoji riddle and "where was this photo taken" carried a
// visible pin, so the players' map solved each of them: walk to the pin, done. The working ones
// (satellite-x, kid-drawing, hand-drawn-map) were hidden, with a clue pointing at the picture, because
// a sealed hidden mission shows its team only the clue and the media until they arrive.
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { pickLanguage } from '../apps/creator-web/src/lib/setupFlow';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`);
}

/** The text sends the team to a place it must work out: from a picture, a drawing, a riddle or an X. */
const FIND_THE_PLACE = /תלכו למקום ש|תגיעו לנקודה המדויקת שממנה|תגיעו ל ?X|צייר את המקום שאליו|תנווטו למקום ש|הגיעו לנקודה הזאת בלי/;

console.log('\nnavigation puzzles hide their place');
const puzzles = TASK_BANK.map((e) => ({ key: e.key, t: e.build(), clueCard: (e.setup ?? []).some((s) => s.field === 'locationClue' && s.required === true) })).filter((x) => FIND_THE_PLACE.test(pickLanguage(x.t.description, 'he')));
ok(`the bank has navigation puzzles to check (${puzzles.length})`, puzzles.length >= 6, puzzles.map((x) => x.key));
const visible = puzzles.filter((x) => x.t.hideLocation !== true).map((x) => x.key);
ok('every one of them is hidden', visible.length === 0, visible);
// Either the bank writes the clue, or a REQUIRED setup card makes the creator write it.
const noClue = puzzles.filter((x) => !(x.t.locationClue ?? '').trim() && !x.clueCard).map((x) => x.key);
ok('every one of them gives its team a clue before arrival', noClue.length === 0, noClue);
const riddleInText = puzzles.filter((x) => /\[הוראות ליוצר/.test(x.t.description ?? '')).map((x) => x.key);
ok('no puzzle keeps its riddle in the description, which a sealed mission never shows', riddleInText.length === 0, riddleInText);
// What a sealed mission shows is the clue and the media, never the description: a riddle whose
// riddle sits only in the description would show its team nothing to solve.
const emoji = TASK_BANK.find((e) => e.key === 'youth-emoji-riddle')?.build();
ok('the emoji line is asked for in the clue, where the team can see it', !!emoji && /\[הוראות ליוצר/.test(emoji.locationClue ?? '') && !/\[הוראות ליוצר/.test(emoji.description ?? ''), emoji?.locationClue);

console.log(failures === 0 ? '\n✅ navigation hidden: ALL PASS' : `\n❌ navigation hidden: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
