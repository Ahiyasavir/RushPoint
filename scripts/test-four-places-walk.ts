// "ארבעה מקומות" in the setup walk (Ahiya, 28.10): "so little room to write four different places,
// there should be a row per place", "where do they type the correct code?", "why does this mission
// need a location at all?". Pinned here:
//   • the mission's sentence has FOUR blanks, each long enough that SentenceBoxes gives it its own
//     full-width row (SetupFlow.tsx: a hint over 22 characters is `block w-full`);
//   • the walk asks for the places, then the code, and never for a pin;
//   • the code is fresh per build, four digits, first digit not 0;
//   • the mission is built locationless, and a pin, if a creator adds one, is a loose area.
import type { Game } from '@rushpoint/shared';
import { TASK_BANK, LOOSE_PIN_RADIUS_M } from '../apps/creator-web/src/taskBank';
import { setupFlowSteps } from '../apps/creator-web/src/lib/quickSetup';
import { parseSentence, plainBlanks, asCreatorBlanks } from '../apps/creator-web/src/lib/sentenceForm';
import { stripUnsafeProseChars } from '../packages/shared/src/validation';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`);
  if (!cond) failures++;
}

const entry = TASK_BANK.find((e) => e.key === 'four-places');
ok('four-places is in the bank', !!entry);
if (entry) {
  const task = entry.build();
  const blanks = parseSentence(task.description).filter((p) => p.kind === 'slot') as { kind: 'slot'; hint: string }[];
  ok('one blank per place, four in all', blanks.length === 4, blanks.length);
  ok('every blank gets its own full-width row (hint over 22 characters)', blanks.every((b) => b.hint.length > 22), blanks.map((b) => b.hint));
  ok('each place starts on its own line in the text players read', (task.description ?? '').split('\n').length >= 5);

  ok('built without a pin', task.locationless === true && task.triggerMode === 'locationless', { l: task.locationless, t: task.triggerMode });
  ok('a pin added later is a loose area', (task.geofenceRadiusMeters ?? 0) >= LOOSE_PIN_RADIUS_M);
  ok('the walk never asks for a place', !(entry.setup ?? []).some((s) => s.field === 'coordinates'));

  const codes = new Set(Array.from({ length: 40 }, () => entry.build().numericAnswer));
  ok('the code is fresh per build', codes.size > 30, codes.size);
  ok('the code is four digits, first not 0', [...codes].every((c) => typeof c === 'number' && c >= 1000 && c <= 9999));

  const game = { id: 'g', title: 'x', scoringPreset: 'fixed_points_speed', stages: [{ id: 's1', order: 0, title: 'a', isFinal: true, tasks: [task] }] } as unknown as Game;
  const fields = setupFlowSteps(game).filter((s) => s.taskId === task.id).map((s) => s.targetFieldPath);
  ok('the walk asks for the places, then the code', fields.join() === 'description,numericAnswer', fields);
}

// The rows only survive if a save keeps the line breaks: the display-char strip used to delete LF
// from every description, so "one row per place" came back from the server as one run-on line.
{
  const kept = stripUnsafeProseChars('הראשונה: א\nהשנייה: ב\r\nהשלישית‮ג');
  ok('a saved description keeps its line breaks (CRLF becomes LF)', kept === 'הראשונה: א\nהשנייה: בהשלישיתג'.replace('בה', 'ב\nה'), kept);
  const games = readFileSync(join(process.cwd(), 'functions/src/games/index.ts'), 'utf8');
  ok('updateGame cleans a mission description as prose', /description: stripUnsafeProseChars\(task\.description\)/.test(games));
  ok('and the game description too', (games.match(/stripUnsafeProseChars\(description\)/g) ?? []).length >= 2);
}

// Editing the mission's text on the walk's card (28.10) shows each blank as a plain bracket and turns
// it back on the way in, so an edit that touches nothing must give back every blank, for every
// mission in the bank that has one.
{
  const lost: string[] = [];
  let checked = 0;
  for (const e of TASK_BANK) {
    const d = e.build().description ?? '';
    if (!parseSentence(d).some((p) => p.kind === 'slot')) continue;
    checked++;
    const shown = plainBlanks(d);
    const back = asCreatorBlanks(shown);
    const sig = (t: string) => JSON.stringify(parseSentence(t).map((p) => (p.kind === 'slot' ? `[${p.hint}]` : p.text)));
    if (shown.includes('הוראות ליוצר') || sig(back) !== sig(d)) lost.push(e.key);
  }
  ok(`editing on the card keeps every blank a blank (${checked} missions with blanks)`, checked > 10 && lost.length === 0, lost);
  const flow = readFileSync(join(process.cwd(), 'apps/creator-web/src/components/SetupFlow.tsx'), 'utf8');
  ok('the card edits through plainBlanks and asCreatorBlanks', /value=\{plainBlanks\(task\.description\)\}/.test(flow) && /asCreatorBlanks\(e\.target\.value\)/.test(flow));
}

console.log(failures === 0 ? '\n✅ four places walk: ALL PASS' : `\n❌ four places walk: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
