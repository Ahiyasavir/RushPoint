// Phone numbers -> call and WhatsApp links (change: quick-dial-and-actions, D1).
//   npx tsx scripts/test-phone-link.ts
import { toTelHref, toWhatsAppHref, normalizePhone } from '../packages/shared/src/phoneLink';
import { validateRunContacts, contactsFor } from '../packages/shared/src/runContacts';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// Israeli mobile, the common case, in the shapes people actually type.
for (const raw of ['0521234567', '052-1234567', '052 123 4567', '(052) 123-4567', '+972521234567', '+972 52-123-4567', '972521234567', '00972521234567']) {
  check(`mobile "${raw}" -> +972521234567`, normalizePhone(raw) === '+972521234567', String(normalizePhone(raw)));
}
check('landline 02-6543210 -> +97226543210', normalizePhone('02-6543210') === '+97226543210', String(normalizePhone('02-6543210')));
check('a foreign + number is kept', normalizePhone('+44 20 7946 0958') === '+442079460958', String(normalizePhone('+44 20 7946 0958')));
check('Hebrew/RTL marks around the number are ignored', normalizePhone('‏052-1234567‏') === '+972521234567');

for (const bad of ['', '   ', 'abc', '123', '05212345678901234', null, undefined, 42, '+', '0', 'javascript:alert(1)']) {
  check(`garbage ${JSON.stringify(bad)} -> null (no link rendered)`, normalizePhone(bad as never) === null);
}

check('tel link', toTelHref('052-1234567') === 'tel:+972521234567', String(toTelHref('052-1234567')));
check('WhatsApp link has no plus sign', toWhatsAppHref('052-1234567') === 'https://wa.me/972521234567', String(toWhatsAppHref('052-1234567')));
check('no link for garbage', toTelHref('abc') === null && toWhatsAppHref('abc') === null);

// Run contacts (D2).
{
  const ok = validateRunContacts([{ label: ' HQ ', phone: '052-1234567', visibleTo: ['players', 'staff', 'nobody'] }]);
  check('a valid contact is kept, trimmed, with an id and only known audiences',
    ok.ok && ok.contacts[0].label === 'HQ' && ok.contacts[0].id === 'c1' && ok.contacts[0].visibleTo.join() === 'players,staff', JSON.stringify(ok));
  const bad = (v: unknown, p: string) => { const r = validateRunContacts(v); return !r.ok && r.problem === p; };
  check('an unparsable number is refused', bad([{ label: 'x', phone: 'call me', visibleTo: ['players'] }], 'phone'));
  check('an empty label is refused', bad([{ label: '  ', phone: '052-1234567', visibleTo: ['players'] }], 'label'));
  check('no audience is refused', bad([{ label: 'x', phone: '052-1234567', visibleTo: [] }], 'audience'));
  check('six contacts are refused', bad(Array.from({ length: 6 }, () => ({ label: 'x', phone: '052-1234567', visibleTo: ['staff'] })), 'tooMany'));
  check('not an array is refused', bad('x', 'shape'));
  const list = [
    { id: 'c1', label: 'A', phone: '1', visibleTo: ['players'] },
    { id: 'c2', label: 'B', phone: '2', visibleTo: ['staff'] },
    { id: 'c3', label: 'C', phone: '3', visibleTo: ['players', 'staff'], extra: 'secret' },
    null,
  ];
  const p = contactsFor(list, 'players');
  check('players get only theirs, stripped to id/label/phone', JSON.stringify(p) === JSON.stringify([{ id: 'c1', label: 'A', phone: '1' }, { id: 'c3', label: 'C', phone: '3' }]), JSON.stringify(p));
  check('garbage contacts -> empty', contactsFor('x', 'staff').length === 0);
}

console.log(failures === 0 ? '\nphone link: all passed' : `\nphone link: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
