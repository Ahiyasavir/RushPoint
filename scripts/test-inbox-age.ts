// How long an inbox item has waited, in units a host reads at a glance
// (found in the Run Console, 2026-10-03: a stuck team showed "965 שע׳").
//
// Under an hour: a clock (m:ss), because the first minutes are what a host acts
// on. Under two days: whole hours. From two days: whole days, because nobody
// reads 965 hours as "about forty days".
import { inboxAge } from '../apps/creator-web/src/lib/inboxAge';

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} :: ${JSON.stringify(detail)}`); }
};

console.log('\ninbox age');
const s = 1000, m = 60 * s, h = 60 * m, d = 24 * h;
check('0 → clock 0:00', JSON.stringify(inboxAge(0)) === JSON.stringify({ kind: 'clock', text: '0:00' }), inboxAge(0));
check('95 s → 1:35', JSON.stringify(inboxAge(95 * s)) === JSON.stringify({ kind: 'clock', text: '1:35' }), inboxAge(95 * s));
check('59:59 is still a clock', inboxAge(h - s).kind === 'clock');
check('1 h → hours 1', JSON.stringify(inboxAge(h)) === JSON.stringify({ kind: 'hours', n: 1 }), inboxAge(h));
check('47 h → hours 47', JSON.stringify(inboxAge(47 * h + 59 * m)) === JSON.stringify({ kind: 'hours', n: 47 }));
check('48 h → days 2', JSON.stringify(inboxAge(48 * h)) === JSON.stringify({ kind: 'days', n: 2 }), inboxAge(48 * h));
check('965 h → days 40', JSON.stringify(inboxAge(965 * h)) === JSON.stringify({ kind: 'days', n: 40 }), inboxAge(965 * h));
check('negative (clock skew) → 0:00', JSON.stringify(inboxAge(-5000)) === JSON.stringify({ kind: 'clock', text: '0:00' }));
check('junk → 0:00', JSON.stringify(inboxAge(NaN)) === JSON.stringify({ kind: 'clock', text: '0:00' }));

console.log(failures === 0 ? '\n✅ inbox age: ALL PASS' : `\n❌ inbox age: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
