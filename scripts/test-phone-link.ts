// Phone numbers -> call and WhatsApp links (change: quick-dial-and-actions, D1).
//   npx tsx scripts/test-phone-link.ts
import { toTelHref, toWhatsAppHref, normalizePhone } from '../packages/shared/src/phoneLink';

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

console.log(failures === 0 ? '\nphone link: all passed' : `\nphone link: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
