// Issue 37 (2026-10-06): after switching account in another tab the header named "דר ריקי יונה"
// over spendora's games. The header follows onAuthStateChanged; the dashboard loaded listGames ONCE
// (`useEffect(() => load(), [])`) and kept the previous account's list. Every route is now keyed on
// the signed-in uid, so a new account remounts every page and nothing fetched for the old one stays.
//   npx tsx scripts/test-account-switch-remount.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };
const app = readFileSync(join(process.cwd(), 'apps/creator-web/src/App.tsx'), 'utf8');
ok('the routes are keyed on the signed-in uid', /<Routes key=\{user\?\.uid/.test(app));
ok('exactly one <Routes> (a second, unkeyed one would keep stale pages)', (app.match(/<Routes[\s>]/g) ?? []).length === 1);
ok('the header name and the key read the same user', /user\?\.displayName/.test(app));
console.log(failures === 0 ? '\n✅ account switch remount: ALL PASS' : `\n❌ account switch remount: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
