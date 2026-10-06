// Issues 42 and 43 (Ahiya, 2026-10-06): the host sheet is filled in on the computer and printed
// filled; an optional schedule prints 10 rows of "time | what happens".
//   npx tsx scripts/test-host-sheet-fields.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanHostSheetFields, hostSheetScheduleRows, HOST_SHEET_SCHEDULE_ROWS, HOST_SHEET_SCHEDULE_MAX } from '../packages/shared/src/hostSheetFields';
import { BUILDER_EDITABLE_FIELDS } from '../apps/creator-web/src/lib/savePayload';

let failures = 0;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

ok('junk → nothing', cleanHostSheetFields(null) === undefined && cleanHostSheetFields('x') === undefined && cleanHostSheetFields([]) === undefined);
ok('all blank → nothing (the caller clears the field)', cleanHostSheetFields({ date: '  ', notes: '', schedule: [{ time: '', what: '' }] }) === undefined);
ok('text is trimmed, one line', eq(cleanHostSheetFields({ date: '  14.10  ', meet: 'a\nb' }), { date: '14.10', meet: 'a b' }));
ok('notes keep their lines', cleanHostSheetFields({ notes: 'one\r\ntwo' })?.notes === 'one\ntwo');
ok('unknown keys are dropped', eq(cleanHostSheetFields({ date: 'x', evil: 'y' }), { date: 'x' }));
ok('long text is capped', (cleanHostSheetFields({ staff: 'x'.repeat(999) })?.staff ?? '').length === 200);
ok('scheduleOn is kept only when true', cleanHostSheetFields({ scheduleOn: true })?.scheduleOn === true && cleanHostSheetFields({ scheduleOn: 'yes' }) === undefined);
ok('trailing empty schedule rows are dropped, a gap in the middle is kept',
  eq(cleanHostSheetFields({ schedule: [{ time: '9:00', what: 'gather' }, { time: '', what: '' }, { time: '10:00', what: 'go' }, { time: '', what: '' }] })?.schedule,
    [{ time: '9:00', what: 'gather' }, { time: '', what: '' }, { time: '10:00', what: 'go' }]));
ok('the schedule is bounded', (cleanHostSheetFields({ schedule: Array.from({ length: 50 }, () => ({ time: '1', what: '2' })) })?.schedule ?? []).length === HOST_SHEET_SCHEDULE_MAX);
ok('printed schedule has at least 10 rows', hostSheetScheduleRows(undefined).length === HOST_SHEET_SCHEDULE_ROWS && HOST_SHEET_SCHEDULE_ROWS === 10);
ok('printed schedule keeps what was typed first', hostSheetScheduleRows({ schedule: [{ time: '9', what: 'x' }] })[0].time === '9');

// The Builder must never carry it: its autosave would otherwise overwrite what was typed on the sheet.
ok('hostSheetFields is NOT in the Builder save payload', !(BUILDER_EDITABLE_FIELDS as readonly string[]).includes('hostSheetFields'));
const fns = readFileSync(join(process.cwd(), 'functions/src/games/index.ts'), 'utf8');
ok('updateGame stores it through the cleaner', /cleanHostSheetFields\(hostSheetFields\)/.test(fns));
ok('a duplicate never carries the source owner\'s fill-ins', /hostSheetFields: _hs, \.\.\.safeSource/.test(fns));
const page = readFileSync(join(process.cwd(), 'apps/creator-web/src/pages/HostSheetPage.tsx'), 'utf8');
ok('the host sheet saves the fill-ins with updateGame', /updateGame\(\{[^}]*hostSheetFields/.test(page));
ok('the schedule checkbox exists', /data-testid="hs-schedule-toggle"/.test(page));

console.log(failures === 0 ? '\n✅ host sheet fields: ALL PASS' : `\n❌ host sheet fields: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
