// "Add a phone" with one scan (change: team-phones-simple, D1).
//
// A team's second phone used to need two codes typed by hand. The team phone now shows a QR / link
// carrying both, `?code=<RUN>&join=<DEVICECODE>`, and the join screen turns into "join team <name>"
// with one field. The device code is the same one already shown on screen to the whole team and
// grants only "attach to this team, in this run" (the attach callable is rate limited), so putting
// it in a link does not change who can do what.

/** Longest code accepted from a link or a paste. Real device codes are 6 characters. */
const MAX_DEVICE_CODE_LEN = 12;

export function normalizeDeviceCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, MAX_DEVICE_CODE_LEN);
}

export function buildDeviceJoinLink(origin: string, runCode: string, deviceCode: string): string {
  const base = origin.replace(/\/+$/, '');
  const code = runCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return `${base}/?code=${encodeURIComponent(code)}&join=${encodeURIComponent(normalizeDeviceCode(deviceCode))}`;
}
