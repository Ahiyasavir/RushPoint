import { TASK_BANK } from '../apps/creator-web/src/taskBank';

const AUD = ['kids', 'youth', 'adults', 'corporate', 'mixed'];
const ACT = ['action', 'camera', 'thinking', 'teamwork', 'creative', 'educational', 'chores'];
const want = process.argv[2];

const rows = TASK_BANK.filter((e) => !want || e.tags.includes(want as never));
console.log(`${rows.length} missions${want ? ` tagged ${want}` : ''}\n`);
for (const e of rows.sort((a, b) => a.difficulty - b.difficulty)) {
  const t = e.build();
  const aud = e.tags.filter((x) => AUD.includes(x)).join('/');
  const act = e.tags.filter((x) => ACT.includes(x)).join('/');
  const prep = e.tags.find((x) => ['noPrep', 'needsSetup', 'needsPartner'].includes(x));
  const where = e.tags.includes('fromAnywhere') ? 'any' : 'PIN';
  const bookend = e.tags.includes('start') ? 'START' : e.tags.includes('finish') ? 'FIN' : '';
  console.log(
    `${e.key.padEnd(30)} d${String(e.difficulty).padStart(2)} ${String(t.type).padEnd(13)} ${where.padEnd(3)} ${String(prep).padEnd(11)} min${String(e.minAge ?? '-').padEnd(3)} ${bookend.padEnd(5)} ${act.padEnd(34)} ${aud}`,
  );
}
