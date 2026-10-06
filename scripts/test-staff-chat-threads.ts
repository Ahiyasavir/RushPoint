// Issue 45 (Ahiya, 2026-10-06): every staff member can open a chat with any team of their choice,
// see "my" conversations, and the team sees which staff member wrote.
//   npx tsx scripts/test-staff-chat-threads.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeOpenedThreads, isMyThread, pickableTeams } from '../apps/play-web/src/lib/staffChatThreads';

let failures = 0;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };

const stored = [{ teamId: 'a', messages: [{ senderId: 'team-a' }], updatedAt: '2' }];
const merged = mergeOpenedThreads(stored, ['b', 'a', 'b']);
ok('a picked team with no thread gets an empty one, first', merged[0].teamId === 'b' && merged[0].messages.length === 0);
ok('a picked team that has a thread is not doubled', merged.filter((t) => t.teamId === 'a').length === 1 && merged.length === 2);
ok('total on junk', mergeOpenedThreads(undefined as never, undefined as never).length === 0);

ok('mine: a thread I wrote in', isMyThread({ teamId: 'x', messages: [{ senderId: 'me' }], updatedAt: '' }, 'me', [], []));
ok('mine: a team I follow', isMyThread({ teamId: 'x', messages: [], updatedAt: '' }, 'me', ['x'], []));
ok('mine: a team I opened', isMyThread({ teamId: 'x', messages: [], updatedAt: '' }, 'me', [], ['x']));
ok('not mine: another marshal\'s conversation', !isMyThread({ teamId: 'x', messages: [{ senderId: 'other' }], updatedAt: '' }, 'me', [], []));

const teams = [{ id: '1', displayName: 'נשרים' }, { id: '2', displayName: 'אריות' }, { id: '3', displayName: 'נמרים' }];
ok('the picker offers every team, sorted by name', pickableTeams(teams, '').map((t) => t.id).join() === '2,3,1');
ok('the picker filters by search', pickableTeams(teams, 'נ').map((t) => t.id).join() === '3,1');

const staff = readFileSync(join(process.cwd(), 'apps/play-web/src/screens/StaffConsole.tsx'), 'utf8');
ok('the staff chat has a "new message" team picker', /data-testid="staff-chat-new"/.test(staff) && /pickableTeams\(/.test(staff));
ok('the staff chat has a "mine" filter', /isMyThread\(/.test(staff));
ok('another staff member\'s line is labelled with their name', /hqSenderLabel\(/.test(staff));
const panel = readFileSync(join(process.cwd(), 'apps/play-web/src/components/ChatPanel.tsx'), 'utf8');
ok('the team\'s phone labels an HQ line with the staff name', /hqSenderLabel\(/.test(panel));

console.log(failures === 0 ? '\n✅ staff chat threads: ALL PASS' : `\n❌ staff chat threads: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
