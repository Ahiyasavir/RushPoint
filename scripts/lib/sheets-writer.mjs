// Outbound writer — pushes data back into the Google Sheet via an Apps Script Web
// App (see scripts/data/sheets/APPS_SCRIPT_SETUP.md). This is how the app keeps the
// sheet in sync with live state without a service-account key file: the script runs
// as the sheet owner, so we only need its deployment URL (RUSHPOINT_SHEETS_WEBHOOK).
//
// No-ops gracefully (with a one-line notice) when the webhook isn't configured yet,
// so the rest of the app is unaffected until you deploy the script.

const webhook = () => (process.env.RUSHPOINT_SHEETS_WEBHOOK ?? '').trim();
const token   = () => (process.env.RUSHPOINT_SHEETS_TOKEN ?? '').trim();

export const webhookConfigured = () => webhook().length > 0;

async function post(payload) {
  const url = webhook();
  if (!url) return { ok: false, skipped: true };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, token: token() }),
    redirect: 'follow', // Apps Script web apps 302 to script.googleusercontent.com
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`bad response: ${text.slice(0, 120)}`); }
  if (!json.ok) throw new Error(json.error || 'webhook rejected');
  return json;
}

/** Overwrite a whole tab with `rows` (array of arrays; first row = headers). */
export async function replaceTab(tab, rows) {
  return post({ op: 'replaceTab', tab, rows });
}

/** Append rows to a tab (e.g. an event log). */
export async function appendRows(tab, rows) {
  return post({ op: 'append', tab, rows });
}
