// Resolves a dataset's rows from its source: a Google Sheet tab (when
// RUSHPOINT_SHEETS_ID is set and the sheet is shared "anyone with the link"),
// otherwise the bundled local CSV. Google Sheets failures fall back to the local
// CSV with a warning — the sync never crashes on a network/sharing hiccup.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCsvObjects } from './csv.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_DIR = path.join(HERE, '..', 'data', 'sheets');

// Read dynamically so a .env loaded at runtime (see sync-sheets.mjs) is honored.
const sheetId = () => (process.env.RUSHPOINT_SHEETS_ID ?? '').trim();
export const usingSheets = () => sheetId().length > 0;

const gvizUrl = (tab) =>
  `https://docs.google.com/spreadsheets/d/${sheetId()}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;

async function fromSheet(tab) {
  const res = await fetch(gvizUrl(tab));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  // gviz returns an HTML error page (not CSV) when the sheet isn't shared/public.
  if (/^\s*<(?:!doctype|html)/i.test(text)) {
    throw new Error('sheet not shared publicly, or tab missing');
  }
  return parseCsvObjects(text);
}

async function fromLocal(tab) {
  const text = await readFile(path.join(LOCAL_DIR, `${tab}.csv`), 'utf8');
  return parseCsvObjects(text);
}

/** Get the rows for a dataset tab. Tries Google Sheets first, then local CSV. */
export async function fetchRows(tab) {
  if (usingSheets()) {
    try {
      const rows = await fromSheet(tab);
      console.info(`  ↳ Sheets  ${tab.padEnd(12)} ← Google Sheets (${rows.length} rows)`);
      return rows;
    } catch (e) {
      console.warn(`  ⚠ ${tab}: Google Sheets unavailable (${e.message}) — using local CSV`);
    }
  }
  const rows = await fromLocal(tab);
  console.info(`  ↳ Local   ${tab.padEnd(12)} ← ${tab}.csv (${rows.length} rows)`);
  return rows;
}
