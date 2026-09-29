// Pure-logic tests for located-mission arrival (change: located-mission-arrival).
//
// Field report 2026-09-27 + decisions 2026-09-28: every located mission opens only when the team
// arrives; the map shows every mission (locked ones too, hidden ones only as a search circle); a
// new located mission gets a line and an arrow from the team to it.
import { arrivalGateApplies, locatedSealedStub, missionPins, bearingDeg, LOCATED_STUB_KEYS } from '../packages/shared/src/missionArrival';

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}\n      got  ${a}\n      want ${e}`);
}

const C = { lat: 31.7767, lng: 35.2345 };
const gated = { arrivalGate: true };

console.log('\n— arrivalGateApplies: a truth table —');
eq('a located radius mission in a gated run', arrivalGateApplies({ coordinates: C }, gated), true);
eq('exact trigger too', arrivalGateApplies({ coordinates: C, triggerMode: 'exact' }, gated), true);
eq('a run launched before the change keeps today', arrivalGateApplies({ coordinates: C }, {}), false);
eq('locationless never', arrivalGateApplies({ coordinates: C, locationless: true }, gated), false);
eq('instant trigger never', arrivalGateApplies({ coordinates: C, triggerMode: 'instant' }, gated), false);
eq('no coordinates never', arrivalGateApplies({}, gated), false);
eq('0,0 is an unplaced pin, never', arrivalGateApplies({ coordinates: { lat: 0, lng: 0 } }, gated), false);
eq('a hidden mission has its OWN seal, not this one', arrivalGateApplies({ coordinates: C, hideLocation: true }, gated), false);
eq('junk ⇒ false', arrivalGateApplies(null as never, null as never), false);

console.log('\n— the sealed stub carries the way there, never the mission —');
const full = {
  id: 'm1', title: 'The bell', titleHe: 'הפעמון', type: 'quiz', coordinates: C, geofenceRadiusMeters: 40,
  pointValue: 100, difficulty: 3, estimatedMinutes: 10, media: [{ kind: 'image', url: 'https://x/y.jpg' }],
  description: 'SECRET instructions', longInstructions: 'SECRET', answers: ['SECRET'], numericAnswer: 7,
  hint: 'SECRET hint', smart: { secretCode: 'SECRET', longInstructions: 'SECRET' }, steps: [{ prompt: 'p', answer: 'SECRET' }],
  choices: ['a', 'b'], orderItems: ['1', '2'], surveyChoices: ['x'], answerOutcomes: [{ texts: ['SECRET'] }],
  someFutureField: 'SECRET',
};
const stub = locatedSealedStub(full as never) as Record<string, unknown>;
eq('exactly the allowed keys (built by construction)', Object.keys(stub).sort(), [...LOCATED_STUB_KEYS].filter((k) => k in full || k === 'arrivalPending').sort());
eq('it says arrival is pending', stub.arrivalPending, true);
eq('it keeps the name and the place', [stub.title, stub.coordinates], ['The bell', C]);
eq('no value anywhere in it says SECRET', JSON.stringify(stub).includes('SECRET'), false);
eq('an unknown future field defaults to WITHHELD', 'someFutureField' in stub, false);

console.log('\n— missionPins: every mission, locked included; hidden only as a circle —');
const game = { stages: [
  { id: 's1', tasks: [
    { id: 'done', title: 'Done', coordinates: C },
    { id: 'cur', title: 'Current', coordinates: { lat: 31.78, lng: 35.23 } },
    { id: 'open', title: 'Open', coordinates: { lat: 31.77, lng: 35.22 } },
    { id: 'hid', title: 'Hidden', coordinates: { lat: 31.771, lng: 35.221 }, hideLocation: true },
    { id: 'nowhere', title: 'Anywhere', locationless: true },
  ] },
  { id: 's2', tasks: [{ id: 'lock', title: 'Locked', coordinates: { lat: 31.76, lng: 35.21 } }] },
] };
const team = { stages: [
  { stageId: 's1', status: 'active', tasks: [
    { taskId: 'done', status: 'completed' }, { taskId: 'cur', status: 'assigned' },
    { taskId: 'open', status: 'unassigned' }, { taskId: 'hid', status: 'unassigned' }, { taskId: 'nowhere', status: 'unassigned' },
  ] },
  { stageId: 's2', status: 'locked', tasks: [{ taskId: 'lock', status: 'unassigned' }] },
] };
const pins = missionPins(game as never, team as never);
eq('ids in game order, hidden and locationless excluded', pins.map((p) => p.id), ['done', 'cur', 'open', 'lock']);
eq('states', pins.map((p) => p.state), ['done', 'current', 'open', 'locked']);
eq('a pin carries its title and exact point', [pins[3].title, pins[3].lat, pins[3].lng], ['Locked', 31.76, 35.21]);
eq('a skipped mission reads as done', missionPins(game as never, { stages: [{ ...team.stages[0], tasks: [{ taskId: 'done', status: 'skipped' }] }] } as never).find((p) => p.id === 'done')?.state, 'done');
eq('junk ⇒ empty', missionPins(null as never, null as never), []);
// Overnight 2026-09-29: an "anywhere" mission (trigger mode locationless) with a stale pin and
// `locationless: false` is not a place to go; the Builder shows it as anywhere.
eq('an "anywhere" mission with a stale pin gets no pin', missionPins({ stages: [{ id: 's1', tasks: [
  { id: 'anyw', title: 'Anywhere', triggerMode: 'locationless', locationless: false, coordinates: { lat: 31.77, lng: 35.23 } }] }] } as never,
  { stages: [{ stageId: 's1', status: 'active', tasks: [{ taskId: 'anyw', status: 'assigned' }] }] } as never), []);

console.log('\n— bearingDeg: 0 = north, clockwise —');
const round = (n: number) => Math.round(n);
eq('due north', round(bearingDeg({ lat: 31, lng: 35 }, { lat: 32, lng: 35 })), 0);
eq('due east', round(bearingDeg({ lat: 0, lng: 35 }, { lat: 0, lng: 36 })), 90);
eq('due south', round(bearingDeg({ lat: 32, lng: 35 }, { lat: 31, lng: 35 })), 180);
eq('due west', round(bearingDeg({ lat: 0, lng: 36 }, { lat: 0, lng: 35 })), 270);
eq('same point ⇒ 0, never NaN', bearingDeg(C, C), 0);

console.log('');
if (failures > 0) {
  console.error(`✗ mission-arrival: ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('✓ mission-arrival: all assertions passed\n');
